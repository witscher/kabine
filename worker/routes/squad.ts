import { t } from "@lingui/core/macro";
import { Hono } from "hono";
import { z } from "zod";
import type { PersonRef } from "../../shared/types";
import { type AppEnv, intParam, requireActor } from "../app";
import { type Actor, isCoachOf, isCoachOfAny, requireActFor } from "../auth/actor";
import { syncAutoSquads } from "../domain/auto-squad";
import { type EventRow, eventTeams, eventTitle, loadEvent, loadEventContext, toSummary } from "../domain/events";
import { notifyCoaches, notifyPersons, shortDate, shortTime } from "../domain/notify";
import { all, first, list, run, stmt } from "../lib/db";
import { moduleParticipantsDropped, moduleParticipantsLeft } from "../modules";
import { badRequest, conflict, forbidden, notFound, parse, readJson } from "../lib/http";
import { addMinutesLocal, isoWeekday, localToInstant, utcIso } from "../lib/time";
import { isoWeekdayShort } from "../../shared/dates";
import { currentLocale } from "../i18n";

export const squadRoutes = new Hono<AppEnv>();

interface CandidateRow {
  person_id: number;
  first_name: string;
  last_name: string | null;
  birth_year: number | null;
  is_active: number;
  role: "player" | "helper";
}

async function gameForCoach(db: D1Database, actor: Actor, eventId: number) {
  const event = await loadEvent(db, eventId);
  if (!event || event.kind !== "game") throw notFound(t`This game does not exist.`);
  const ctx = await loadEventContext(db, [event]);
  const teams = eventTeams(event, ctx);
  const team = teams[0];
  if (!team) throw notFound(t`No team is assigned to this game.`);
  if (!isCoachOf(actor, team.id)) throw forbidden(t`Only coaches of this team nominate the squad.`);
  return { event, ctx, team };
}

/** Other games that overlap in time (±3 hours around the throw-off). */
async function overlappingNominations(db: D1Database, event: EventRow, personIds: number[]) {
  if (!personIds.length) return new Map<number, string>();
  const rows = await all<{ person_id: number; event_id: number; starts_at: string; home_team: string | null; guest_team: string | null; team_name: string | null }>(
    db,
    `SELECT n.person_id, e.id AS event_id, e.starts_at, e.home_team, e.guest_team,
            (SELECT group_concat(name, ' · ') FROM (SELECT t.name FROM event_teams et JOIN teams t ON t.id = et.team_id WHERE et.event_id = e.id ORDER BY t.name)) AS team_name
       FROM nominations n JOIN events e ON e.id = n.event_id
      WHERE n.person_id IN (SELECT value FROM json_each(?)) AND e.id <> ? AND e.kind = 'game' AND e.cancelled_at IS NULL
        AND e.starts_at > ? AND e.starts_at < ?`,
    list(personIds),
    event.id,
    addMinutesLocal(event.starts_at, -180),
    addMinutesLocal(event.starts_at, 180),
  );
  // All overlapping games per person, e.g. for players in wC1 and wC2
  const parts = new Map<number, string[]>();
  for (const r of rows.sort((a, b) => a.starts_at.localeCompare(b.starts_at))) {
    const game = r.team_name ?? t`another game`;
    const time = r.starts_at.slice(11, 16);
    parts.set(r.person_id, [...(parts.get(r.person_id) ?? []), t`${game} (${time})`]);
  }
  return new Map(
    [...parts].map(([id, list]) => {
      const games = list.join(", ");
      return [id, t`Nominated for ${games} at the same time`];
    }),
  );
}

async function ageClassFor(db: D1Database, code: string) {
  return first<{ code: string; name: string; rank: number; birth_year_min: number | null; birth_year_max: number | null; is_youth: number }>(
    db,
    `SELECT ac.code, ac.name, ac.rank, ac.birth_year_min, ac.birth_year_max, ac.is_youth
       FROM age_classes ac JOIN seasons s ON s.id = ac.season_id AND s.is_current = 1 WHERE ac.code = ?`,
    code,
  );
}

export function ageWarning(
  birthYear: number | null,
  ac: { name: string; birth_year_min: number | null; birth_year_max: number | null } | null,
): string | null {
  if (!ac || birthYear == null) return null;
  const ageClass = ac.name;
  if (ac.birth_year_min != null && birthYear < ac.birth_year_min) return t`Born ${birthYear}: too old for ${ageClass}`;
  if (ac.birth_year_max != null && birthYear > ac.birth_year_max) return t`Born ${birthYear}: does not fit ${ageClass}`;
  return null;
}

squadRoutes.get("/events/:id/squad", async (c) => {
  const actor = requireActor(c);
  const { event, ctx, team } = await gameForCoach(c.env.DB, actor, intParam(c, "id"));
  const db = c.env.DB;

  const [members, accepted, core, lastGame, lastTraining, ac, helps] = await Promise.all([
    all<CandidateRow>(
      db,
      `SELECT p.id AS person_id, p.first_name, p.last_name, p.birth_year, p.is_active, tm.role
         FROM team_memberships tm JOIN persons p ON p.id = tm.person_id
        WHERE tm.team_id = ? AND tm.role IN ('player', 'helper') AND p.is_former = 0
        ORDER BY tm.role DESC, p.first_name, p.last_name, p.id`,
      team.id,
    ),
    all<CandidateRow>(
      db,
      `SELECT p.id AS person_id, p.first_name, p.last_name, p.birth_year, p.is_active, 'helper' AS role
         FROM help_requests h JOIN persons p ON p.id = h.person_id
        WHERE h.event_id = ? AND h.status = 'accepted' AND p.is_former = 0`,
      event.id,
    ),
    all<{ person_id: number }>(db, "SELECT person_id FROM core_squad WHERE team_id = ?", team.id),
    first<{ id: number }>(
      db,
      `SELECT e.id FROM events e JOIN event_teams et ON et.event_id = e.id
        WHERE et.team_id = ? AND e.kind = 'game' AND e.id <> ? AND e.squad_published_at IS NOT NULL AND e.starts_at < ?
        ORDER BY e.starts_at DESC LIMIT 1`,
      team.id,
      event.id,
      event.starts_at,
    ),
    first<{ id: number }>(
      db,
      `SELECT e.id FROM events e JOIN event_teams et ON et.event_id = e.id
        WHERE et.team_id = ? AND e.kind = 'training' AND e.cancelled_at IS NULL AND e.starts_at < ? AND e.starts_at > ?
        ORDER BY e.starts_at DESC LIMIT 1`,
      team.id,
      event.starts_at,
      addMinutesLocal(event.starts_at, -14 * 24 * 60),
    ),
    ageClassFor(db, team.age_class_code),
    all<{ id: number; person_id: number; status: string; first_name: string; last_name: string | null; home_team: string | null }>(
      db,
      `SELECT h.id, h.person_id, h.status, p.first_name, p.last_name,
              (SELECT group_concat(name, ' · ') FROM (SELECT t.name FROM team_memberships tm JOIN teams t ON t.id = tm.team_id
                WHERE tm.person_id = p.id AND tm.role = 'player' AND tm.team_id <> h.team_id AND t.kind = 'team' ORDER BY t.name)) AS home_team
         FROM help_requests h JOIN persons p ON p.id = h.person_id
        WHERE h.event_id = ? AND h.status <> 'withdrawn' ORDER BY h.created_at`,
      event.id,
    ),
  ]);

  const candidates = [...members];
  for (const a of accepted) if (!candidates.some((m) => m.person_id === a.person_id)) candidates.push(a);

  // Hints from the last training before the game
  const trainingHints = new Map<number, string>();
  if (lastTraining) {
    const training = (await loadEvent(db, lastTraining.id))!;
    const tctx = await loadEventContext(db, [training]);
    const weekday = isoWeekday(training.starts_at.slice(0, 10));
    const day = isoWeekdayShort(currentLocale(), weekday);
    for (const p of tctx.participants.get(training.id) ?? []) {
      const text =
        p.status === "yes"
          ? t`Accepted training ${day}`
          : p.status === "no"
            ? p.response?.is_late
              ? t`Declined training ${day} at short notice`
              : t`Declined training ${day}`
            : p.status === "standing"
              ? weekday === 5
                ? t`Permanently absent on Fridays`
                : t`Permanently absent from training ${day}`
              : p.status === "open"
                ? t`No response for the training`
                : "";
      if (text) trainingHints.set(p.person.id, text);
    }
  }

  const conflicts = await overlappingNominations(db, event, candidates.map((m) => m.person_id));
  const nominated = ctx.nominations.get(event.id) ?? new Map();
  const participants = ctx.participants.get(event.id) ?? [];
  const coreIds = new Set(core.map((r) => r.person_id));

  const lastIds = lastGame
    ? (await all<{ person_id: number }>(db, "SELECT person_id FROM nominations WHERE event_id = ?", lastGame.id)).map((r) => r.person_id)
    : [];

  return c.json({
    event: toSummary(event, ctx, actor, Date.now()),
    team: { id: team.id, name: team.name, maxSquad: team.max_squad, autoSquad: team.auto_squad === 1 },
    published: event.squad_published_at != null,
    // Automatic from the core squad as long as the coach does not edit this squad
    automatic: team.auto_squad === 1 && event.squad_manual === 0,
    candidates: candidates.map((m) => {
      const isHelper = m.role === "helper";
      const part = participants.find((p) => p.person.id === m.person_id);
      return {
        person: { id: m.person_id, firstName: m.first_name, lastName: m.last_name } satisfies PersonRef,
        isHelper,
        isCore: coreIds.has(m.person_id),
        isActive: m.is_active === 1,
        nominated: nominated.has(m.person_id),
        status: part?.status ?? null,
        reason: part?.response?.reason ?? null,
        hint: m.is_active !== 1 ? t`Inactive, cannot be nominated` : (trainingHints.get(m.person_id) ?? (isHelper ? t({ message: "Helper", context: "squad" }) : "")),
        conflict: conflicts.get(m.person_id) ?? null,
        ageWarning: isHelper ? null : ageWarning(m.birth_year, ac),
      };
    }),
    coreIds: [...coreIds],
    lastGameIds: lastIds,
    helpRequests: helps.map((h) => ({
      id: h.id,
      status: h.status,
      person: { id: h.person_id, firstName: h.first_name, lastName: h.last_name },
      homeTeam: h.home_team,
    })),
  });
});

const squadSchema = z.object({ personIds: z.array(z.number().int().positive()).max(40) });

squadRoutes.put("/events/:id/squad", async (c) => {
  const actor = requireActor(c);
  const { personIds: raw } = parse(squadSchema, await readJson(c.req.raw));
  const personIds = [...new Set(raw)];
  const { event, ctx, team } = await gameForCoach(c.env.DB, actor, intParam(c, "id"));
  const db = c.env.DB;
  if (event.cancelled_at) throw conflict(t`The game is not taking place.`);
  if (localToInstant(event.starts_at) <= Date.now()) throw conflict(t`The game has already started.`);
  const max = team.max_squad;
  if (personIds.length > max) throw badRequest(t`At most ${max} players can be nominated.`);

  const allowed = await all<{ person_id: number; is_active: number; via_help: number }>(
    db,
    `SELECT p.id AS person_id, p.is_active, 0 AS via_help FROM team_memberships tm JOIN persons p ON p.id = tm.person_id
      WHERE tm.team_id = ? AND tm.role IN ('player', 'helper') AND p.is_former = 0
     UNION
     SELECT p.id, p.is_active, 1 FROM help_requests h JOIN persons p ON p.id = h.person_id
      WHERE h.event_id = ? AND h.status = 'accepted' AND p.is_former = 0`,
    team.id,
    event.id,
  );
  const allowedMap = new Map(allowed.map((a) => [a.person_id, a]));
  for (const id of personIds) {
    const a = allowedMap.get(id);
    if (!a) throw badRequest(t`At least one person does not belong to the squad of this team.`);
    if (a.is_active !== 1) throw badRequest(t`Inactive players cannot be nominated.`);
  }

  const current = ctx.nominations.get(event.id) ?? new Map();
  const added = personIds.filter((id) => !current.has(id));
  const removed = [...current.keys()].filter((id) => !personIds.includes(id));
  const helperIds = new Set(
    (await all<{ person_id: number }>(db, "SELECT person_id FROM team_memberships WHERE team_id = ? AND role = 'helper'", team.id)).map((r) => r.person_id),
  );

  const statements = [
    ...added.map((id) =>
      stmt(
        db,
        "INSERT OR IGNORE INTO nominations (event_id, person_id, is_helper) VALUES (?, ?, ?)",
        event.id,
        id,
        helperIds.has(id) || allowedMap.get(id)?.via_help === 1 ? 1 : 0,
      ),
    ),
    ...removed.map((id) => stmt(db, "DELETE FROM nominations WHERE event_id = ? AND person_id = ?", event.id, id)),
    ...removed.map((id) => stmt(db, "DELETE FROM responses WHERE event_id = ? AND person_id = ?", event.id, id)),
    stmt(db, "UPDATE events SET squad_published_at = coalesce(squad_published_at, ?), squad_manual = 1 WHERE id = ?", utcIso(), event.id),
  ];
  await db.batch(statements);
  await moduleParticipantsLeft(c.env, { event, ctx, teamIds: ctx.eventTeams.get(event.id) ?? [], personIds: removed, exclude: [actor.accountId] });

  const teamRefs = [{ id: team.id, name: team.name }];
  const texts = () => ({ title: eventTitle(event, teamRefs), when: `${shortDate(event.starts_at)}, ${shortTime(event.starts_at)}` });
  await notifyPersons(
    c.env,
    added,
    "squad",
    () => {
      const { title, when } = texts();
      return { title: t`You have been nominated`, body: t`${title} on ${when}. If you can't make it, please decline.`, url: `/termine/${event.id}` };
    },
    { teamIds: [team.id], exclude: [actor.accountId] },
  );
  await notifyPersons(
    c.env,
    removed,
    "squad",
    () => {
      const { title, when } = texts();
      return { title: t`Squad changed`, body: t`You are no longer in the squad for ${title} on ${when}.`, url: `/termine/${event.id}` };
    },
    { teamIds: [team.id], exclude: [actor.accountId] },
  );
  return c.json({ ok: true, added: added.length, removed: removed.length });
});

/** Puts a squad edited by hand back on automatic from the core squad. */
squadRoutes.post("/events/:id/squad/auto", async (c) => {
  const actor = requireActor(c);
  const { event, team } = await gameForCoach(c.env.DB, actor, intParam(c, "id"));
  if (team.auto_squad !== 1) throw conflict(t`The automatic squad is switched off for this team.`);
  if (localToInstant(event.starts_at) <= Date.now()) throw conflict(t`The game has already started.`);
  await run(c.env.DB, "UPDATE events SET squad_manual = 0 WHERE id = ?", event.id);
  await syncAutoSquads(c.env.DB, [team.id]);
  return c.json({ ok: true });
});

// Ad-hoc helpers -----------------------------------------------------------------

export interface TeamCandidate {
  person_id: number;
  first_name: string;
  last_name: string | null;
  is_active: number;
  /** All matching teams of the person (e.g. wC1 and wC2) */
  team_ids: number[];
  team_name: string;
  /** The same teams with core squad membership, for the picker in the app */
  teams: CandidateTeam[];
}

export interface CandidateTeam {
  id: number;
  name: string;
  /** In the core squad of this team */
  core: boolean;
}

/**
 * Candidates from other teams, one row per person.
 * - help: lower-ranked team of the same age class (higher level, e.g. wC3 for the wC2) or the next lower age class,
 *   without everyone already in the team.
 * - player: any other team of the same age class or the next lower one, without those who already play here
 *   (so a helper can become a player).
 */
export async function teamCandidates(db: D1Database, teamId: number, mode: "help" | "player"): Promise<TeamCandidate[]> {
  const team = await first<{ id: number; age_class_code: string; level: number; gender: string }>(
    db,
    "SELECT id, age_class_code, level, gender FROM teams WHERE id = ?",
    teamId,
  );
  if (!team) return [];
  const ac = await ageClassFor(db, team.age_class_code);
  const rows = await all<{ person_id: number; first_name: string; last_name: string | null; is_active: number; team_id: number; team_name: string; is_core: number }>(
    db,
    `SELECT DISTINCT p.id AS person_id, p.first_name, p.last_name, p.is_active, t.id AS team_id, t.name AS team_name,
            EXISTS (SELECT 1 FROM core_squad cs WHERE cs.team_id = t.id AND cs.person_id = p.id) AS is_core
       FROM teams t
       JOIN team_memberships tm ON tm.team_id = t.id AND tm.role = 'player'
       JOIN persons p ON p.id = tm.person_id AND p.is_former = 0
       LEFT JOIN age_classes ac ON ac.code = t.age_class_code AND ac.season_id = (SELECT id FROM seasons WHERE is_current = 1)
      WHERE t.id <> ?1
        AND ((t.age_class_code = ?2 AND (?6 = 'player' OR t.level > ?3))
             OR (ac.rank = ?4 - 1 AND (t.gender = ?5 OR t.gender = 'x' OR ?5 = 'x')))
        AND NOT EXISTS (SELECT 1 FROM team_memberships own WHERE own.team_id = ?1 AND own.person_id = p.id
                          AND (?6 = 'help' OR own.role = 'player'))
      ORDER BY p.first_name, p.last_name, p.id, t.name`,
    team.id,
    team.age_class_code,
    team.level,
    ac?.rank ?? -99,
    team.gender,
    mode,
  );
  const byPerson = new Map<number, TeamCandidate>();
  for (const r of rows) {
    const c = byPerson.get(r.person_id);
    const team = { id: r.team_id, name: r.team_name, core: r.is_core === 1 };
    if (c) {
      c.team_ids.push(r.team_id);
      c.team_name += ` · ${r.team_name}`;
      c.teams.push(team);
    } else {
      byPerson.set(r.person_id, {
        person_id: r.person_id,
        first_name: r.first_name,
        last_name: r.last_name,
        is_active: r.is_active,
        team_ids: [r.team_id],
        team_name: r.team_name,
        teams: [team],
      });
    }
  }
  return [...byPerson.values()];
}

/** Players from lower-ranked teams of the same age class or the next lower age class. */
export function helpCandidates(db: D1Database, teamId: number) {
  return teamCandidates(db, teamId, "help");
}

squadRoutes.get("/events/:id/help-candidates", async (c) => {
  const actor = requireActor(c);
  const { event, team } = await gameForCoach(c.env.DB, actor, intParam(c, "id"));
  const candidates = await helpCandidates(c.env.DB, team.id);
  const conflicts = await overlappingNominations(c.env.DB, event, candidates.map((r) => r.person_id));
  const requested = new Set(
    (await all<{ person_id: number }>(c.env.DB, "SELECT person_id FROM help_requests WHERE event_id = ? AND status <> 'withdrawn'", event.id)).map(
      (r) => r.person_id,
    ),
  );
  return c.json({
    candidates: candidates
      .filter((r) => r.is_active === 1)
      .map((r) => ({
        person: { id: r.person_id, firstName: r.first_name, lastName: r.last_name },
        team: { id: r.team_ids[0]!, name: r.team_name },
        teams: r.teams,
        conflict: conflicts.get(r.person_id) ?? null,
        requested: requested.has(r.person_id),
      })),
  });
});

const helpSchema = z.object({ personId: z.number().int().positive() });

squadRoutes.post("/events/:id/help-requests", async (c) => {
  const actor = requireActor(c);
  const { personId } = parse(helpSchema, await readJson(c.req.raw));
  const { event, team } = await gameForCoach(c.env.DB, actor, intParam(c, "id"));
  if (event.cancelled_at || localToInstant(event.starts_at) <= Date.now()) throw conflict(t`Requests are no longer possible for this game.`);
  const candidate = (await helpCandidates(c.env.DB, team.id)).find((r) => r.person_id === personId);
  if (!candidate) throw badRequest(t`This person cannot be requested for this team.`);
  if (candidate.is_active !== 1) throw badRequest(t`Inactive players cannot be requested.`);
  const existing = await first<{ id: number; status: string }>(c.env.DB, "SELECT id, status FROM help_requests WHERE event_id = ? AND person_id = ?", event.id, personId);
  if (existing && existing.status !== "withdrawn") throw conflict(t`This person has already been requested.`);
  if (existing) {
    await run(
      c.env.DB,
      "UPDATE help_requests SET status = 'open', team_id = ?, requested_by = ?, answered_by = NULL, answered_at = NULL, created_at = ? WHERE id = ?",
      team.id,
      actor.personId,
      utcIso(),
      existing.id,
    );
  } else {
    await run(
      c.env.DB,
      "INSERT INTO help_requests (event_id, person_id, team_id, requested_by) VALUES (?, ?, ?, ?)",
      event.id,
      personId,
      team.id,
      actor.personId,
    );
  }
  const whenText = () => `${shortDate(event.starts_at)}, ${shortTime(event.starts_at)}`;
  const actorName = actor.firstName;
  const playerName = candidate.first_name;
  const teamName = team.name;
  await notifyPersons(
    c.env,
    [personId],
    "squad",
    () => {
      const when = whenText();
      return {
        title: t`Help out ${teamName}?`,
        body: t`${actorName} asks whether ${playerName} can help out ${teamName} on ${when}.`,
        url: `/termine/${event.id}`,
      };
    },
    { teamIds: [team.id] },
  );
  await notifyCoaches(
    c.env,
    candidate.team_ids,
    () => {
      const when = whenText();
      return {
        title: t`Help request`,
        body: t`${actorName} (${teamName}) asks ${playerName} to help out in the game on ${when}.`,
        url: `/termine/${event.id}`,
      };
    },
    { exclude: [actor.accountId] },
  );
  return c.json({ ok: true }, 201);
});

const answerSchema = z.object({ accept: z.boolean() });

squadRoutes.post("/help-requests/:id/answer", async (c) => {
  const actor = requireActor(c);
  const { accept } = parse(answerSchema, await readJson(c.req.raw));
  const help = await first<{ id: number; event_id: number; person_id: number; team_id: number; status: string; team_name: string; first_name: string }>(
    c.env.DB,
    `SELECT h.id, h.event_id, h.person_id, h.team_id, h.status, t.name AS team_name, p.first_name
       FROM help_requests h JOIN teams t ON t.id = h.team_id JOIN persons p ON p.id = h.person_id WHERE h.id = ?`,
    intParam(c, "id"),
  );
  if (!help) throw notFound(t`This request does not exist.`);
  requireActFor(actor, help.person_id, "may_answer_help", [help.team_id]);
  if (help.status !== "open") throw conflict(t`This request has already been answered.`);
  const event = (await loadEvent(c.env.DB, help.event_id))!;
  if (event.cancelled_at || localToInstant(event.starts_at) <= Date.now()) throw conflict(t`The game is over or not taking place.`);

  const now = utcIso();
  const statements = [
    stmt(
      c.env.DB,
      "UPDATE help_requests SET status = ?, answered_by = ?, answered_at = ? WHERE id = ?",
      accept ? "accepted" : "declined",
      actor.accountId,
      now,
      help.id,
    ),
  ];
  if (accept) {
    statements.push(
      stmt(c.env.DB, "INSERT OR IGNORE INTO nominations (event_id, person_id, is_helper) VALUES (?, ?, 1)", help.event_id, help.person_id),
      stmt(
        c.env.DB,
        `INSERT INTO responses (event_id, person_id, status, by_account, by_person, responded_at) VALUES (?, ?, 'yes', ?, ?, ?)
         ON CONFLICT(event_id, person_id) DO UPDATE SET status = 'yes', reason = NULL, is_late = 0,
           by_account = excluded.by_account, by_person = excluded.by_person, responded_at = excluded.responded_at`,
        help.event_id,
        help.person_id,
        actor.accountId,
        actor.personId,
        now,
      ),
    );
  }
  await c.env.DB.batch(statements);
  const playerName = help.first_name;
  const teamName = help.team_name;
  await notifyCoaches(
    c.env,
    [help.team_id],
    () => {
      const date = shortDate(event.starts_at);
      return {
        title: accept ? t`Help accepted` : t`Help declined`,
        body: accept ? t`${playerName} will help out ${teamName} on ${date}.` : t`${playerName} will not help out ${teamName} on ${date}.`,
        url: `/termine/${event.id}`,
      };
    },
    { exclude: [actor.accountId] },
  );
  return c.json({ ok: true });
});

squadRoutes.delete("/help-requests/:id", async (c) => {
  const actor = requireActor(c);
  const help = await first<{ id: number; event_id: number; person_id: number; team_id: number; status: string; team_name: string }>(
    c.env.DB,
    "SELECT h.id, h.event_id, h.person_id, h.team_id, h.status, t.name AS team_name FROM help_requests h JOIN teams t ON t.id = h.team_id WHERE h.id = ?",
    intParam(c, "id"),
  );
  if (!help) throw notFound(t`This request does not exist.`);
  if (!isCoachOfAny(actor, [help.team_id])) throw forbidden();
  const event = (await loadEvent(c.env.DB, help.event_id))!;
  await c.env.DB.batch([
    stmt(c.env.DB, "UPDATE help_requests SET status = 'withdrawn' WHERE id = ?", help.id),
    stmt(c.env.DB, "DELETE FROM nominations WHERE event_id = ? AND person_id = ? AND is_helper = 1", help.event_id, help.person_id),
    stmt(c.env.DB, "DELETE FROM responses WHERE event_id = ? AND person_id = ?", help.event_id, help.person_id),
    ...moduleParticipantsDropped(c.env.DB, { select: "SELECT ?, ?", params: [help.event_id, help.person_id] }),
  ]);
  if (localToInstant(event.starts_at) > Date.now()) {
    const teamName = help.team_name;
    await notifyPersons(
      c.env,
      [help.person_id],
      "squad",
      () => {
        const date = shortDate(event.starts_at);
        return {
          title: t`Request withdrawn`,
          body: t`The help request from ${teamName} for ${date} has been withdrawn.`,
          url: `/termine`,
        };
      },
      { teamIds: [help.team_id] },
    );
  }
  return c.json({ ok: true });
});
