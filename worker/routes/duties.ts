// Helferplan-API. Regeln in worker/domain/duties.ts.
import { loadClub } from "../domain/club";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { type AppEnv, intParam, requireActor } from "../app";
import { type Actor, isCoachOf, isCoachOfAny, requireAdmin } from "../auth/actor";
import {
  blockFromItem,
  dutyManagers,
  type DutyType,
  ensureEventDuties,
  helperTeams,
  type HelperTeam,
  loadBlock,
  loadDutyTypes,
  mayManageDuties,
  mayTake,
  resetTeamDuties,
  publicHelperTeam,
  REFEREE_CODE,
  REFEREE_TEAM_SQL,
  refereeRoles,
  rolesFor,
  SHORT_NAME_SQL,
  skillConsents,
  templateItems,
} from "../domain/duties";
import { requireTeam } from "../domain/groups";
import { dutyHubStub, notifyDutyChange } from "../duties/hub";
import { notifyPersons, shortDate, shortTime } from "../domain/notify";
import { all, first, run, stmt } from "../lib/db";
import { badRequest, conflict, forbidden, notFound, parse, readJson } from "../lib/http";
import { addDays, addMinutesLocal, isDate, isLocalDateTime, isTime, nowLocal, todayLocal } from "../lib/time";

export const dutyRoutes = new Hono<AppEnv>();

/** Vergangene Spiele bleiben 90 Tage sichtbar (Top-Helfer, Rückblick). */
const PAST_DAYS = 90;

/** Live-Kanal der KiHaSL/JuHaSL-Ansicht (Mannschafts-IDs sind immer > 0). */
const REFEREE_HUB = 0;

dutyRoutes.get("/duties/teams", async (c) => {
  const actor = requireActor(c);
  return c.json({ teams: (await helperTeams(c.env.DB, actor)).map(publicHelperTeam) });
});

interface EventRow {
  id: number;
  kind: "game" | "special";
  starts_at: string;
  ends_at: string | null;
  is_home: number | null;
  home_team: string | null;
  guest_team: string | null;
  title: string | null;
  cancelled_at: string | null;
  duty_hidden: number;
  h4a_game_id: string | null;
  location_name: string | null;
  team_id?: number;
  team_name?: string;
}

interface BlockOut {
  id: number;
  event_id: number;
  duty_type_id: number;
  starts_at: string;
  ends_at: string;
  slots: number;
}

interface EntryRow {
  id: number;
  event_duty_id: number;
  person_id: number | null;
  name: string | null;
  child_id: number | null;
  child_name: string | null;
  manual_name: string | null;
  note: string | null;
}

async function loadBlocksAndEntries(db: D1Database, eventIds: number[]) {
  if (!eventIds.length) return { blocks: [] as BlockOut[], entries: [] as EntryRow[] };
  const ids = JSON.stringify(eventIds);
  const [blocks, entries] = await Promise.all([
    all<BlockOut>(db, "SELECT id, event_id, duty_type_id, starts_at, ends_at, slots FROM event_duties WHERE event_id IN (SELECT value FROM json_each(?)) ORDER BY starts_at, sort, id", ids),
    all<EntryRow>(
      db,
      `SELECT d.id, d.event_duty_id, d.person_id, ${SHORT_NAME_SQL("p")} AS name, d.child_id, ${SHORT_NAME_SQL("ch")} AS child_name, d.manual_name, d.note
         FROM duties d LEFT JOIN persons p ON p.id = d.person_id LEFT JOIN persons ch ON ch.id = d.child_id
        WHERE d.event_id IN (SELECT value FROM json_each(?)) ORDER BY d.id`,
      ids,
    ),
  ]);
  return { blocks, entries };
}

/** Ein Block für den Client: Dienstart, Zeit, Plätze, Einträge und ob/als wer man sich eintragen kann. */
function blockView(
  b: BlockOut,
  type: DutyType,
  entries: EntryRow[],
  actor: Actor,
  opts: { team: HelperTeam | null; refRoles: { childId: number | null; childName: string | null }[]; consents: Set<number>; past: boolean },
) {
  const childIds = new Set(actor.children.map((ch) => ch.id));
  const roles = type.whoReferees ? opts.refRoles : opts.team ? rolesFor(opts.team, type) : [];
  return {
    id: b.id,
    dutyTypeId: type.id,
    label: type.name,
    mode: type.mode,
    referee: type.whoReferees,
    special: type.eventId != null,
    startsAt: b.starts_at,
    endsAt: b.ends_at,
    total: b.slots,
    noteAllowed: type.noteAllowed,
    needsSkill: type.needsSkill,
    skillMissing: type.needsSkill && !opts.consents.has(type.id),
    roles: opts.past ? [] : roles,
    entries: entries
      .filter((x) => x.event_duty_id === b.id)
      .map((x) => ({
        id: x.id,
        name: x.manual_name ?? x.name ?? "?",
        child: x.child_id != null && x.child_id !== x.person_id ? x.child_name : null,
        note: x.note,
        mine: x.person_id === actor.personId,
        forMyChild: x.child_id != null && childIds.has(x.child_id),
      })),
  };
}

function eventView(e: EventRow, now: string) {
  return {
    id: e.id,
    kind: e.kind,
    startsAt: e.starts_at,
    endsAt: e.ends_at,
    isPast: e.starts_at < now,
    isHome: e.is_home == null ? null : e.is_home === 1,
    homeTeam: e.home_team,
    guestTeam: e.guest_team,
    title: e.title,
    location: e.location_name,
    cancelled: e.cancelled_at != null,
    hidden: e.duty_hidden === 1,
    manual: e.kind === "game" && e.h4a_game_id == null,
  };
}

dutyRoutes.get("/duties", async (c) => {
  const actor = requireActor(c);
  const teamId = Number(c.req.query("teamId"));
  const db = c.env.DB;
  const types = await loadDutyTypes(db);
  const team = (await helperTeams(db, actor, types)).find((t) => t.teamId === teamId);
  if (!team) throw forbidden("Für diese Mannschaft gibt es keinen Helferplan, oder du gehörst nicht dazu.");
  const from = `${addDays(todayLocal(), -PAST_DAYS)}T00:00`;
  const now = nowLocal();
  const helperPlan = (await first<{ helper_plan: number }>(db, "SELECT helper_plan FROM teams WHERE id = ?", teamId))?.helper_plan === 1;
  const events = await all<EventRow>(
    db,
    `SELECT e.id, e.kind, e.starts_at, e.ends_at, e.is_home, e.home_team, e.guest_team, e.title, e.cancelled_at, e.duty_hidden, e.h4a_game_id,
            l.name AS location_name
       FROM events e JOIN event_teams et ON et.event_id = e.id AND et.team_id = ?1
       LEFT JOIN locations l ON l.id = e.location_id
      WHERE e.starts_at >= ?2
        AND ((e.kind = 'game' AND ?4 = 1) OR (e.kind = 'special' AND EXISTS (SELECT 1 FROM event_duties ed WHERE ed.event_id = e.id)))
        AND (?3 = 1 OR (e.cancelled_at IS NULL AND (e.kind = 'special' OR e.duty_hidden = 0)))
      ORDER BY e.starts_at`,
    teamId,
    from,
    team.canManage ? 1 : 0,
    helperPlan ? 1 : 0,
  );
  await ensureEventDuties(db, events.filter((e) => e.kind === "game").map((e) => e.id), from);
  const eventIds = events.map((e) => e.id);
  const [{ blocks, entries }, allTypes, refRoles, consents, managers] = await Promise.all([
    loadBlocksAndEntries(db, eventIds),
    loadDutyTypes(db, eventIds),
    refereeRoles(db, actor),
    skillConsents(db, actor.accountId),
    dutyManagers(db, eventIds),
  ]);
  return c.json({
    team: publicHelperTeam(team),
    games: events.map((e) => {
      const past = e.starts_at < now;
      // Verwalten: Trainer dieser Mannschaft, oder (bei Sonderterminen mehrerer Mannschaften) Ersteller und Organisatoren
      const canManage = team.canManage || mayManageDuties(actor, [], managers.get(e.id));
      return {
        ...eventView(e, now),
        canManage,
        blocks: blocks
          .filter((b) => b.event_id === e.id && allTypes.has(b.duty_type_id))
          // Plätze auf 0: nur für Verwalter sichtbar (zum Wiederherstellen)
          .filter((b) => b.slots > 0 || canManage)
          .map((b) => blockView(b, allTypes.get(b.duty_type_id)!, entries, actor, { team, refRoles, consents, past })),
      };
    }),
  });
});

const signupSchema = z.object({
  blockId: z.number().int().positive(),
  childId: z.number().int().positive().nullable().optional(),
  note: z.string().trim().max(200).nullable().optional(),
  onBehalfPersonId: z.number().int().positive().optional(),
  manualName: z.string().trim().min(1).max(60).optional(),
});

dutyRoutes.post("/duties", async (c) => {
  const actor = requireActor(c);
  const db = c.env.DB;
  const input = parse(signupSchema, await readJson(c.req.raw));
  const block = await loadBlock(db, input.blockId);
  if (!block) throw notFound("Diesen Dienst gibt es nicht.");
  const types = await loadDutyTypes(db, [block.event_id]);
  const type = types.get(block.duty_type_id);
  if (!type) throw notFound("Diesen Dienst gibt es nicht.");
  if (block.event_starts_at < nowLocal()) throw badRequest("Der Termin liegt in der Vergangenheit.", "game_in_past");
  if (type.whoReferees) return refereeSignup(c, actor, block, input);

  const teams = (await helperTeams(db, actor, types)).filter((t) => block.teamIds.includes(t.teamId));
  const team = teams.find((t) => t.canManage) ?? teams[0];
  if (!team) throw forbidden("Für diese Mannschaft kannst du dich nicht eintragen.");
  if (block.cancelled_at || (block.duty_hidden && block.event_kind === "game" && !team.canManage) || block.slots === 0) {
    throw badRequest("Für diesen Termin gibt es diesen Dienst nicht.", "game_unavailable");
  }
  const note = type.noteAllowed ? input.note || null : null;

  let personId: number | null = null;
  let childId: number | null = null;
  let manualName: string | null = null;
  if (input.onBehalfPersonId != null || input.manualName != null) {
    if (!mayManageDuties(actor, block.teamIds, (await dutyManagers(db, [block.event_id])).get(block.event_id))) {
      throw forbidden("Andere eintragen dürfen nur Trainer, Admins und die Organisatoren des Termins.");
    }
    if (input.manualName != null) {
      manualName = input.manualName;
    } else {
      // Jede aktive Person im Verein, unabhängig von „Wer hilft“ und Vorkenntnissen
      const exists = await first(db, "SELECT 1 AS ok FROM persons WHERE id = ? AND is_former = 0", input.onBehalfPersonId!);
      if (!exists) throw badRequest("Diese Person gibt es nicht.", "unknown_person");
      personId = input.onBehalfPersonId!;
      childId = input.childId ?? null;
      if (childId != null) {
        const isChild = await first(db, "SELECT 1 AS ok FROM guardianships WHERE guardian_id = ? AND child_id = ?", personId, childId);
        if (!isChild) childId = null;
      }
    }
  } else {
    const allowed = teams.flatMap((t) => rolesFor(t, type));
    const roles = input.childId != null ? allowed.filter((r) => r.childId === input.childId) : allowed;
    if (!roles.length) {
      throw input.childId != null
        ? badRequest("Dieses Kind gehört nicht zur Mannschaft.", "child_not_in_team")
        : forbidden("Diesen Dienst übernehmen andere.", "not_allowed");
    }
    // Eingetragen ist immer man selbst; ein Kind der Mannschaft wird automatisch verknüpft (bei mehreren das erste),
    // damit das andere Elternteil den Dienst sieht
    personId = actor.personId;
    childId = input.childId ?? roles.find((r) => r.childId != null)?.childId ?? null;
    if (!mayTake(type, await skillConsents(db, actor.accountId))) {
      throw badRequest(`${type.name} kannst du übernehmen, wenn du es in deinem Profil unter „Das kann ich“ einschaltest.`, "skill_missing");
    }
  }
  await insertEntry(db, block, type, { personId, childId, manualName, note, createdBy: actor.personId });
  for (const t of block.teamIds) c.executionCtx.waitUntil(notifyDutyChange(c.env, t));
  return c.json({ ok: true }, 201);
});

/** Atomar: nur eintragen, solange im Block ein Platz frei ist. */
async function insertEntry(
  db: D1Database,
  block: { id: number; event_id: number },
  type: DutyType,
  e: { personId: number | null; childId: number | null; manualName: string | null; note: string | null; createdBy: number },
) {
  let res: D1Result;
  try {
    res = await run(
      db,
      `INSERT INTO duties (event_id, event_duty_id, duty_type_id, person_id, child_id, manual_name, note, created_by)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8
        WHERE (SELECT count(*) FROM duties WHERE event_duty_id = ?2) < (SELECT slots FROM event_duties WHERE id = ?2)`,
      block.event_id,
      block.id,
      type.id,
      e.personId,
      e.childId,
      e.manualName,
      e.note,
      e.createdBy,
    );
  } catch (err) {
    if (err instanceof Error && /UNIQUE/.test(err.message)) throw conflict("Du bist für diesen Dienst schon eingetragen.", "already_signed_up");
    throw err;
  }
  if (!res.meta.changes) throw conflict("Der Platz ist leider schon vergeben.", "slot_taken");
}

const REFEREE_UNAVAILABLE = "Für dieses Spiel braucht es keinen KiHaSL/JuHaSL.";

/** KiHaSL/JuHaSL eintragen: nur mit Rolle (selbst oder Kind), unabhängig von der Mannschaft. */
async function refereeSignup(c: Context<AppEnv>, actor: Actor, block: NonNullable<Awaited<ReturnType<typeof loadBlock>>>, input: z.infer<typeof signupSchema>) {
  const db = c.env.DB;
  if (block.cancelled_at || block.slots === 0) throw badRequest(REFEREE_UNAVAILABLE, "game_unavailable");
  const manage = isCoachOfAny(actor, block.teamIds);
  let personId: number | null = null;
  let childId: number | null = null;
  let manualName: string | null = null;
  if (input.onBehalfPersonId != null || input.manualName != null) {
    if (!manage) throw forbidden("Andere eintragen dürfen nur Trainer und Admins.");
    if (input.manualName != null) manualName = input.manualName;
    else {
      const isRef = await first(db, "SELECT 1 AS ok FROM referees WHERE person_id = ?", input.onBehalfPersonId!);
      if (!isRef) throw badRequest("Diese Person ist nicht als KiHaSL/JuHaSL freigeschaltet.", "not_referee");
      personId = input.onBehalfPersonId!;
    }
  } else {
    const roles = await refereeRoles(db, actor);
    const role = input.childId != null ? roles.find((r) => r.childId === input.childId) : roles.length === 1 ? roles[0] : roles.find((r) => r.childId == null);
    if (!role) {
      throw roles.length
        ? badRequest("Für wen trägst du dich ein?", "child_required")
        : forbidden("Als KiHaSL/JuHaSL eintragen kann sich nur, wer dafür freigeschaltet ist.", "not_referee");
    }
    // Wer pfeift, ist die Person im Eintrag. Für ein Kind zusätzlich child_id, damit die Eltern es sehen.
    personId = role.childId ?? actor.personId;
    childId = role.childId;
  }
  const type = (await loadDutyTypes(db)).get(block.duty_type_id)!;
  await insertEntry(db, block, type, { personId, childId, manualName, note: null, createdBy: actor.personId });
  for (const t of block.teamIds) c.executionCtx.waitUntil(notifyDutyChange(c.env, t));
  c.executionCtx.waitUntil(notifyDutyChange(c.env, REFEREE_HUB));
  return c.json({ ok: true }, 201);
}

/**
 * KiHaSL/JuHaSL: alle kommenden Jugend-Heimspiele F–C aller Mannschaften, mit dem Block.
 * Für alle mit Rolle (selbst oder Kind), Trainer und Admins.
 */
dutyRoutes.get("/duties/referee", async (c) => {
  const actor = requireActor(c);
  const db = c.env.DB;
  const refRoles = await refereeRoles(db, actor);
  if (!refRoles.length && !actor.isAdmin && !actor.coachTeamIds.length) throw forbidden();
  const today = `${todayLocal()}T00:00`;
  const candidates = await all<{ id: number }>(
    db,
    `SELECT e.id FROM events e JOIN teams t ON t.id = (SELECT et.team_id FROM event_teams et WHERE et.event_id = e.id ORDER BY et.team_id LIMIT 1)
      WHERE e.kind = 'game' AND e.is_home = 1 AND ${REFEREE_TEAM_SQL("t")} AND e.starts_at >= ? AND e.cancelled_at IS NULL`,
    today,
  );
  await ensureEventDuties(db, candidates.map((x) => x.id), today);
  const events = await all<EventRow>(
    db,
    `SELECT e.id, e.kind, e.starts_at, e.ends_at, e.is_home, e.home_team, e.guest_team, e.title, e.cancelled_at, e.duty_hidden, e.h4a_game_id,
            l.name AS location_name, t.id AS team_id, t.name AS team_name
       FROM events e
       JOIN teams t ON t.id = (SELECT et.team_id FROM event_teams et WHERE et.event_id = e.id ORDER BY et.team_id LIMIT 1)
       LEFT JOIN locations l ON l.id = e.location_id
      WHERE e.starts_at >= ? AND e.cancelled_at IS NULL
        AND EXISTS (SELECT 1 FROM event_duties ed JOIN duty_types dt ON dt.id = ed.duty_type_id AND dt.who_referees = 1 WHERE ed.event_id = e.id)
      ORDER BY e.starts_at`,
    today,
  );
  const eventIds = events.map((e) => e.id);
  const [{ blocks, entries }, types] = await Promise.all([loadBlocksAndEntries(db, eventIds), loadDutyTypes(db, eventIds)]);
  const now = nowLocal();
  return c.json({
    team: { teamId: 0, teamName: "KiHaSL/JuHaSL", canManage: actor.isAdmin, roles: refRoles, own: true },
    games: events.map((e) => ({
      ...eventView(e, now),
      teamId: e.team_id,
      teamName: e.team_name,
      canManage: isCoachOf(actor, e.team_id!),
      hidden: false,
      blocks: blocks
        .filter((b) => b.event_id === e.id && types.get(b.duty_type_id)?.whoReferees && (b.slots > 0 || isCoachOf(actor, e.team_id!)))
        .map((b) => blockView(b, types.get(b.duty_type_id)!, entries, actor, { team: null, refRoles, consents: new Set(), past: e.starts_at < now })),
    })),
  });
});

/** Alle mit der Rolle, für „jemanden eintragen“ (Trainer und Admins). */
dutyRoutes.get("/duties/referee/people", async (c) => {
  const actor = requireActor(c);
  if (!actor.isAdmin && !actor.coachTeamIds.length) throw forbidden();
  const people = await all<{ id: number; name: string }>(
    c.env.DB,
    `SELECT p.id, ${SHORT_NAME_SQL("p")} AS name FROM referees r JOIN persons p ON p.id = r.person_id AND p.is_former = 0 ORDER BY 2`,
  );
  return c.json({ people: people.map((p) => ({ personId: p.id, name: p.name, childId: null, childName: null })) });
});

dutyRoutes.get("/duties/referee/live", async (c) => {
  const actor = requireActor(c);
  if (c.req.header("upgrade")?.toLowerCase() !== "websocket") throw badRequest("Erwarte eine WebSocket-Verbindung.");
  if (!(await refereeRoles(c.env.DB, actor)).length && !actor.isAdmin && !actor.coachTeamIds.length) throw forbidden();
  return dutyHubStub(c.env, REFEREE_HUB).fetch(new Request("https://duties.internal/connect", { headers: c.req.raw.headers }));
});

async function loadEntry(db: D1Database, id: number) {
  const row = await first<{
    id: number;
    event_id: number;
    event_duty_id: number;
    person_id: number | null;
    child_id: number | null;
    starts_at: string;
    note_allowed: number;
    who_referees: number;
    team_ids: string;
  }>(
    db,
    `SELECT d.id, d.event_id, d.event_duty_id, d.person_id, d.child_id, e.starts_at, dt.note_allowed, dt.who_referees,
            (SELECT json_group_array(team_id) FROM (SELECT et.team_id FROM event_teams et WHERE et.event_id = e.id ORDER BY et.team_id)) AS team_ids
       FROM duties d JOIN events e ON e.id = d.event_id JOIN duty_types dt ON dt.id = d.duty_type_id WHERE d.id = ?`,
    id,
  );
  return row ? { ...row, teamIds: JSON.parse(row.team_ids) as number[] } : null;
}

async function mayManageEntry(db: D1Database, actor: Actor, entry: { event_id: number; teamIds: number[] }) {
  return mayManageDuties(actor, entry.teamIds, (await dutyManagers(db, [entry.event_id])).get(entry.event_id));
}

dutyRoutes.patch("/duties/:id", async (c) => {
  const actor = requireActor(c);
  const entry = await loadEntry(c.env.DB, intParam(c, "id"));
  if (!entry) throw notFound("Diesen Eintrag gibt es nicht.");
  if (entry.person_id !== actor.personId && !(await mayManageEntry(c.env.DB, actor, entry))) throw forbidden();
  if (entry.note_allowed !== 1) throw badRequest("Bei diesem Dienst gibt es keine Notiz.");
  const { note } = parse(z.object({ note: z.string().trim().max(200).nullable() }), await readJson(c.req.raw));
  await run(c.env.DB, "UPDATE duties SET note = ? WHERE id = ?", note || null, entry.id);
  for (const t of entry.teamIds) c.executionCtx.waitUntil(notifyDutyChange(c.env, t));
  return c.json({ ok: true });
});

dutyRoutes.delete("/duties/:id", async (c) => {
  const actor = requireActor(c);
  const entry = await loadEntry(c.env.DB, intParam(c, "id"));
  if (!entry) throw notFound("Diesen Eintrag gibt es nicht.");
  const manage = await mayManageEntry(c.env.DB, actor, entry);
  const own = entry.person_id === actor.personId || (entry.child_id != null && actor.children.some((ch) => ch.id === entry.child_id));
  if (!manage && !own) throw forbidden();
  if (!manage && entry.starts_at < nowLocal()) throw badRequest("Der Termin liegt in der Vergangenheit.", "game_in_past");
  await run(c.env.DB, "DELETE FROM duties WHERE id = ?", entry.id);
  for (const t of entry.teamIds) c.executionCtx.waitUntil(notifyDutyChange(c.env, t));
  if (entry.who_referees === 1) c.executionCtx.waitUntil(notifyDutyChange(c.env, REFEREE_HUB));
  return c.json({ ok: true });
});

// Blöcke verwalten (Trainer und Admins) ------------------------------------------

async function managedEvent(db: D1Database, actor: Actor, eventId: number) {
  const e = await first<{ id: number; kind: string; starts_at: string; ends_at: string | null; team_ids: string }>(
    db,
    `SELECT e.id, e.kind, e.starts_at, e.ends_at,
            (SELECT json_group_array(team_id) FROM (SELECT et.team_id FROM event_teams et WHERE et.event_id = e.id ORDER BY et.team_id)) AS team_ids
       FROM events e WHERE e.id = ?`,
    eventId,
  );
  if (!e || (e.kind !== "game" && e.kind !== "special")) throw notFound("Diesen Termin gibt es nicht.");
  const teamIds = JSON.parse(e.team_ids) as number[];
  if (!teamIds.length) throw badRequest("Helfer gibt es nur bei Terminen von Mannschaften.");
  if (!mayManageDuties(actor, teamIds, (await dutyManagers(db, [e.id])).get(e.id))) throw forbidden("Das dürfen nur Trainer dieser Mannschaft und die Organisatoren des Termins.");
  return { ...e, teamIds };
}

const blockTimeSchema = z.string().refine(isLocalDateTime, "Ungültige Uhrzeit.");
const slotsSchema = z.number().int().min(0).max(20);

const newBlockSchema = z
  .object({
    dutyTypeId: z.number().int().positive().optional(),
    /** Sonderdienst nur für diesen Termin (Trainer dürfen das bei Sonderterminen) */
    newTypeName: z.string().trim().min(1).max(40).optional(),
    startsAt: blockTimeSchema,
    endsAt: blockTimeSchema,
    slots: slotsSchema,
  })
  .refine((v) => (v.dutyTypeId == null) !== (v.newTypeName == null), "Bitte einen Dienst wählen.");

/** Zeitblock anlegen. Mit newTypeName entsteht ein Sonderdienst nur für diesen Termin. */
dutyRoutes.post("/duties/events/:id/blocks", async (c) => {
  const actor = requireActor(c);
  const db = c.env.DB;
  const event = await managedEvent(db, actor, intParam(c, "id"));
  const input = parse(newBlockSchema, await readJson(c.req.raw));
  if (input.endsAt < input.startsAt) throw badRequest("Das Ende muss nach dem Beginn liegen.");
  let typeId = input.dutyTypeId ?? null;
  if (typeId != null) {
    const type = (await loadDutyTypes(db, [event.id])).get(typeId);
    if (!type || type.archived || (type.eventId != null && type.eventId !== event.id)) throw badRequest("Diesen Dienst gibt es nicht.");
  } else {
    const row = await first<{ id: number }>(
      db,
      "INSERT INTO duty_types (name, mode, who_parents, event_id, sort) VALUES (?, 'onsite', 1, ?, 50) RETURNING id",
      input.newTypeName!,
      event.id,
    );
    typeId = row!.id;
  }
  const row = await first<{ id: number }>(
    db,
    "INSERT INTO event_duties (event_id, duty_type_id, starts_at, ends_at, slots, sort) VALUES (?, ?, ?, ?, ?, 50) RETURNING id",
    event.id,
    typeId,
    input.startsAt,
    input.endsAt,
    input.slots,
  );
  for (const t of event.teamIds) c.executionCtx.waitUntil(notifyDutyChange(c.env, t));
  return c.json({ id: row!.id }, 201);
});

const updateBlockSchema = z.object({ startsAt: blockTimeSchema.optional(), endsAt: blockTimeSchema.optional(), slots: slotsSchema.optional() });

dutyRoutes.patch("/duties/blocks/:id", async (c) => {
  const actor = requireActor(c);
  const db = c.env.DB;
  const block = await loadBlock(db, intParam(c, "id"));
  if (!block) throw notFound("Diesen Dienst gibt es nicht.");
  if (!mayManageDuties(actor, block.teamIds, (await dutyManagers(db, [block.event_id])).get(block.event_id))) {
    throw forbidden("Das dürfen nur Trainer dieser Mannschaft und die Organisatoren des Termins.");
  }
  const input = parse(updateBlockSchema, await readJson(c.req.raw));
  const startsAt = input.startsAt ?? block.starts_at;
  const endsAt = input.endsAt ?? block.ends_at;
  if (endsAt < startsAt) throw badRequest("Das Ende muss nach dem Beginn liegen.");
  if (input.slots != null) {
    const taken = await first<{ n: number }>(db, "SELECT count(*) AS n FROM duties WHERE event_duty_id = ?", block.id);
    if (input.slots < (taken?.n ?? 0)) throw badRequest("Es sind schon mehr Personen eingetragen. Bitte zuerst jemanden austragen.", "slots_below_entries");
  }
  await run(db, "UPDATE event_duties SET starts_at = ?, ends_at = ?, slots = ? WHERE id = ?", startsAt, endsAt, input.slots ?? block.slots, block.id);
  for (const t of block.teamIds) c.executionCtx.waitUntil(notifyDutyChange(c.env, t));
  c.executionCtx.waitUntil(notifyDutyChange(c.env, REFEREE_HUB));
  return c.json({ ok: true });
});

dutyRoutes.delete("/duties/blocks/:id", async (c) => {
  const actor = requireActor(c);
  const db = c.env.DB;
  const block = await loadBlock(db, intParam(c, "id"));
  if (!block) throw notFound("Diesen Dienst gibt es nicht.");
  if (!mayManageDuties(actor, block.teamIds, (await dutyManagers(db, [block.event_id])).get(block.event_id))) {
    throw forbidden("Das dürfen nur Trainer dieser Mannschaft und die Organisatoren des Termins.");
  }
  const taken = await first<{ n: number }>(db, "SELECT count(*) AS n FROM duties WHERE event_duty_id = ?", block.id);
  if ((taken?.n ?? 0) > 0) throw badRequest("Für diesen Dienst haben sich schon Personen eingetragen. Bitte zuerst austragen.", "block_has_entries");
  await db.batch([
    stmt(db, "DELETE FROM event_duties WHERE id = ?", block.id),
    // Sonderdienst ohne weitere Blöcke mit entfernen
    stmt(db, "DELETE FROM duty_types WHERE id = ? AND event_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM event_duties WHERE duty_type_id = ?)", block.duty_type_id, block.duty_type_id),
  ]);
  for (const t of block.teamIds) c.executionCtx.waitUntil(notifyDutyChange(c.env, t));
  return c.json({ ok: true });
});

/** Vorlage auf einen Termin anwenden (Sondertermine), Zeiten ab Beginn und Ende des Termins. */
dutyRoutes.post("/duties/events/:id/apply-template", async (c) => {
  const actor = requireActor(c);
  const db = c.env.DB;
  const event = await managedEvent(db, actor, intParam(c, "id"));
  const { templateId } = parse(z.object({ templateId: z.number().int().positive() }), await readJson(c.req.raw));
  const items = await templateItems(db, templateId);
  if (!items.length) throw badRequest("Diese Vorlage ist leer oder gibt es nicht.");
  const types = await loadDutyTypes(db);
  const end = event.ends_at ?? addMinutesLocal(event.starts_at, 120);
  const statements = items
    .map((item, i) => ({ item, i, type: types.get(item.dutyTypeId) }))
    .filter((x) => x.type && !x.type.archived && !x.type.whoReferees)
    .map(({ item, i, type }) => {
      const b = blockFromItem(item, type!.mode, event.starts_at, end);
      return stmt(db, "INSERT INTO event_duties (event_id, duty_type_id, starts_at, ends_at, slots, sort) VALUES (?, ?, ?, ?, ?, ?)", event.id, type!.id, b.startsAt, b.endsAt, item.slots, i + 1);
    });
  if (statements.length) await db.batch(statements);
  for (const t of event.teamIds) c.executionCtx.waitUntil(notifyDutyChange(c.env, t));
  return c.json({ ok: true, created: statements.length });
});

dutyRoutes.patch("/duties/games/:id", async (c) => {
  const actor = requireActor(c);
  const event = await managedEvent(c.env.DB, actor, intParam(c, "id"));
  const { hidden } = parse(z.object({ hidden: z.boolean() }), await readJson(c.req.raw));
  await run(c.env.DB, "UPDATE events SET duty_hidden = ? WHERE id = ?", hidden ? 1 : 0, event.id);
  for (const t of event.teamIds) c.executionCtx.waitUntil(notifyDutyChange(c.env, t));
  return c.json({ ok: true });
});

/** Mögliche Personen für "jemanden eintragen": Eltern der Spieler, Spieler, Trainer. */
dutyRoutes.get("/duties/teams/:id/people", async (c) => {
  const actor = requireActor(c);
  const teamId = intParam(c, "id");
  if (!isCoachOf(actor, teamId)) throw forbidden();
  const q = (c.req.query("q") ?? "").trim().toLowerCase();
  if (q.length >= 2) {
    // Suche im ganzen Verein (nur Trainer und Admins): Kurzname und Mannschaften, kein Jahrgang
    const like = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    const found = await all<{ id: number; name: string; teams: string | null }>(
      c.env.DB,
      `SELECT p.id, ${SHORT_NAME_SQL("p")} AS name,
              (SELECT group_concat(t.name, ', ') FROM team_memberships tm JOIN teams t ON t.id = tm.team_id AND t.kind = 'team' WHERE tm.person_id = p.id) AS teams
         FROM persons p
        WHERE p.is_former = 0
          AND (lower(p.first_name || ' ' || coalesce(p.last_name, '')) LIKE ?1 ESCAPE '\\' OR lower(coalesce(p.last_name, '')) LIKE ?1 ESCAPE '\\')
        ORDER BY p.first_name, p.last_name LIMIT 20`,
      like,
    );
    return c.json({ people: found.map((p) => ({ personId: p.id, name: p.name, childId: null, childName: null, teams: p.teams })) });
  }
  const people = await all<{ id: number; name: string; child_id: number | null; child_name: string | null }>(
    c.env.DB,
    `SELECT gp.id, ${SHORT_NAME_SQL("gp")} AS name, ch.id AS child_id, ch.first_name AS child_name
       FROM team_memberships tm JOIN persons ch ON ch.id = tm.person_id AND ch.is_former = 0
       JOIN guardianships g ON g.child_id = ch.id JOIN persons gp ON gp.id = g.guardian_id AND gp.is_former = 0
      WHERE tm.team_id = ?1 AND tm.role IN ('player', 'helper')
     UNION
     SELECT p.id, ${SHORT_NAME_SQL("p")}, NULL, NULL FROM team_memberships tm JOIN persons p ON p.id = tm.person_id AND p.is_former = 0
      WHERE tm.team_id = ?1
     ORDER BY 2`,
    teamId,
  );
  return c.json({ people: people.map((p) => ({ personId: p.id, name: p.name, childId: p.child_id, childName: p.child_name })) });
});

/**
 * Personen für „Jemanden eintragen“ und die Organisator-Auswahl eines Termins (nur Verwalter des Termins).
 * Ohne q die Personen der beteiligten Mannschaften (Eltern mit Kind, Mitglieder), mit q (ab 2 Zeichen) der ganze Verein.
 * account=1: nur ordentliche Mitglieder mit aktivem Zugang (Organisatoren).
 */
dutyRoutes.get("/duties/events/:id/people", async (c) => {
  const actor = requireActor(c);
  const db = c.env.DB;
  const event = await managedEvent(db, actor, intParam(c, "id"));
  const q = (c.req.query("q") ?? "").trim().toLowerCase();
  const accountOnly = c.req.query("account") === "1";
  const accountSql = accountOnly
    ? "AND EXISTS (SELECT 1 FROM accounts a WHERE a.person_id = p.id AND a.disabled_at IS NULL) AND EXISTS (SELECT 1 FROM club_members cm WHERE cm.person_id = p.id)"
    : "";
  if (q.length >= 2) {
    const like = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    const found = await all<{ id: number; name: string; teams: string | null }>(
      db,
      `SELECT p.id, ${SHORT_NAME_SQL("p")} AS name,
              (SELECT group_concat(t.name, ', ') FROM team_memberships tm JOIN teams t ON t.id = tm.team_id AND t.kind = 'team' WHERE tm.person_id = p.id) AS teams
         FROM persons p
        WHERE p.is_former = 0 ${accountSql}
          AND (lower(p.first_name || ' ' || coalesce(p.last_name, '')) LIKE ?1 ESCAPE '\\' OR lower(coalesce(p.last_name, '')) LIKE ?1 ESCAPE '\\')
        ORDER BY p.first_name, p.last_name LIMIT 20`,
      like,
    );
    return c.json({ people: found.map((p) => ({ personId: p.id, name: p.name, childId: null, childName: null, teams: p.teams })) });
  }
  const ids = JSON.stringify(event.teamIds);
  const people = await all<{ id: number; name: string; child_id: number | null; child_name: string | null }>(
    db,
    accountOnly
      ? `SELECT DISTINCT p.id, ${SHORT_NAME_SQL("p")} AS name, NULL AS child_id, NULL AS child_name
           FROM team_memberships tm JOIN persons p ON p.id = tm.person_id AND p.is_former = 0
          WHERE tm.team_id IN (SELECT value FROM json_each(?1)) ${accountSql}
         ORDER BY 2`
      : `SELECT gp.id, ${SHORT_NAME_SQL("gp")} AS name, ch.id AS child_id, ch.first_name AS child_name
           FROM team_memberships tm JOIN persons ch ON ch.id = tm.person_id AND ch.is_former = 0
           JOIN guardianships g ON g.child_id = ch.id JOIN persons gp ON gp.id = g.guardian_id AND gp.is_former = 0
          WHERE tm.team_id IN (SELECT value FROM json_each(?1)) AND tm.role IN ('player', 'helper')
         UNION
         SELECT p.id, ${SHORT_NAME_SQL("p")}, NULL, NULL FROM team_memberships tm JOIN persons p ON p.id = tm.person_id AND p.is_former = 0
          WHERE tm.team_id IN (SELECT value FROM json_each(?1))
         ORDER BY 2`,
    ids,
  );
  return c.json({ people: people.map((p) => ({ personId: p.id, name: p.name, childId: p.child_id, childName: p.child_name })) });
});

/** Top-10 Helfer einer Mannschaft (nur innerhalb dieser Mannschaft). */
dutyRoutes.get("/duties/teams/:id/top", async (c) => {
  const actor = requireActor(c);
  const teamId = intParam(c, "id");
  if (!(await helperTeams(c.env.DB, actor)).some((t) => t.teamId === teamId)) throw forbidden();
  const rows = await all<{ name: string; n: number }>(
    c.env.DB,
    `SELECT coalesce(d.manual_name, ${SHORT_NAME_SQL("p")}) AS name, count(*) AS n
       FROM duties d JOIN event_teams et ON et.event_id = d.event_id AND et.team_id = ?
       LEFT JOIN persons p ON p.id = d.person_id
      GROUP BY coalesce(d.person_id, 'm:' || d.manual_name) ORDER BY n DESC, name LIMIT 10`,
    teamId,
  );
  const best = rows[0]?.n ?? 0;
  return c.json({ top: rows.map((r) => ({ name: r.name, count: r.n, star: r.n === best })) });
});

const manualGameSchema = z.object({
  opponent: z.string().trim().min(1).max(80),
  isHome: z.boolean(),
  date: z.string().refine(isDate, "Ungültiges Datum."),
  time: z.string().refine(isTime, "Ungültige Uhrzeit."),
  locationId: z.number().int().positive().nullable().optional(),
});

/** Spiel ohne handball4all (Freundschaftsspiele, Turniere, Bambinis, Minis). Die Mannschaft wird benachrichtigt. */
dutyRoutes.post("/duties/teams/:id/games", async (c) => {
  const actor = requireActor(c);
  const teamId = intParam(c, "id");
  if (!isCoachOf(actor, teamId)) throw forbidden("Das dürfen nur Trainer dieser Mannschaft.");
  await requireTeam(c.env.DB, teamId);
  const input = parse(manualGameSchema, await readJson(c.req.raw));
  const startsAt = `${input.date}T${input.time}`;
  if (startsAt <= nowLocal()) throw badRequest("Das Spiel muss in der Zukunft liegen.");
  const own = (await loadClub(c.env.DB)).name;
  const row = await first<{ id: number }>(
    c.env.DB,
    `INSERT INTO events (kind, starts_at, ends_at, location_id, home_team, guest_team, is_home)
     VALUES ('game', ?, ?, ?, ?, ?, ?) RETURNING id`,
    startsAt,
    addMinutesLocal(startsAt, 90),
    input.locationId ?? null,
    input.isHome ? own : input.opponent,
    input.isHome ? input.opponent : own,
    input.isHome ? 1 : 0,
  );
  await run(c.env.DB, "INSERT INTO event_teams (event_id, team_id) VALUES (?, ?)", row!.id, teamId);
  c.executionCtx.waitUntil(notifyDutyChange(c.env, teamId));

  const team = await first<{ name: string }>(c.env.DB, "SELECT name FROM teams WHERE id = ?", teamId);
  const loc = input.locationId ? await first<{ name: string }>(c.env.DB, "SELECT name FROM locations WHERE id = ?", input.locationId) : null;
  const players = await all<{ person_id: number }>(
    c.env.DB,
    `SELECT tm.person_id FROM team_memberships tm JOIN persons p ON p.id = tm.person_id
      WHERE tm.team_id = ? AND tm.role = 'player' AND p.is_active = 1 AND p.is_former = 0`,
    teamId,
  );
  c.executionCtx.waitUntil(
    notifyPersons(
      c.env,
      players.map((p) => p.person_id),
      "events",
      {
        title: `Neues Spiel: ${team?.name ?? "Spiel"} ${input.isHome ? "gegen" : "bei"} ${input.opponent}`,
        body: `${shortDate(startsAt)}, ${shortTime(startsAt)}${loc ? `, ${loc.name}` : ""}. Den Kader gibt der Trainer bekannt.`,
        url: `/termine/${row!.id}`,
      },
      { teamIds: [teamId], exclude: [actor.accountId] },
    ),
  );
  return c.json({ id: row!.id }, 201);
});

dutyRoutes.delete("/duties/games/:id", async (c) => {
  const actor = requireActor(c);
  const event = await managedEvent(c.env.DB, actor, intParam(c, "id"));
  const row = await first<{ kind: string; h4a_game_id: string | null }>(c.env.DB, "SELECT kind, h4a_game_id FROM events WHERE id = ?", event.id);
  if (row?.kind !== "game") throw notFound();
  if (row.h4a_game_id) throw badRequest("Spiele aus handball4all lassen sich nicht löschen, nur ausblenden.");
  await run(c.env.DB, "DELETE FROM events WHERE id = ?", event.id);
  for (const t of event.teamIds) c.executionCtx.waitUntil(notifyDutyChange(c.env, t));
  return c.json({ ok: true });
});

dutyRoutes.get("/duties/teams/:id/live", async (c) => {
  const actor = requireActor(c);
  const teamId = intParam(c, "id");
  if (c.req.header("upgrade")?.toLowerCase() !== "websocket") throw badRequest("Erwarte eine WebSocket-Verbindung.");
  if (!(await helperTeams(c.env.DB, actor)).some((t) => t.teamId === teamId)) throw forbidden();
  return dutyHubStub(c.env, teamId).fetch(new Request("https://duties.internal/connect", { headers: c.req.raw.headers }));
});

// Profil: „Das kann ich“, Kanäle -------------------------------------------------

export const DUTY_TOPICS = ["duty_remind_3d", "duty_remind_1d", "duty_open", "duty_coach_open", "duty_referee_open"] as const;
export type DutyTopic = (typeof DUTY_TOPICS)[number];
/** Standard, wenn nichts eingestellt ist: Push an, Mail aus. */
export const DEFAULT_CHANNEL = { push: true, mail: false };

dutyRoutes.get("/profile/duty-prefs", async (c) => {
  const actor = requireActor(c);
  const db = c.env.DB;
  const [rows, email, types, consents] = await Promise.all([
    all<{ topic: DutyTopic; push: number; mail: number }>(db, "SELECT topic, push, mail FROM notification_channels WHERE account_id = ?", actor.accountId),
    first<{ email: string | null; email_verified_at: string | null }>(db, "SELECT email, email_verified_at FROM accounts WHERE id = ?", actor.accountId),
    loadDutyTypes(db),
    skillConsents(db, actor.accountId),
  ]);
  return c.json({
    // Dienstarten mit Vorkenntnissen: nur nach Zustimmung („Das kann ich“)
    skills: [...types.values()].filter((t) => t.needsSkill && !t.archived).map((t) => ({ dutyTypeId: t.id, code: t.code, name: t.name, on: consents.has(t.id) })),
    channels: Object.fromEntries(
      DUTY_TOPICS.map((t) => {
        const r = rows.find((x) => x.topic === t);
        return [t, r ? { push: r.push === 1, mail: r.mail === 1 } : DEFAULT_CHANNEL];
      }),
    ),
    mailAddressVerified: !!email?.email && !!email.email_verified_at,
  });
});

const prefsSchema = z.object({
  skills: z.array(z.object({ dutyTypeId: z.number().int().positive(), on: z.boolean() })).max(50).optional(),
  channels: z.partialRecord(z.enum(DUTY_TOPICS), z.object({ push: z.boolean(), mail: z.boolean() })).optional(),
});

dutyRoutes.put("/profile/duty-prefs", async (c) => {
  const actor = requireActor(c);
  const db = c.env.DB;
  const input = parse(prefsSchema, await readJson(c.req.raw));
  const statements: D1PreparedStatement[] = [];
  for (const s of input.skills ?? []) {
    statements.push(
      s.on
        ? stmt(db, "INSERT OR IGNORE INTO skill_consents (account_id, duty_type_id) SELECT ?, id FROM duty_types WHERE id = ? AND needs_skill = 1", actor.accountId, s.dutyTypeId)
        : stmt(db, "DELETE FROM skill_consents WHERE account_id = ? AND duty_type_id = ?", actor.accountId, s.dutyTypeId),
    );
  }
  for (const [topic, ch] of Object.entries(input.channels ?? {})) {
    statements.push(
      stmt(
        db,
        "INSERT INTO notification_channels (account_id, topic, push, mail) VALUES (?, ?, ?, ?) ON CONFLICT (account_id, topic) DO UPDATE SET push = excluded.push, mail = excluded.mail",
        actor.accountId,
        topic,
        ch.push ? 1 : 0,
        ch.mail ? 1 : 0,
      ),
    );
  }
  if (statements.length) await db.batch(statements);
  return c.json({ ok: true });
});

// Dienstarten und Vorlagen: lesen alle Trainer, ändern nur Admins ----------------

function requireCoachOrAdmin(actor: Actor) {
  if (!actor.isAdmin && !actor.coachTeamIds.length) throw forbidden();
}

dutyRoutes.get("/duty-types", async (c) => {
  const actor = requireActor(c);
  requireCoachOrAdmin(actor);
  const types = await loadDutyTypes(c.env.DB);
  return c.json({ types: [...types.values()].filter((t) => c.req.query("all") === "1" || !t.archived) });
});

const dutyTypeSchema = z.object({
  name: z.string().trim().min(1, "Bitte gib einen Namen ein.").max(40),
  mode: z.enum(["onsite", "task"]),
  whoParents: z.boolean(),
  whoPlayers: z.boolean(),
  whoCoaches: z.boolean(),
  whoMembers: z.boolean().default(false),
  noteAllowed: z.boolean(),
  needsSkill: z.boolean(),
  archived: z.boolean().optional(),
});

function checkWho(input: z.infer<typeof dutyTypeSchema>) {
  if (!input.whoParents && !input.whoPlayers && !input.whoCoaches && !input.whoMembers) throw badRequest("Bitte wähle, wer helfen kann.");
}

dutyRoutes.post("/admin/duty-types", async (c) => {
  requireAdmin(requireActor(c));
  const input = parse(dutyTypeSchema, await readJson(c.req.raw));
  checkWho(input);
  const row = await first<{ id: number }>(
    c.env.DB,
    `INSERT INTO duty_types (name, mode, who_parents, who_players, who_coaches, who_members, note_allowed, needs_skill, sort)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, (SELECT coalesce(max(sort), 0) + 1 FROM duty_types WHERE event_id IS NULL)) RETURNING id`,
    input.name,
    input.mode,
    input.whoParents ? 1 : 0,
    input.whoPlayers ? 1 : 0,
    input.whoCoaches ? 1 : 0,
    input.whoMembers ? 1 : 0,
    input.noteAllowed ? 1 : 0,
    input.needsSkill ? 1 : 0,
  );
  return c.json({ id: row!.id }, 201);
});

dutyRoutes.patch("/admin/duty-types/:id", async (c) => {
  requireAdmin(requireActor(c));
  const id = intParam(c, "id");
  const type = (await loadDutyTypes(c.env.DB)).get(id);
  if (!type || type.eventId != null) throw notFound("Diese Dienstart gibt es nicht.");
  const input = parse(dutyTypeSchema, await readJson(c.req.raw));
  // KiHaSL/JuHaSL hängt an der Rolle: nur Name und Archiv sind änderbar
  if (type.whoReferees) {
    await run(c.env.DB, "UPDATE duty_types SET name = ? WHERE id = ?", input.name, id);
    return c.json({ ok: true });
  }
  checkWho(input);
  await run(
    c.env.DB,
    `UPDATE duty_types SET name = ?, mode = ?, who_parents = ?, who_players = ?, who_coaches = ?, who_members = ?, note_allowed = ?, needs_skill = ?, archived = ? WHERE id = ?`,
    input.name,
    input.mode,
    input.whoParents ? 1 : 0,
    input.whoPlayers ? 1 : 0,
    input.whoCoaches ? 1 : 0,
    input.whoMembers ? 1 : 0,
    input.noteAllowed ? 1 : 0,
    input.needsSkill ? 1 : 0,
    input.archived ? 1 : 0,
    id,
  );
  return c.json({ ok: true });
});

interface TemplateRow {
  id: number;
  name: string;
  default_for: "home" | "away" | null;
}

dutyRoutes.get("/duty-templates", async (c) => {
  const actor = requireActor(c);
  requireCoachOrAdmin(actor);
  const db = c.env.DB;
  const [templates, items] = await Promise.all([
    all<TemplateRow>(db, "SELECT id, name, default_for FROM duty_templates ORDER BY default_for IS NULL, default_for DESC, name"),
    all<{ id: number; template_id: number; duty_type_id: number; slots: number; before_min: number; after_min: number; task_when: "before" | "after" }>(
      db,
      "SELECT id, template_id, duty_type_id, slots, before_min, after_min, task_when FROM duty_template_items ORDER BY sort, id",
    ),
  ]);
  return c.json({
    templates: templates.map((t) => ({
      id: t.id,
      name: t.name,
      defaultFor: t.default_for,
      items: items
        .filter((i) => i.template_id === t.id)
        .map((i) => ({ dutyTypeId: i.duty_type_id, slots: i.slots, beforeMin: i.before_min, afterMin: i.after_min, taskWhen: i.task_when })),
    })),
  });
});

const templateSchema = z.object({
  name: z.string().trim().min(1, "Bitte gib einen Namen ein.").max(40),
  items: z
    .array(
      z.object({
        dutyTypeId: z.number().int().positive(),
        slots: z.number().int().min(1).max(20),
        beforeMin: z.number().int().min(0).max(600),
        afterMin: z.number().int().min(0).max(600),
        taskWhen: z.enum(["before", "after"]),
      }),
    )
    .max(20),
});

async function saveTemplate(db: D1Database, id: number, input: z.infer<typeof templateSchema>) {
  const types = await loadDutyTypes(db);
  for (const i of input.items) {
    const t = types.get(i.dutyTypeId);
    if (!t || t.eventId != null || t.whoReferees) throw badRequest("Diese Dienstart passt nicht in eine Vorlage.");
  }
  await db.batch([
    stmt(db, "UPDATE duty_templates SET name = ? WHERE id = ?", input.name, id),
    stmt(db, "DELETE FROM duty_template_items WHERE template_id = ?", id),
    ...input.items.map((i, n) =>
      stmt(
        db,
        "INSERT INTO duty_template_items (template_id, duty_type_id, slots, before_min, after_min, task_when, sort) VALUES (?, ?, ?, ?, ?, ?, ?)",
        id,
        i.dutyTypeId,
        i.slots,
        i.beforeMin,
        i.afterMin,
        i.taskWhen,
        n + 1,
      ),
    ),
  ]);
}

dutyRoutes.post("/admin/duty-templates", async (c) => {
  requireAdmin(requireActor(c));
  const input = parse(templateSchema, await readJson(c.req.raw));
  const row = await first<{ id: number }>(c.env.DB, "INSERT INTO duty_templates (name) VALUES (?) RETURNING id", input.name);
  await saveTemplate(c.env.DB, row!.id, input);
  return c.json({ id: row!.id }, 201);
});

dutyRoutes.put("/admin/duty-templates/:id", async (c) => {
  requireAdmin(requireActor(c));
  const id = intParam(c, "id");
  if (!(await first(c.env.DB, "SELECT 1 AS ok FROM duty_templates WHERE id = ?", id))) throw notFound("Diese Vorlage gibt es nicht.");
  await saveTemplate(c.env.DB, id, parse(templateSchema, await readJson(c.req.raw)));
  // Gilt sofort für kommende Spiele ohne Einträge der Mannschaften, die diese Vorlage nutzen (auch als Standard)
  const teams = await all<{ id: number }>(
    c.env.DB,
    `SELECT t.id FROM teams t, duty_templates dt WHERE dt.id = ?1 AND t.kind = 'team'
        AND (t.home_template_id = ?1 OR t.away_template_id = ?1
             OR (dt.default_for = 'home' AND t.home_template_id IS NULL) OR (dt.default_for = 'away' AND t.away_template_id IS NULL))`,
    id,
  );
  const now = nowLocal();
  for (const t of teams) await resetTeamDuties(c.env.DB, t.id, now);
  for (const t of teams) c.executionCtx.waitUntil(notifyDutyChange(c.env, t.id));
  return c.json({ ok: true });
});

dutyRoutes.delete("/admin/duty-templates/:id", async (c) => {
  requireAdmin(requireActor(c));
  const id = intParam(c, "id");
  const t = await first<TemplateRow>(c.env.DB, "SELECT id, name, default_for FROM duty_templates WHERE id = ?", id);
  if (!t) throw notFound("Diese Vorlage gibt es nicht.");
  if (t.default_for) throw badRequest("Die Standardvorlage lässt sich nicht löschen.");
  // Mannschaften mit dieser Vorlage fallen auf den Standard zurück
  const teams = await all<{ id: number }>(c.env.DB, "SELECT id FROM teams WHERE home_template_id = ?1 OR away_template_id = ?1", id);
  await run(c.env.DB, "DELETE FROM duty_templates WHERE id = ?", id);
  const now = nowLocal();
  for (const team of teams) await resetTeamDuties(c.env.DB, team.id, now);
  return c.json({ ok: true });
});
