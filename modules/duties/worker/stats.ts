// Statistics of the helper plan (docs/dev/design.md, Statistics): helper duties per family for the team's
// coaches, with a reminder to the families without a duty, and the family's duties for players and parents.
// The attendance part of the statistics is the core's (worker/domain/stats.ts).
import { plural, t } from "@lingui/core/macro";
import { Hono } from "hono";
import { z } from "zod";
import type { PersonRef } from "../../../shared/types";
import type { HelperFamily, MyHelperStats, TeamHelperStats } from "../types";
import { type AppEnv, intParam, requireActor } from "../../../worker/app";
import { type Actor, requireCoach } from "../../../worker/auth/actor";
import { rangeFrom, seasonStart, statsPersons } from "../../../worker/domain/stats";
import { all, first, list, run } from "../../../worker/lib/db";
import { badRequest, conflict, notFound, parse, readJson } from "../../../worker/lib/http";
import { nowLocal, todayLocal } from "../../../worker/lib/time";
import { rangeOf } from "../../../worker/routes/stats";
import { relyingParty } from "../../../worker/auth/webauthn";
import { sendHelperReminder } from "./notify";

interface DutyRow {
  person_id: number | null;
  child_id: number | null;
  starts_at: string;
}

/** Helper duties at the team's events (not those of approved people from all teams), not cancelled, from `from`, upcoming ones too. */
function teamDuties(db: D1Database, teamId: number, from: string): Promise<DutyRow[]> {
  return all<DutyRow>(
    db,
    `SELECT d.person_id, d.child_id, e.starts_at FROM duties d
       JOIN events e ON e.id = d.event_id
       JOIN duty_types dt ON dt.id = d.duty_type_id AND dt.who_referees = 0
      WHERE d.event_id IN (SELECT et.event_id FROM event_teams et WHERE et.team_id = ?1)
        AND e.starts_at >= ?2 AND e.cancelled_at IS NULL`,
    teamId,
    `${from}T00:00`,
  );
}

interface FamilyBuild {
  children: PersonRef[];
  guardians: (PersonRef & { hasAccount: boolean })[];
  helper: boolean;
  members: Set<number>;
}

/**
 * The team's families: a player (or a permanent stand-in) with their parents. Siblings with a shared parent are
 * one family, so the parent's duties do not count twice.
 */
export async function teamFamilies(db: D1Database, teamId: number): Promise<FamilyBuild[]> {
  const kids = await all<{ id: number; first_name: string; last_name: string | null; helper: number }>(
    db,
    `SELECT p.id, p.first_name, p.last_name, min(tm.role = 'helper') AS helper
       FROM team_memberships tm JOIN persons p ON p.id = tm.person_id
      WHERE tm.team_id = ? AND tm.role IN ('player', 'helper') AND p.is_former = 0
      GROUP BY p.id ORDER BY p.first_name, p.last_name`,
    teamId,
  );
  const links = kids.length
    ? await all<{ child_id: number; id: number; first_name: string; last_name: string | null; has_account: number }>(
        db,
        `SELECT g.child_id, p.id, p.first_name, p.last_name,
                EXISTS (SELECT 1 FROM accounts a WHERE a.person_id = p.id AND a.disabled_at IS NULL) AS has_account
           FROM guardianships g JOIN persons p ON p.id = g.guardian_id
          WHERE g.child_id IN (SELECT value FROM json_each(?)) AND p.is_former = 0
          ORDER BY p.first_name`,
        list(kids.map((k) => k.id)),
      )
    : [];
  // Union-find over shared parents
  const parent = new Map<number, number>(kids.map((k) => [k.id, k.id]));
  const root = (id: number): number => {
    let r = id;
    while (parent.get(r) !== r) r = parent.get(r)!;
    parent.set(id, r);
    return r;
  };
  const firstChildOf = new Map<number, number>();
  for (const l of links) {
    const other = firstChildOf.get(l.id);
    if (other == null) firstChildOf.set(l.id, l.child_id);
    else parent.set(root(l.child_id), root(other));
  }
  const families = new Map<number, FamilyBuild>();
  for (const k of kids) {
    const r = root(k.id);
    const f = families.get(r) ?? { children: [], guardians: [], helper: true, members: new Set<number>() };
    f.children.push({ id: k.id, firstName: k.first_name, lastName: k.last_name });
    f.helper &&= k.helper === 1;
    f.members.add(k.id);
    families.set(r, f);
  }
  for (const l of links) {
    const f = families.get(root(l.child_id))!;
    if (f.members.has(l.id)) continue;
    f.members.add(l.id);
    f.guardians.push({ id: l.id, firstName: l.first_name, lastName: l.last_name, hasAccount: l.has_account === 1 });
  }
  return [...families.values()];
}

export const remindRef = (teamId: number, today: string) => `${teamId}:${today}`;

export async function loadHelperStats(db: D1Database, teamId: number, from: string, now = Date.now()): Promise<TeamHelperStats> {
  const nowL = nowLocal(now);
  const [families, duties, slots, reminded] = await Promise.all([
    teamFamilies(db, teamId),
    teamDuties(db, teamId, from),
    first<{ open: number | null }>(
      db,
      `SELECT sum(max(0, ed.slots - (SELECT count(*) FROM duties d WHERE d.event_duty_id = ed.id))) AS open
         FROM event_duties ed
         JOIN events e ON e.id = ed.event_id
         JOIN duty_types dt ON dt.id = ed.duty_type_id AND dt.who_referees = 0
        WHERE ed.event_id IN (SELECT et.event_id FROM event_teams et WHERE et.team_id = ?1)
          AND e.starts_at > ?2 AND e.cancelled_at IS NULL AND (e.kind = 'special' OR e.duty_hidden = 0)`,
      teamId,
      nowL,
    ),
    first<{ ok: number }>(db, "SELECT 1 AS ok FROM duty_notifications WHERE kind = 'stats_remind' AND ref = ?", remindRef(teamId, todayLocal(now))),
  ]);
  const out: HelperFamily[] = families.map((f) => ({ children: f.children, guardians: f.guardians, helper: f.helper, done: 0, planned: 0 }));
  const byChild = new Map<number, number>();
  const byMember = new Map<number, number>();
  families.forEach((f, i) => {
    for (const c of f.children) byChild.set(c.id, i);
    for (const m of f.members) if (!byMember.has(m)) byMember.set(m, i);
  });
  let done = 0;
  let planned = 0;
  let others = 0;
  for (const d of duties) {
    const isDone = d.starts_at < nowL;
    if (isDone) done++;
    else planned++;
    // A duty belongs to the family of its linked child, else of the person, else to "others"
    const i = (d.child_id != null ? byChild.get(d.child_id) : undefined) ?? (d.person_id != null ? byMember.get(d.person_id) : undefined);
    if (i == null) {
      others++;
      continue;
    }
    if (isDone) out[i]!.done++;
    else out[i]!.planned++;
  }
  return { done, planned, others, openSlots: slots?.open ?? 0, families: out, remindedToday: !!reminded };
}

/** The family's helper duties this season, per person (oneself, children) and team with a helper plan. */
export async function loadMyHelperStats(db: D1Database, actor: Actor, now = Date.now()): Promise<MyHelperStats> {
  const nowL = nowLocal(now);
  const season = await seasonStart(db);
  const pairs = statsPersons(actor);
  if (!pairs.length) return { persons: [] };
  const personIds = pairs.map((p) => p.person.id);
  const teamIds = [...new Set(pairs.flatMap((p) => p.teamIds))];
  const [teams, guardians] = await Promise.all([
    all<{ id: number }>(db, "SELECT id FROM teams WHERE helper_plan = 1 AND id IN (SELECT value FROM json_each(?))", list(teamIds)),
    all<{ child_id: number; guardian_id: number }>(db, "SELECT child_id, guardian_id FROM guardianships WHERE child_id IN (SELECT value FROM json_each(?))", list(personIds)),
  ]);
  const withPlan = new Set(teams.map((t) => t.id));
  const out: MyHelperStats = { persons: [] };
  for (const p of pairs) {
    const entry: MyHelperStats["persons"][number] = { personId: p.person.id, teams: [] };
    for (const teamId of p.teamIds.filter((id) => withPlan.has(id))) {
      const family = [p.person.id, ...guardians.filter((g) => g.child_id === p.person.id).map((g) => g.guardian_id)];
      const duties = await all<DutyRow & { label: string; name: string }>(
        db,
        `SELECT d.person_id, d.child_id, e.starts_at, dt.name AS label, COALESCE(pp.first_name, d.manual_name) AS name FROM duties d
           JOIN events e ON e.id = d.event_id
           JOIN duty_types dt ON dt.id = d.duty_type_id AND dt.who_referees = 0
           LEFT JOIN persons pp ON pp.id = d.person_id
          WHERE (d.person_id IN (SELECT value FROM json_each(?2)) OR d.child_id = ?3)
            AND d.event_id IN (SELECT et.event_id FROM event_teams et WHERE et.team_id = ?1)
            AND e.starts_at >= ?4 AND e.cancelled_at IS NULL
          ORDER BY e.starts_at`,
        teamId,
        list(family),
        p.person.id,
        `${season}T00:00`,
      );
      const upcoming = duties.filter((d) => d.starts_at >= nowL);
      entry.teams.push({
        teamId,
        done: duties.length - upcoming.length,
        planned: upcoming.length,
        next: upcoming[0] ? { startsAt: upcoming[0].starts_at, label: upcoming[0].label, name: upcoming[0].name } : null,
      });
    }
    if (entry.teams.length) out.persons.push(entry);
  }
  return out;
}

export const helperStatsRoutes = new Hono<AppEnv>();

/** Helper duties per family of a team (coaches of the team and admins). */
helperStatsRoutes.get("/duties/teams/:id/stats", async (c) => {
  const actor = requireActor(c);
  const teamId = intParam(c, "id");
  requireCoach(actor, teamId);
  const team = await first<{ helper_plan: number }>(c.env.DB, "SELECT helper_plan FROM teams WHERE id = ? AND kind = 'team'", teamId);
  if (!team) throw notFound(t`This team does not exist.`);
  if (team.helper_plan !== 1) throw badRequest(t`This team has no helper plan.`, "no_helper_plan");
  return c.json(await loadHelperStats(c.env.DB, teamId, await rangeFrom(c.env.DB, rangeOf(c.req.query("range")))));
});

const remindSchema = z.object({ range: z.enum(["4w", "season"]).default("season"), includeHelpers: z.boolean().default(false) });

/** Remind the families without a helper duty in the range; once a day per team, only while places are open. */
helperStatsRoutes.post("/duties/teams/:id/stats/remind", async (c) => {
  const actor = requireActor(c);
  const teamId = intParam(c, "id");
  requireCoach(actor, teamId);
  const input = parse(remindSchema, await readJson(c.req.raw));
  const team = await first<{ name: string; parents_enabled: number; helper_plan: number }>(
    c.env.DB,
    "SELECT name, parents_enabled, helper_plan FROM teams WHERE id = ? AND kind = 'team'",
    teamId,
  );
  if (!team) throw notFound(t`This team does not exist.`);
  if (team.helper_plan !== 1) throw badRequest(t`This team has no helper plan.`, "no_helper_plan");
  const stats = await loadHelperStats(c.env.DB, teamId, await rangeFrom(c.env.DB, input.range));
  if (stats.openSlots === 0) throw conflict(t`No places are free at the moment. A reminder only helps once duties are open again.`, "no_open_slots");
  const families = stats.families.filter((f) => input.includeHelpers || !f.helper);
  const without = families.filter((f) => f.done + f.planned === 0);
  if (!without.length) throw conflict(t`All families have helped already.`, "nobody_to_remind");
  // The parents if they are involved, otherwise the players themselves
  const personIds = without.flatMap((f) => (team.parents_enabled === 1 ? f.guardians.map((g) => g.id) : f.children.map((ch) => ch.id)));
  const accounts = await all<{ id: number }>(
    c.env.DB,
    "SELECT id FROM accounts WHERE person_id IN (SELECT value FROM json_each(?)) AND disabled_at IS NULL",
    list(personIds),
  );
  if (!accounts.length) throw conflict(t`None of these families can be reached through the app. Best talk to them directly.`, "nobody_reachable");
  const claimed = await run(c.env.DB, "INSERT OR IGNORE INTO duty_notifications (kind, ref) VALUES ('stats_remind', ?)", remindRef(teamId, todayLocal()));
  if (!(claimed.meta.changes ?? 0)) throw conflict(t`These families were already reminded today. Tomorrow it works again.`, "already_reminded");
  await sendHelperReminder(
    c.env,
    accounts.map((a) => a.id),
    {
      teamId,
      teamName: team.name,
      helped: families.length - without.length,
      total: families.length,
      parents: team.parents_enabled === 1,
      origin: relyingParty(c.env, c.req.raw).origin,
    },
  );
  const n = without.length;
  return c.json({ families: n, accounts: accounts.length, message: plural(n, { one: "Reminder sent to one family.", other: "Reminder sent to # families." }) });
});

helperStatsRoutes.get("/duties/stats/me", async (c) => {
  const actor = requireActor(c);
  return c.json(await loadMyHelperStats(c.env.DB, actor));
});
