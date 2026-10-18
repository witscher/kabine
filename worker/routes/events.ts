import { Hono } from "hono";
import { z } from "zod";
import type { EventSummary, MyDuty } from "../../shared/types";
import { type AppEnv, intParam, requireActor } from "../app";
import { type Actor, isCoachOfAny, PARENTS_HANDLE_IT, requireActFor, requireAdmin } from "../auth/actor";
import { carpoolGame, loadCarpool, loadCarpoolCounts, releaseRequests } from "../domain/carpool";
import { postSystemMessage } from "../domain/chat";
import {
  deadlineInstant,
  type EventRow,
  eventTeams,
  eventTitle,
  listVisibleEvents,
  loadEvent,
  loadEventContext,
  loadVisibleEvent,
  toDetail,
  toSummary,
} from "../domain/events";
import { attendanceStatus, attendanceUpdate } from "../domain/attendance";
import { dutyManagers, loadDutyTypes, loadHelpersNeeded, loadMyDuties, mayManageDuties, SHORT_NAME_SQL } from "../domain/duties";
import { notifyDutyChange } from "../duties/hub";
import { loadEventPage } from "../domain/event-page";
import { ensureGenerated } from "../domain/generate";
import { eventLabel, notifyCoaches, notifyPersons, recipientsForPersons, enqueuePush, shortDate, shortTime } from "../domain/notify";
import { all, first, list, run, stmt } from "../lib/db";
import { badRequest, conflict, forbidden, notFound, parse, readJson } from "../lib/http";
import { addDays, isDate, isLocalDateTime, isTime, localToInstant, nowLocal, todayLocal, utcIso } from "../lib/time";

export const eventRoutes = new Hono<AppEnv>();

const rangeSchema = z.object({
  from: z.string().refine(isDate, "Ungültiges Datum").optional(),
  to: z.string().refine(isDate, "Ungültiges Datum").optional(),
  teamId: z.coerce.number().int().positive().optional(),
  kind: z.enum(["training", "game", "special"]).optional(),
  /** Vergangene Termine der Saison, neueste zuerst (from/to werden dann ignoriert) */
  past: z.literal("1").optional(),
  /** Seitenweise für die Terminübersicht: die nächsten `limit` relevanten Termine (from/to/teamId/kind entfallen) */
  limit: z.coerce.number().int().min(1).max(200).optional(),
  /** Nur mit limit: Mannschaftsfilter der Terminübersicht, nach Sichtbarkeit und Relevanz */
  team: z.coerce.number().int().positive().optional(),
});

eventRoutes.get("/events", async (c) => {
  const actor = requireActor(c);
  const q = parse(rangeSchema, c.req.query());
  await ensureGenerated(c.env.DB);
  if (q.limit) return c.json(await loadEventPage(c.env.DB, actor, { limit: q.limit, past: !!q.past, teamId: q.team ?? null }));
  const from = q.from ?? todayLocal();
  const to = q.to ?? addDays(from, 70);
  if (to < from) throw badRequest("Ungültiger Zeitraum.");
  // Termine gibt es nur aus der laufenden Saison; der Saisonwechsel löscht die alten
  const rows = q.past
    ? (await listVisibleEvents(c.env.DB, actor, { from: "0000-01-01T00:00", to: nowLocal(), teamId: q.teamId, kind: q.kind })).reverse()
    : await listVisibleEvents(c.env.DB, actor, {
        from: `${from}T00:00`,
        to: `${addDays(to, 1)}T00:00`,
        teamId: q.teamId,
        kind: q.kind,
      });
  const gameIds = rows.filter((e) => e.kind !== "training").map((e) => e.id);
  const [ctx, duties, needed] = await Promise.all([
    loadEventContext(c.env.DB, rows),
    loadMyDuties(c.env.DB, actor, gameIds),
    // Vergangene Spiele brauchen keine Helfer mehr
    q.past ? Promise.resolve(new Map<number, number>()) : loadHelpersNeeded(c.env.DB, actor, gameIds, nowLocal()),
  ]);
  const now = Date.now();
  const [managers, carpool] = await Promise.all([
    dutyManagers(c.env.DB, rows.filter((e) => e.kind === "special").map((e) => e.id)),
    q.past ? Promise.resolve(new Map()) : loadCarpoolCounts(c.env.DB, actor, rows, ctx, now),
  ]);
  return c.json({
    events: rows.map((e) => ({
      ...withDuties(toSummary(e, ctx, actor, now), duties, needed),
      organizing: !!managers.get(e.id)?.has(actor.personId),
      carpoolCount: carpool.get(e.id) ?? null,
    })),
  });
});

/** Helferplan an der Terminübersicht: eigene Dienste, sonst ggf. „Helfer benötigt“. */
function withDuties<T extends EventSummary>(e: T, duties: Map<number, MyDuty[]>, needed: Map<number, number>): T {
  const myDuties = duties.get(e.id) ?? [];
  // Wer (oder wessen Familie) schon einen Dienst hat, bekommt keinen Aufruf
  return { ...e, myDuties, helpersNeeded: myDuties.length ? 0 : (needed.get(e.id) ?? 0) };
}

async function visibleEventOr404(db: D1Database, actor: Actor, eventId: number): Promise<EventRow> {
  const event = await loadVisibleEvent(db, actor, eventId);
  if (!event) throw notFound("Diesen Termin gibt es nicht oder du kannst ihn nicht sehen.");
  return event;
}

eventRoutes.get("/events/:id", async (c) => {
  const actor = requireActor(c);
  const event = await visibleEventOr404(c.env.DB, actor, intParam(c, "id"));
  const gameIds = event.kind !== "training" ? [event.id] : [];
  const [ctx, duties, needed] = await Promise.all([
    loadEventContext(c.env.DB, [event]),
    loadMyDuties(c.env.DB, actor, gameIds),
    loadHelpersNeeded(c.env.DB, actor, gameIds, nowLocal()),
  ]);
  const now = Date.now();
  const detail = withDuties(toDetail(event, ctx, actor, now), duties, needed);
  const [info, carpool] = await Promise.all([
    organizerInfo(c.env.DB, actor, event.id, event.kind, detail.teams.map((t) => t.id)),
    loadCarpool(c.env.DB, actor, event, ctx, now),
  ]);
  const organizing = !!info.organizers && (info.organizers.creator?.id === actor.personId || info.organizers.people.some((p) => p.id === actor.personId));
  return c.json({ ...detail, ...info, organizing, carpool });
});

/** Ersteller und Organisatoren eines Sondertermins; sie verwalten die Helferdienste. */
async function organizerInfo(db: D1Database, actor: Actor, eventId: number, kind: string, teamIds: number[]) {
  const managers = (await dutyManagers(db, [eventId])).get(eventId);
  const dutyManage = teamIds.length > 0 && (kind === "game" || kind === "special") && mayManageDuties(actor, teamIds, managers);
  if (kind !== "special") return { dutyManage, organizers: null };
  const [creator, people] = await Promise.all([
    first<{ id: number; name: string }>(db, `SELECT p.id, ${SHORT_NAME_SQL("p")} AS name FROM events e JOIN persons p ON p.id = e.created_by WHERE e.id = ?`, eventId),
    all<{ id: number; name: string }>(
      db,
      `SELECT p.id, ${SHORT_NAME_SQL("p")} AS name FROM event_organizers o JOIN persons p ON p.id = o.person_id WHERE o.event_id = ? ORDER BY p.first_name, p.last_name`,
      eventId,
    ),
  ]);
  return { dutyManage, organizers: { creator: creator ?? null, people, editable: mayEditOrganizers(actor, teamIds, creator?.id ?? null) } };
}

/** Organisatoren ändern: Trainer der Mannschaften, Admins und der Ersteller. */
function mayEditOrganizers(actor: Actor, teamIds: number[], creatorId: number | null): boolean {
  return isCoachOfAny(actor, teamIds) || actor.isAdmin || creatorId === actor.personId;
}

async function organizerEvent(db: D1Database, actor: Actor, eventId: number) {
  const e = await first<{ id: number; kind: string; title: string | null; created_by: number | null; team_ids: string }>(
    db,
    `SELECT e.id, e.kind, e.title, e.created_by,
            (SELECT json_group_array(team_id) FROM (SELECT et.team_id FROM event_teams et WHERE et.event_id = e.id ORDER BY et.team_id)) AS team_ids
       FROM events e WHERE e.id = ?`,
    eventId,
  );
  if (!e || e.kind !== "special") throw notFound("Organisatoren gibt es nur bei Sonderterminen.");
  const teamIds = JSON.parse(e.team_ids) as number[];
  if (!mayEditOrganizers(actor, teamIds, e.created_by)) throw forbidden("Organisatoren ändern Trainer, Admins und wer den Termin angelegt hat.");
  return { ...e, teamIds };
}

eventRoutes.post("/events/:id/organizers", async (c) => {
  const actor = requireActor(c);
  const db = c.env.DB;
  const event = await organizerEvent(db, actor, intParam(c, "id"));
  const { personId } = parse(z.object({ personId: z.number().int().positive() }), await readJson(c.req.raw));
  const ok = await first(
    db,
    `SELECT 1 AS ok FROM persons p WHERE p.id = ? AND p.is_former = 0
        AND EXISTS (SELECT 1 FROM accounts a WHERE a.person_id = p.id AND a.disabled_at IS NULL)
        AND EXISTS (SELECT 1 FROM club_members cm WHERE cm.person_id = p.id)`,
    personId,
  );
  if (!ok) throw badRequest("Organisator kann nur ein ordentliches Mitglied mit Zugang zur App sein.", "not_eligible");
  const res = await run(db, "INSERT OR IGNORE INTO event_organizers (event_id, person_id, added_by) VALUES (?, ?, ?)", event.id, personId, actor.personId);
  if (res.meta.changes && personId !== actor.personId) {
    c.executionCtx.waitUntil(
      notifyPersons(c.env, [personId], "events", {
        title: `Du organisierst „${event.title ?? "Termin"}“ mit`,
        body: "Du kannst jetzt die Helferdienste dieses Termins verwalten.",
        url: `/termine/${event.id}`,
      }, { teamIds: event.teamIds }),
    );
  }
  for (const t of event.teamIds) c.executionCtx.waitUntil(notifyDutyChange(c.env, t));
  return c.json({ ok: true }, 201);
});

eventRoutes.delete("/events/:id/organizers/:personId", async (c) => {
  const actor = requireActor(c);
  const event = await organizerEvent(c.env.DB, actor, intParam(c, "id"));
  await run(c.env.DB, "DELETE FROM event_organizers WHERE event_id = ? AND person_id = ?", event.id, intParam(c, "personId"));
  for (const t of event.teamIds) c.executionCtx.waitUntil(notifyDutyChange(c.env, t));
  return c.json({ ok: true });
});

// Zu- und Absagen ---------------------------------------------------------------

const respondSchema = z.object({
  personId: z.number().int().positive(),
  status: z.enum(["yes", "no"]),
  reason: z.string().trim().max(200, "Die Begründung ist zu lang (höchstens 200 Zeichen).").optional(),
});

eventRoutes.post("/events/:id/responses", async (c) => {
  const actor = requireActor(c);
  const input = parse(respondSchema, await readJson(c.req.raw));
  const event = await visibleEventOr404(c.env.DB, actor, intParam(c, "id"));
  const result = await respond(c.env, actor, event, input.personId, input.status, input.reason ?? null);
  return c.json(result);
});

export async function respond(
  env: Env,
  actor: Actor,
  event: EventRow,
  personId: number,
  status: "yes" | "no",
  reasonInput: string | null,
  now = Date.now(),
) {
  const ctx = await loadEventContext(env.DB, [event]);
  const teamIds = ctx.eventTeams.get(event.id) ?? [];
  // Trainer der beteiligten Mannschaften und Admins dürfen für Teilnehmer antworten,
  // z. B. für Familien ohne App. Elterliche Freigaben gelten dann nicht.
  const asCoach = personId !== actor.personId && !actor.children.some((ch) => ch.id === personId) && (event.club_wide === 1 ? actor.isAdmin : isCoachOfAny(actor, teamIds));
  if (!asCoach) requireActFor(actor, personId, status === "yes" ? "may_accept" : "may_decline", teamIds);
  if (event.cancelled_at) throw conflict("Der Termin wurde abgesagt.");
  if (localToInstant(event.starts_at) <= now) throw conflict("Der Termin hat schon begonnen.");

  const participant = (ctx.participants.get(event.id) ?? []).find((p) => p.person.id === personId);
  if (!participant) {
    throw forbidden(event.kind === "game" ? "Rückmeldungen sind nur für nominierte Spieler möglich." : "Diese Person nimmt an dem Termin nicht teil.");
  }
  if (!participant.isActive) throw conflict("Derzeit inaktiv gemeldet. Bitte sprich mit deinem Trainer.");
  // Zusagen heißt eine Absage zurücknehmen. Wer schon zugesagt ist (auch automatisch), bleibt es.
  if (status === "yes" && participant.status === "yes") return toSummary(event, ctx, actor, now);

  const reason = status === "no" ? (reasonInput ?? "").trim() : null;
  if (status === "no" && !reason) throw badRequest("Bitte gib kurz einen Grund für die Absage an.", "reason_required");

  const teams = eventTeams(event, ctx);
  const isLate = status === "no" && now > deadlineInstant(event, teams);
  await run(
    env.DB,
    `INSERT INTO responses (event_id, person_id, status, reason, is_late, by_account, by_person, responded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(event_id, person_id) DO UPDATE SET status = excluded.status, reason = excluded.reason,
       is_late = excluded.is_late, by_account = excluded.by_account, by_person = excluded.by_person,
       responded_at = excluded.responded_at`,
    event.id,
    personId,
    status,
    reason,
    isLate ? 1 : 0,
    actor.accountId,
    actor.personId,
    utcIso(now),
  );

  // Wer absagt, sucht keine Mitfahrgelegenheit mehr
  if (status === "no" && carpoolGame(event)) await releaseRequests(env, { event, ctx, teamIds }, [personId], [actor.accountId]);

  // Benachrichtigungen
  const title = eventTitle(event, teams);
  const when = `${shortDate(event.starts_at)}, ${shortTime(event.starts_at)}`;
  const name = participant.person.firstName;
  const what = eventLabel(event.kind, title);
  if (isLate) {
    await notifyCoaches(
      env,
      teams.map((t) => t.id),
      {
        title: "Kurzfristige Absage",
        body: `${name} hat ${event.kind === "training" ? "das Training" : what} am ${when} kurzfristig abgesagt.`,
        url: `/termine/${event.id}`,
        tag: `late-${event.id}`,
      },
      { exclude: [actor.accountId] },
    );
  }
  // Eltern bzw. Kind informieren, wenn jemand anderes geantwortet hat.
  const hasOthers = actor.personId !== personId || actor.hasGuardians;
  if (hasOthers) {
    const accounts = await recipientsForPersons(env.DB, [personId], "responses", teamIds);
    const verb = status === "yes" ? "zugesagt" : "abgesagt";
    const body =
      actor.personId === personId
        ? `${name} hat für ${event.kind === "training" ? "das Training" : what} am ${when} ${verb}.`
        : `${actor.firstName} hat für ${name} ${event.kind === "training" ? "das Training" : what} am ${when} ${verb}.`;
    await enqueuePush(env, accounts, { title: `Rückmeldung: ${verb}`, body, url: `/termine/${event.id}` }, { exclude: [actor.accountId] });
  }

  const fresh = (await loadEvent(env.DB, event.id))!;
  const freshCtx = await loadEventContext(env.DB, [fresh]);
  return toSummary(fresh, freshCtx, actor, now);
}

// Verwaltung durch Trainer ------------------------------------------------------

async function managedEvent(db: D1Database, actor: Actor, eventId: number) {
  const event = await loadEvent(db, eventId);
  if (!event) throw notFound("Diesen Termin gibt es nicht.");
  const ctx = await loadEventContext(db, [event]);
  const teams = eventTeams(event, ctx);
  const allowed = event.club_wide === 1 ? actor.isAdmin : isCoachOfAny(actor, teams.map((t) => t.id));
  if (!allowed) throw forbidden("Das dürfen nur Trainer der beteiligten Mannschaften.");
  return { event, ctx, teams };
}

/** Personen, die über Änderungen an einem Termin informiert werden. */
async function affectedPersons(event: EventRow, ctx: Awaited<ReturnType<typeof loadEventContext>>): Promise<number[]> {
  const parts = ctx.participants.get(event.id) ?? [];
  const ids = new Set(parts.filter((p) => p.status !== "inactive" && p.status !== "standing").map((p) => p.person.id));
  if (event.kind === "game") {
    for (const m of ctx.members.get(event.id)?.values() ?? []) if (m.is_active === 1) ids.add(m.person_id);
  }
  return [...ids];
}

/** Nach Beginn: Trainer markieren, wer trotz Zusage unentschuldigt gefehlt hat. */
eventRoutes.put("/events/:id/unexcused/:personId", async (c) => {
  const actor = requireActor(c);
  const personId = intParam(c, "personId");
  const { unexcused } = parse(z.object({ unexcused: z.boolean() }), await readJson(c.req.raw));
  const { event, ctx } = await managedEvent(c.env.DB, actor, intParam(c, "id"));
  if (event.cancelled_at) throw conflict("Der Termin wurde abgesagt.");
  if (localToInstant(event.starts_at) > Date.now()) throw conflict("Das geht erst, wenn der Termin begonnen hat.");
  const part = (ctx.participants.get(event.id) ?? []).find((p) => p.person.id === personId);
  if (!part) throw notFound("Diese Person nimmt an dem Termin nicht teil.");
  if (unexcused && part.status !== "yes" && part.status !== "open") {
    throw conflict("Wer abgesagt hat, dauerhaft abwesend oder inaktiv ist, fehlt entschuldigt.");
  }
  // Ist der Termin schon im Anwesenheitsprotokoll, wird es mitgezogen
  await c.env.DB.batch([
    unexcused
      ? stmt(c.env.DB, "INSERT OR IGNORE INTO unexcused_absences (event_id, person_id, marked_by) VALUES (?, ?, ?)", event.id, personId, actor.personId)
      : stmt(c.env.DB, "DELETE FROM unexcused_absences WHERE event_id = ? AND person_id = ?", event.id, personId),
    attendanceUpdate(c.env.DB, event.id, personId, attendanceStatus(part.status, unexcused)),
  ]);
  return c.json({ ok: true });
});

const cancelSchema = z.object({ reason: z.string().trim().min(1, "Bitte gib einen Grund an.").max(200) });

eventRoutes.post("/events/:id/cancel", async (c) => {
  const actor = requireActor(c);
  const { reason } = parse(cancelSchema, await readJson(c.req.raw));
  const { event, ctx, teams } = await managedEvent(c.env.DB, actor, intParam(c, "id"));
  if (event.cancelled_at) throw conflict("Der Termin ist bereits abgesagt.");
  if (localToInstant(event.starts_at) <= Date.now()) throw conflict("Vergangene Termine können nicht abgesagt werden.");
  await run(
    c.env.DB,
    `UPDATE events SET cancelled_at = ?, cancelled_by = ?, cancel_reason = ?, is_detached = 1,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`,
    utcIso(),
    actor.personId,
    reason,
    event.id,
  );
  const title = eventTitle(event, teams);
  const label = event.kind === "training" ? "Training" : title;
  const when = `${shortDate(event.starts_at)}, ${shortTime(event.starts_at)}`;
  await notifyPersons(
    c.env,
    await affectedPersons(event, ctx),
    "events",
    { title: `Abgesagt: ${label}`, body: `${label} am ${when} fällt aus. Grund: ${reason}`, url: `/termine/${event.id}` },
    { teamIds: teams.map((t) => t.id), exclude: [actor.accountId] },
  );
  c.executionCtx.waitUntil(
    postSystemMessage(c.env, teams.map((t) => t.id), `${actor.firstName} hat ${event.kind === "training" ? "das Training" : label} am ${shortDate(event.starts_at)} abgesagt.`),
  );
  return c.json({ ok: true });
});

eventRoutes.post("/events/:id/uncancel", async (c) => {
  const actor = requireActor(c);
  const { event, ctx, teams } = await managedEvent(c.env.DB, actor, intParam(c, "id"));
  if (!event.cancelled_at) throw conflict("Der Termin ist nicht abgesagt.");
  if (localToInstant(event.starts_at) <= Date.now()) throw conflict("Der Termin liegt in der Vergangenheit.");
  await run(
    c.env.DB,
    `UPDATE events SET cancelled_at = NULL, cancelled_by = NULL, cancel_reason = NULL,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`,
    event.id,
  );
  const label = event.kind === "training" ? "Training" : eventTitle(event, teams);
  await notifyPersons(
    c.env,
    await affectedPersons(event, ctx),
    "events",
    { title: `Findet statt: ${label}`, body: `${label} am ${shortDate(event.starts_at)}, ${shortTime(event.starts_at)} findet doch statt.`, url: `/termine/${event.id}` },
    { teamIds: teams.map((t) => t.id), exclude: [actor.accountId] },
  );
  c.executionCtx.waitUntil(
    postSystemMessage(
      c.env,
      teams.map((t) => t.id),
      `${actor.firstName} hat die Absage zurückgenommen: ${event.kind === "training" ? "Das Training" : label} am ${shortDate(event.starts_at)} findet doch statt.`,
    ),
  );
  return c.json({ ok: true });
});

const updateSchema = z.object({
  title: z.string().trim().min(1).max(80).optional(),
  startsAt: z.string().refine(isLocalDateTime, "Ungültige Uhrzeit").optional(),
  endsAt: z.string().refine(isLocalDateTime, "Ungültige Uhrzeit").nullable().optional(),
  locationId: z.number().int().positive().nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
  meetingPoint: z.string().trim().max(200).nullable().optional(),
  meetingTime: z.string().refine(isTime, "Ungültige Uhrzeit").nullable().optional(),
  coachNotes: z.string().trim().max(1000).nullable().optional(),
  declineHours: z.number().int().min(0).max(168).nullable().optional(),
});

eventRoutes.patch("/events/:id", async (c) => {
  const actor = requireActor(c);
  const input = parse(updateSchema, await readJson(c.req.raw));
  const { event, ctx, teams } = await managedEvent(c.env.DB, actor, intParam(c, "id"));
  const startsAt = input.startsAt ?? event.starts_at;
  const endsAt = input.endsAt === undefined ? event.ends_at : input.endsAt;
  if (endsAt && endsAt <= startsAt) throw badRequest("Das Ende muss nach dem Beginn liegen.");
  if (input.title && event.kind !== "special") throw badRequest("Nur Sondertermine haben einen Titel.");
  if (event.kind === "game" && (input.startsAt || input.locationId !== undefined)) {
    throw badRequest("Anwurf und Halle kommen aus dem Spielplan und lassen sich hier nicht ändern.");
  }
  if (input.locationId != null) {
    const loc = await first(c.env.DB, "SELECT 1 AS ok FROM locations WHERE id = ?", input.locationId);
    if (!loc) throw badRequest("Unbekannter Ort.");
  }
  const moved =
    startsAt !== event.starts_at || (input.locationId !== undefined && input.locationId !== event.location_id) || endsAt !== event.ends_at;
  if (moved && localToInstant(event.starts_at) <= Date.now()) throw conflict("Vergangene Termine können nicht verschoben werden.");

  await run(
    c.env.DB,
    `UPDATE events SET title = ?, starts_at = ?, ends_at = ?, location_id = ?, notes = ?, meeting_point = ?, meeting_time = ?,
       coach_notes = ?, decline_hours = ?, is_detached = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = ?`,
    input.title ?? event.title,
    startsAt,
    endsAt,
    input.locationId === undefined ? event.location_id : input.locationId,
    input.notes === undefined ? event.notes : input.notes,
    input.meetingPoint === undefined ? event.meeting_point : input.meetingPoint,
    input.meetingTime === undefined ? event.meeting_time : input.meetingTime,
    input.coachNotes === undefined ? event.coach_notes : input.coachNotes,
    input.declineHours === undefined ? event.decline_hours : input.declineHours,
    moved ? 1 : event.is_detached,
    event.id,
  );

  if (moved || input.meetingPoint !== undefined || input.meetingTime !== undefined) {
    const fresh = (await loadEvent(c.env.DB, event.id))!;
    const label = event.kind === "training" ? "Training" : eventTitle(event, teams);
    const body = moved
      ? `${label} am ${shortDate(event.starts_at)} ist jetzt am ${shortDate(fresh.starts_at)} um ${shortTime(fresh.starts_at)}${fresh.loc_name ? `, ${fresh.loc_name}` : ""}.`
      : `Neue Infos zu ${label} am ${shortDate(fresh.starts_at)}${fresh.meeting_point ? `: Treffpunkt ${fresh.meeting_point}` : ""}${fresh.meeting_time ? ` um ${fresh.meeting_time}` : ""}.`;
    await notifyPersons(
      c.env,
      await affectedPersons(event, ctx),
      "events",
      { title: moved ? `Geändert: ${label}` : `Info: ${label}`, body, url: `/termine/${event.id}` },
      { teamIds: teams.map((t) => t.id), exclude: [actor.accountId] },
    );
  }
  const fresh = (await loadEvent(c.env.DB, event.id))!;
  return c.json(toDetail(fresh, await loadEventContext(c.env.DB, [fresh]), actor, Date.now()));
});

const remindSchema = z.object({ personIds: z.array(z.number().int().positive()).max(60).optional() });

eventRoutes.post("/events/:id/remind", async (c) => {
  const actor = requireActor(c);
  const { personIds } = parse(remindSchema, await readJson(c.req.raw));
  const { event, ctx, teams } = await managedEvent(c.env.DB, actor, intParam(c, "id"));
  if (event.cancelled_at || localToInstant(event.starts_at) <= Date.now()) throw conflict("Für diesen Termin sind keine Erinnerungen mehr möglich.");
  const open = (ctx.participants.get(event.id) ?? []).filter((p) => p.status === "open").map((p) => p.person.id);
  const targets = personIds ? open.filter((id) => personIds.includes(id)) : open;
  if (!targets.length) return c.json({ sent: 0, persons: 0 });
  // Nicht mehr als eine Sammel-Erinnerung pro Termin und Viertelstunde.
  const key = `remind:${event.id}:${personIds ? targets.join(",") : "all"}`;
  if (await c.env.KV.get(key)) throw conflict("Gerade wurde schon erinnert. Bitte warte ein paar Minuten.", "rate_limited");
  await c.env.KV.put(key, "1", { expirationTtl: 900 });
  const label = event.kind === "training" ? "Training" : eventTitle(event, teams);
  const sent = await notifyPersons(
    c.env,
    targets,
    "reminders",
    {
      title: "Bitte gib Bescheid",
      body: `${label} am ${shortDate(event.starts_at)}, ${shortTime(event.starts_at)}: Bist du dabei?`,
      url: `/termine/${event.id}`,
      tag: `remind-${event.id}`,
    },
    { teamIds: teams.map((t) => t.id) },
  );
  return c.json({ sent, persons: targets.length });
});

// Sondertermine -----------------------------------------------------------------

const specialSchema = z.object({
  title: z.string().trim().min(1, "Bitte gib einen Titel ein.").max(80),
  startsAt: z.string().refine(isLocalDateTime, "Ungültiger Beginn"),
  endsAt: z.string().refine(isLocalDateTime, "Ungültiges Ende").nullable().optional(),
  locationId: z.number().int().positive().nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
  teamIds: z.array(z.number().int().positive()).max(30).default([]),
  clubWide: z.boolean().default(false),
  declineHours: z.number().int().min(0).max(168).nullable().optional(),
  /** Helferdienste als Zeitblöcke; newTypeName legt einen Sonderdienst nur für diesen Termin an. */
  duties: z
    .array(
      z.object({
        dutyTypeId: z.number().int().positive().optional(),
        newTypeName: z.string().trim().min(1).max(40).optional(),
        startsAt: z.string().refine(isLocalDateTime, "Ungültige Uhrzeit"),
        endsAt: z.string().refine(isLocalDateTime, "Ungültige Uhrzeit"),
        slots: z.number().int().min(1).max(20),
      }),
    )
    .max(30)
    .default([]),
});

eventRoutes.post("/events", async (c) => {
  const actor = requireActor(c);
  const input = parse(specialSchema, await readJson(c.req.raw));
  if (input.clubWide) requireAdmin(actor);
  const teamIds = input.clubWide ? [] : [...new Set(input.teamIds)];
  if (!input.clubWide && !teamIds.length) throw badRequest("Bitte wähle mindestens eine Mannschaft.");
  if (teamIds.length > 1 && !actor.isAdmin && !teamIds.every((t) => actor.coachTeamIds.includes(t))) {
    throw forbidden("Termine für mehrere Mannschaften legen Admins oder die Trainer aller Mannschaften an.");
  }
  if (!actor.isAdmin && !teamIds.every((t) => actor.coachTeamIds.includes(t))) throw forbidden("Das dürfen nur Trainer dieser Mannschaft.");
  if (input.startsAt <= nowLocal()) throw badRequest("Der Termin muss in der Zukunft liegen.");
  if (input.endsAt && input.endsAt <= input.startsAt) throw badRequest("Das Ende muss nach dem Beginn liegen.");

  const row = await first<{ id: number }>(
    c.env.DB,
    `INSERT INTO events (kind, title, starts_at, ends_at, location_id, notes, club_wide, decline_hours, created_by)
     VALUES ('special', ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    input.title,
    input.startsAt,
    input.endsAt ?? null,
    input.locationId ?? null,
    input.notes ?? null,
    input.clubWide ? 1 : 0,
    input.declineHours ?? null,
    actor.personId,
  );
  if (teamIds.length) {
    await c.env.DB.batch(teamIds.map((t) => stmt(c.env.DB, "INSERT INTO event_teams (event_id, team_id) VALUES (?, ?)", row!.id, t)));
  }
  if (input.duties.length && teamIds.length) await createDutyBlocks(c.env.DB, row!.id, input.duties);
  const event = (await loadEvent(c.env.DB, row!.id))!;
  const ctx = await loadEventContext(c.env.DB, [event]);
  await notifyPersons(
    c.env,
    (ctx.participants.get(event.id) ?? []).filter((p) => p.isActive).map((p) => p.person.id),
    "events",
    {
      title: `Neuer Termin: ${input.title}`,
      body: `${shortDate(input.startsAt)}, ${shortTime(input.startsAt)}${event.loc_name ? `, ${event.loc_name}` : ""}. Bitte gib Bescheid, ob du dabei bist.`,
      url: `/termine/${event.id}`,
    },
    { teamIds, exclude: [actor.accountId] },
  );
  return c.json(toDetail(event, ctx, actor, Date.now()), 201);
});

/** Zeitblöcke eines neuen Sondertermins; Sonderdienste gleichen Namens werden einmal angelegt. */
async function createDutyBlocks(
  db: D1Database,
  eventId: number,
  blocks: { dutyTypeId?: number; newTypeName?: string; startsAt: string; endsAt: string; slots: number }[],
) {
  const types = await loadDutyTypes(db);
  const created = new Map<string, number>();
  const statements: D1PreparedStatement[] = [];
  for (const [i, b] of blocks.entries()) {
    if (b.endsAt < b.startsAt) throw badRequest("Bei einem Zeitblock liegt das Ende vor dem Beginn.");
    let typeId = b.dutyTypeId ?? null;
    if (typeId != null) {
      const t = types.get(typeId);
      if (!t || t.archived || t.whoReferees) throw badRequest("Diesen Dienst gibt es nicht.");
    } else if (b.newTypeName) {
      const key = b.newTypeName.toLowerCase();
      typeId = created.get(key) ?? null;
      if (typeId == null) {
        const row = await first<{ id: number }>(
          db,
          "INSERT INTO duty_types (name, mode, who_parents, event_id, sort) VALUES (?, 'onsite', 1, ?, 50) RETURNING id",
          b.newTypeName,
          eventId,
        );
        typeId = row!.id;
        created.set(key, typeId);
      }
    } else throw badRequest("Bitte wähle für jeden Zeitblock einen Dienst.");
    statements.push(
      stmt(db, "INSERT INTO event_duties (event_id, duty_type_id, starts_at, ends_at, slots, sort) VALUES (?, ?, ?, ?, ?, ?)", eventId, typeId, b.startsAt, b.endsAt, b.slots, i + 1),
    );
  }
  if (statements.length) await db.batch(statements);
}

eventRoutes.delete("/events/:id", async (c) => {
  const actor = requireActor(c);
  const { event } = await managedEvent(c.env.DB, actor, intParam(c, "id"));
  if (event.kind !== "special") throw badRequest("Nur Sondertermine können gelöscht werden. Trainings und Spiele bitte absagen.");
  await run(c.env.DB, "DELETE FROM events WHERE id = ?", event.id);
  return c.json({ ok: true });
});

// Dauerhafte Abwesenheiten (nur Trainer) ------------------------------------------

const standingSchema = z.object({
  active: z.boolean(),
  validFrom: z.string().refine(isDate).nullable().optional(),
  validTo: z.string().refine(isDate).nullable().optional(),
  reason: z.string().trim().max(200).nullable().optional(),
});

eventRoutes.put("/rules/:ruleId/standing-absences/:personId", async (c) => {
  const actor = requireActor(c);
  const ruleId = intParam(c, "ruleId");
  const personId = intParam(c, "personId");
  const input = parse(standingSchema, await readJson(c.req.raw));
  const ruleTeams = await all<{ team_id: number }>(
    c.env.DB,
    `SELECT rt.team_id FROM rule_teams rt WHERE rt.rule_id = ?
     UNION SELECT tp.team_id FROM training_rules tr JOIN training_plans tp ON tp.id = tr.plan_id WHERE tr.id = ?`,
    ruleId,
    ruleId,
  );
  if (!ruleTeams.length) throw notFound("Diese Trainingszeit gibt es nicht.");
  if (!isCoachOfAny(actor, ruleTeams.map((r) => r.team_id))) throw forbidden("Dauerabwesenheiten setzen nur Trainer.");
  const member = await first(
    c.env.DB,
    "SELECT 1 AS ok FROM team_memberships WHERE person_id = ? AND team_id IN (SELECT value FROM json_each(?)) AND role IN ('player', 'helper')",
    personId,
    list(ruleTeams.map((r) => r.team_id)),
  );
  if (!member) throw badRequest("Diese Person gehört nicht zu den Mannschaften dieser Trainingszeit.");
  if (input.active) {
    await run(
      c.env.DB,
      `INSERT INTO standing_absences (person_id, rule_id, valid_from, valid_to, reason, created_by) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(person_id, rule_id) DO UPDATE SET valid_from = excluded.valid_from, valid_to = excluded.valid_to, reason = excluded.reason`,
      personId,
      ruleId,
      input.validFrom ?? null,
      input.validTo ?? null,
      input.reason ?? null,
      actor.personId,
    );
  } else {
    await run(c.env.DB, "DELETE FROM standing_absences WHERE person_id = ? AND rule_id = ?", personId, ruleId);
  }
  return c.json({ ok: true });
});

export { PARENTS_HANDLE_IT };
