import { Hono } from "hono";
import { z } from "zod";
import type { PersonRef } from "../../shared/types";
import { type AppEnv, intParam, requireActor } from "../app";
import { type Actor, isCoachOf, isCoachOfAny, requireActFor } from "../auth/actor";
import { syncAutoSquads } from "../domain/auto-squad";
import { releaseRequests } from "../domain/carpool";
import { type EventRow, eventTeams, eventTitle, loadEvent, loadEventContext, toSummary } from "../domain/events";
import { notifyCoaches, notifyPersons, shortDate, shortTime } from "../domain/notify";
import { all, first, list, run, stmt } from "../lib/db";
import { badRequest, conflict, forbidden, notFound, parse, readJson } from "../lib/http";
import { addMinutesLocal, localToInstant, utcIso } from "../lib/time";

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
  if (!event || event.kind !== "game") throw notFound("Dieses Spiel gibt es nicht.");
  const ctx = await loadEventContext(db, [event]);
  const teams = eventTeams(event, ctx);
  const team = teams[0];
  if (!team) throw notFound("Dem Spiel ist keine Mannschaft zugeordnet.");
  if (!isCoachOf(actor, team.id)) throw forbidden("Den Kader nominieren nur Trainer dieser Mannschaft.");
  return { event, ctx, team };
}

/** Andere Spiele, die sich zeitlich überschneiden (±3 Stunden um den Anwurf). */
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
  // Alle überschneidenden Spiele je Person, z. B. bei Spielern in wC1 und wC2
  const parts = new Map<number, string[]>();
  for (const r of rows.sort((a, b) => a.starts_at.localeCompare(b.starts_at))) {
    parts.set(r.person_id, [...(parts.get(r.person_id) ?? []), `${r.team_name ?? "ein anderes Spiel"} (${r.starts_at.slice(11, 16)} Uhr)`]);
  }
  return new Map([...parts].map(([id, list]) => [id, `Zur selben Zeit für ${list.join(", ")} nominiert`]));
}

async function ageClassFor(db: D1Database, code: string) {
  return first<{ code: string; name: string; gender: string; rank: number; birth_year_min: number | null; birth_year_max: number | null; is_youth: number }>(
    db,
    `SELECT ac.code, ac.name, ac.gender, ac.rank, ac.birth_year_min, ac.birth_year_max, ac.is_youth
       FROM age_classes ac JOIN seasons s ON s.id = ac.season_id AND s.is_current = 1 WHERE ac.code = ?`,
    code,
  );
}

export function ageWarning(
  birthYear: number | null,
  ac: { name: string; birth_year_min: number | null; birth_year_max: number | null } | null,
): string | null {
  if (!ac || birthYear == null) return null;
  if (ac.birth_year_min != null && birthYear < ac.birth_year_min) return `Jahrgang ${birthYear} ist zu alt für die ${ac.name}`;
  if (ac.birth_year_max != null && birthYear > ac.birth_year_max) return `Jahrgang ${birthYear} passt nicht zur ${ac.name}`;
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

  // Hinweise aus dem letzten Training vor dem Spiel
  const trainingHints = new Map<number, string>();
  if (lastTraining) {
    const training = (await loadEvent(db, lastTraining.id))!;
    const tctx = await loadEventContext(db, [training]);
    const day = shortDate(training.starts_at).slice(0, 2);
    for (const p of tctx.participants.get(training.id) ?? []) {
      const text =
        p.status === "yes"
          ? `Training ${day} zugesagt`
          : p.status === "no"
            ? p.response?.is_late
              ? `Training ${day} kurzfristig abgesagt`
              : `Training ${day} abgesagt`
            : p.status === "standing"
              ? `${day === "Fr" ? "Freitags" : `Training ${day}`} dauerhaft abwesend`
              : p.status === "open"
                ? "Keine Rückmeldung zum Training"
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
    // Automatisch aus dem Stammkader, solange der Trainer diesen Kader nicht selbst bearbeitet
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
        hint: m.is_active !== 1 ? "Inaktiv, nicht nominierbar" : (trainingHints.get(m.person_id) ?? (isHelper ? "Aushilfe" : "")),
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
  if (event.cancelled_at) throw conflict("Das Spiel wurde abgesagt.");
  if (localToInstant(event.starts_at) <= Date.now()) throw conflict("Das Spiel hat schon begonnen.");
  if (personIds.length > team.max_squad) throw badRequest(`Höchstens ${team.max_squad} Spieler können nominiert werden.`);

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
    if (!a) throw badRequest("Mindestens eine Person gehört nicht zum Kader dieser Mannschaft.");
    if (a.is_active !== 1) throw badRequest("Inaktive Spieler können nicht nominiert werden.");
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
  await releaseRequests(c.env, { event, ctx, teamIds: ctx.eventTeams.get(event.id) ?? [] }, removed, [actor.accountId]);

  const title = eventTitle(event, [{ id: team.id, name: team.name }]);
  const when = `${shortDate(event.starts_at)}, ${shortTime(event.starts_at)}`;
  await notifyPersons(
    c.env,
    added,
    "squad",
    { title: "Du bist nominiert", body: `${title} am ${when}. Falls du nicht kannst, sag bitte ab.`, url: `/termine/${event.id}` },
    { teamIds: [team.id], exclude: [actor.accountId] },
  );
  await notifyPersons(
    c.env,
    removed,
    "squad",
    { title: "Kader geändert", body: `Für ${title} am ${when} bist du nicht mehr im Kader.`, url: `/termine/${event.id}` },
    { teamIds: [team.id], exclude: [actor.accountId] },
  );
  return c.json({ ok: true, added: added.length, removed: removed.length });
});

/** Einen von Hand bearbeiteten Kader wieder automatisch aus dem Stammkader führen. */
squadRoutes.post("/events/:id/squad/auto", async (c) => {
  const actor = requireActor(c);
  const { event, team } = await gameForCoach(c.env.DB, actor, intParam(c, "id"));
  if (team.auto_squad !== 1) throw conflict("Für diese Mannschaft ist der automatische Kader ausgeschaltet.");
  if (localToInstant(event.starts_at) <= Date.now()) throw conflict("Das Spiel hat schon begonnen.");
  await run(c.env.DB, "UPDATE events SET squad_manual = 0 WHERE id = ?", event.id);
  await syncAutoSquads(c.env.DB, [team.id]);
  return c.json({ ok: true });
});

// Ad-hoc-Aushilfe ---------------------------------------------------------------

export interface TeamCandidate {
  person_id: number;
  first_name: string;
  last_name: string | null;
  is_active: number;
  /** Alle passenden Mannschaften der Person (z. B. wC1 und wC2) */
  team_ids: number[];
  team_name: string;
}

/**
 * Kandidaten aus anderen Mannschaften, eine Zeile je Person.
 * - help: 2. Mannschaft derselben Altersklasse oder nächstniedrigere Altersklasse, ohne alle, die schon in der Mannschaft sind.
 * - player: jede andere Mannschaft derselben Altersklasse oder die nächstniedrigere, ohne die, die hier schon spielen
 *   (eine Aushilfe kann so zur Spielerin werden).
 */
export async function teamCandidates(db: D1Database, teamId: number, mode: "help" | "player"): Promise<TeamCandidate[]> {
  const team = await first<{ id: number; age_class_code: string; level: number }>(db, "SELECT id, age_class_code, level FROM teams WHERE id = ?", teamId);
  if (!team) return [];
  const ac = await ageClassFor(db, team.age_class_code);
  const rows = await all<{ person_id: number; first_name: string; last_name: string | null; is_active: number; team_id: number; team_name: string }>(
    db,
    `SELECT DISTINCT p.id AS person_id, p.first_name, p.last_name, p.is_active, t.id AS team_id, t.name AS team_name
       FROM teams t
       JOIN team_memberships tm ON tm.team_id = t.id AND tm.role = 'player'
       JOIN persons p ON p.id = tm.person_id AND p.is_former = 0
       LEFT JOIN age_classes ac ON ac.code = t.age_class_code AND ac.season_id = (SELECT id FROM seasons WHERE is_current = 1)
      WHERE t.id <> ?1
        AND ((t.age_class_code = ?2 AND (?6 = 'player' OR t.level > ?3))
             OR (ac.rank = ?4 - 1 AND (ac.gender = ?5 OR ac.gender = 'x' OR ?5 = 'x')))
        AND NOT EXISTS (SELECT 1 FROM team_memberships own WHERE own.team_id = ?1 AND own.person_id = p.id
                          AND (?6 = 'help' OR own.role = 'player'))
      ORDER BY p.first_name, p.last_name, p.id, t.name`,
    team.id,
    team.age_class_code,
    team.level,
    ac?.rank ?? -99,
    ac?.gender ?? "x",
    mode,
  );
  const byPerson = new Map<number, TeamCandidate>();
  for (const r of rows) {
    const c = byPerson.get(r.person_id);
    if (c) {
      c.team_ids.push(r.team_id);
      c.team_name += ` · ${r.team_name}`;
    } else {
      byPerson.set(r.person_id, { person_id: r.person_id, first_name: r.first_name, last_name: r.last_name, is_active: r.is_active, team_ids: [r.team_id], team_name: r.team_name });
    }
  }
  return [...byPerson.values()];
}

/** Spieler aus der 2. Mannschaft derselben Altersklasse oder der nächstniedrigeren Altersklasse. */
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
  if (event.cancelled_at || localToInstant(event.starts_at) <= Date.now()) throw conflict("Für dieses Spiel sind keine Anfragen mehr möglich.");
  const candidate = (await helpCandidates(c.env.DB, team.id)).find((r) => r.person_id === personId);
  if (!candidate) throw badRequest("Diese Person kann für diese Mannschaft nicht angefragt werden.");
  if (candidate.is_active !== 1) throw badRequest("Inaktive Spieler können nicht angefragt werden.");
  const existing = await first<{ id: number; status: string }>(c.env.DB, "SELECT id, status FROM help_requests WHERE event_id = ? AND person_id = ?", event.id, personId);
  if (existing && existing.status !== "withdrawn") throw conflict("Diese Person wurde bereits angefragt.");
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
  const when = `${shortDate(event.starts_at)}, ${shortTime(event.starts_at)}`;
  await notifyPersons(
    c.env,
    [personId],
    "squad",
    {
      title: `Aushilfe bei der ${team.name}?`,
      body: `${actor.firstName} fragt, ob ${candidate.first_name} am ${when} bei der ${team.name} aushelfen kann.`,
      url: `/termine/${event.id}`,
    },
    { teamIds: [team.id] },
  );
  await notifyCoaches(
    c.env,
    candidate.team_ids,
    {
      title: "Aushilfe-Anfrage",
      body: `${actor.firstName} (${team.name}) fragt ${candidate.first_name} für das Spiel am ${when} als Aushilfe an.`,
      url: `/termine/${event.id}`,
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
  if (!help) throw notFound("Diese Anfrage gibt es nicht.");
  requireActFor(actor, help.person_id, "may_answer_help", [help.team_id]);
  if (help.status !== "open") throw conflict("Diese Anfrage ist bereits beantwortet.");
  const event = (await loadEvent(c.env.DB, help.event_id))!;
  if (event.cancelled_at || localToInstant(event.starts_at) <= Date.now()) throw conflict("Das Spiel ist vorbei oder abgesagt.");

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
  await notifyCoaches(
    c.env,
    [help.team_id],
    {
      title: accept ? "Aushilfe zugesagt" : "Aushilfe abgelehnt",
      body: `${help.first_name} hilft am ${shortDate(event.starts_at)} ${accept ? "" : "nicht "}bei der ${help.team_name} aus.`,
      url: `/termine/${event.id}`,
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
  if (!help) throw notFound("Diese Anfrage gibt es nicht.");
  if (!isCoachOfAny(actor, [help.team_id])) throw forbidden();
  const event = (await loadEvent(c.env.DB, help.event_id))!;
  await c.env.DB.batch([
    stmt(c.env.DB, "UPDATE help_requests SET status = 'withdrawn' WHERE id = ?", help.id),
    stmt(c.env.DB, "DELETE FROM nominations WHERE event_id = ? AND person_id = ? AND is_helper = 1", help.event_id, help.person_id),
    stmt(c.env.DB, "DELETE FROM responses WHERE event_id = ? AND person_id = ?", help.event_id, help.person_id),
    stmt(c.env.DB, "DELETE FROM carpool_requests WHERE event_id = ? AND player_id = ?", help.event_id, help.person_id),
  ]);
  if (localToInstant(event.starts_at) > Date.now()) {
    await notifyPersons(
      c.env,
      [help.person_id],
      "squad",
      {
        title: "Anfrage zurückgezogen",
        body: `Die Aushilfe-Anfrage der ${help.team_name} für ${shortDate(event.starts_at)} wurde zurückgezogen.`,
        url: `/termine`,
      },
      { teamIds: [help.team_id] },
    );
  }
  return c.json({ ok: true });
});
