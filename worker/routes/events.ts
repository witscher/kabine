import { t } from "@lingui/core/macro";
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
import { eventLabel, notifyCoaches, notifyPersons, recipientsForPersons, enqueuePush, shortDate, shortTime, staffOf } from "../domain/notify";
import { all, first, list, run, stmt } from "../lib/db";
import { badRequest, conflict, forbidden, notFound, parse, readJson } from "../lib/http";
import { addDays, isDate, isLocalDateTime, isTime, localToInstant, nowLocal, todayLocal, utcIso } from "../lib/time";

export const eventRoutes = new Hono<AppEnv>();

const rangeSchema = z.object({
  from: z.string().refine(isDate, { error: () => t`Invalid date` }).optional(),
  to: z.string().refine(isDate, { error: () => t`Invalid date` }).optional(),
  teamId: z.coerce.number().int().positive().optional(),
  kind: z.enum(["training", "game", "special"]).optional(),
  /** Past events of the season, newest first (from/to are then ignored) */
  past: z.literal("1").optional(),
  /** Page by page for the event overview: the next `limit` relevant events (from/to/teamId/kind are dropped) */
  limit: z.coerce.number().int().min(1).max(200).optional(),
  /** Only with limit: team filter of the event overview, by visibility and relevance */
  team: z.coerce.number().int().positive().optional(),
});

eventRoutes.get("/events", async (c) => {
  const actor = requireActor(c);
  const q = parse(rangeSchema, c.req.query());
  await ensureGenerated(c.env.DB);
  if (q.limit) return c.json(await loadEventPage(c.env.DB, actor, { limit: q.limit, past: !!q.past, teamId: q.team ?? null }));
  const from = q.from ?? todayLocal();
  const to = q.to ?? addDays(from, 70);
  if (to < from) throw badRequest(t`Invalid period.`);
  // Events only exist for the current season; the season change deletes the old ones
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
    // Past games need no more helpers
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

/** Helper plan on the event overview: own duties, else possibly "helpers needed". */
function withDuties<T extends EventSummary>(e: T, duties: Map<number, MyDuty[]>, needed: Map<number, number>): T {
  const myDuties = duties.get(e.id) ?? [];
  // Whoever (or whose family) already has a duty gets no call
  return { ...e, myDuties, helpersNeeded: myDuties.length ? 0 : (needed.get(e.id) ?? 0) };
}

async function visibleEventOr404(db: D1Database, actor: Actor, eventId: number): Promise<EventRow> {
  const event = await loadVisibleEvent(db, actor, eventId);
  if (!event) throw notFound(t`This event does not exist or you cannot see it.`);
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

/** Creator and organisers of a special event; they manage the helper duties. */
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

/** Who changes organisers: coaches of the teams, admins and the creator. */
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
  if (!e || e.kind !== "special") throw notFound(t`Only special events have organisers.`);
  const teamIds = JSON.parse(e.team_ids) as number[];
  if (!mayEditOrganizers(actor, teamIds, e.created_by)) throw forbidden(t`Organisers are changed by coaches, admins and whoever created the event.`);
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
  if (!ok) throw badRequest(t`An organiser can only be a full member with access to the app.`, "not_eligible");
  const res = await run(db, "INSERT OR IGNORE INTO event_organizers (event_id, person_id, added_by) VALUES (?, ?, ?)", event.id, personId, actor.personId);
  if (res.meta.changes && personId !== actor.personId) {
    c.executionCtx.waitUntil(
      notifyPersons(c.env, [personId], "events", () => {
        const eventName = event.title ?? t`Event`;
        return {
          title: t`You are co-organising “${eventName}”`,
          body: t`You can now manage the helper duties of this event.`,
          url: `/termine/${event.id}`,
        };
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

// Responses ----------------------------------------------------------------------

const respondSchema = z.object({
  personId: z.number().int().positive(),
  status: z.enum(["yes", "no"]),
  reason: z.string().trim().max(200, { error: () => t`The reason is too long (at most 200 characters).` }).optional(),
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
  // Coaches of the teams involved and admins may respond for participants,
  // e.g. for families without the app. Parental permissions do not apply then.
  const asCoach = personId !== actor.personId && !actor.children.some((ch) => ch.id === personId) && (event.club_wide === 1 ? actor.isAdmin : isCoachOfAny(actor, teamIds));
  if (!asCoach) requireActFor(actor, personId, status === "yes" ? "may_accept" : "may_decline", teamIds);
  if (event.cancelled_at) throw conflict(t`The event has been cancelled.`);
  if (localToInstant(event.starts_at) <= now) throw conflict(t`The event has already started.`);

  const participant = (ctx.participants.get(event.id) ?? []).find((p) => p.person.id === personId);
  if (!participant) {
    throw forbidden(event.kind === "game" ? t`Only nominated players can respond.` : t`This person does not take part in the event.`);
  }
  if (!participant.isActive) throw conflict(t`Currently marked as inactive. Please talk to your coach.`);
  // Accepting means withdrawing a decline. Whoever has already accepted (also automatically) stays so.
  if (status === "yes" && participant.status === "yes") return toSummary(event, ctx, actor, now);

  const reason = status === "no" ? (reasonInput ?? "").trim() : null;
  if (status === "no" && !reason) throw badRequest(t`Please give a short reason for declining.`, "reason_required");

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

  // Whoever declines no longer looks for a ride
  if (status === "no" && carpoolGame(event)) await releaseRequests(env, { event, ctx, teamIds }, [personId], [actor.accountId]);

  // Notifications: texts per recipient language
  const name = participant.person.firstName;
  const actorName = actor.firstName;
  const training = event.kind === "training";
  const texts = () => ({
    when: `${shortDate(event.starts_at)}, ${shortTime(event.starts_at)}`,
    what: eventLabel(event.kind, eventTitle(event, teams)),
  });
  if (isLate) {
    await notifyCoaches(
      env,
      teams.map((tm) => tm.id),
      () => {
        const { when, what } = texts();
        return {
          title: t`Short-notice decline`,
          body: training ? t`${name} declined training on ${when} at short notice.` : t`${name} declined ${what} on ${when} at short notice.`,
          url: `/termine/${event.id}`,
          tag: `late-${event.id}`,
        };
      },
      { exclude: [actor.accountId] },
    );
  }
  // Inform parents or child when someone else responded.
  const hasOthers = actor.personId !== personId || actor.hasGuardians;
  if (hasOthers) {
    const accounts = await recipientsForPersons(env.DB, [personId], "responses", teamIds);
    const self = actor.personId === personId;
    await enqueuePush(
      env,
      accounts,
      () => {
        const { when, what } = texts();
        const body =
          status === "yes"
            ? self
              ? training
                ? t`${name} accepted training on ${when}.`
                : t`${name} accepted ${what} on ${when}.`
              : training
                ? t`${actorName} accepted training on ${when} for ${name}.`
                : t`${actorName} accepted ${what} on ${when} for ${name}.`
            : self
              ? training
                ? t`${name} declined training on ${when}.`
                : t`${name} declined ${what} on ${when}.`
              : training
                ? t`${actorName} declined training on ${when} for ${name}.`
                : t`${actorName} declined ${what} on ${when} for ${name}.`;
        return { title: status === "yes" ? t`Response: accepted` : t`Response: declined`, body, url: `/termine/${event.id}` };
      },
      { exclude: [actor.accountId] },
    );
  }

  const fresh = (await loadEvent(env.DB, event.id))!;
  const freshCtx = await loadEventContext(env.DB, [fresh]);
  return toSummary(fresh, freshCtx, actor, now);
}

// Management by coaches ------------------------------------------------------

async function managedEvent(db: D1Database, actor: Actor, eventId: number) {
  const event = await loadEvent(db, eventId);
  if (!event) throw notFound(t`This event does not exist.`);
  const ctx = await loadEventContext(db, [event]);
  const teams = eventTeams(event, ctx);
  const allowed = event.club_wide === 1 ? actor.isAdmin : isCoachOfAny(actor, teams.map((t) => t.id));
  if (!allowed) throw forbidden(t`Only coaches of the teams involved may do this.`);
  return { event, ctx, teams };
}

/** Persons who are informed about changes to an event. */
async function affectedPersons(db: D1Database, event: EventRow, ctx: Awaited<ReturnType<typeof loadEventContext>>): Promise<number[]> {
  const parts = ctx.participants.get(event.id) ?? [];
  const ids = new Set(parts.filter((p) => p.status !== "inactive" && p.status !== "standing").map((p) => p.person.id));
  if (event.kind === "game") {
    for (const m of ctx.members.get(event.id)?.values() ?? []) if (m.is_active === 1) ids.add(m.person_id);
  }
  const teamIds = (await all<{ team_id: number }>(db, "SELECT team_id FROM event_teams WHERE event_id = ?", event.id)).map((r) => r.team_id);
  for (const id of await staffOf(db, teamIds)) ids.add(id);
  return [...ids];
}

/** After the start: coaches mark who was absent without excuse despite accepting. */
eventRoutes.put("/events/:id/unexcused/:personId", async (c) => {
  const actor = requireActor(c);
  const personId = intParam(c, "personId");
  const { unexcused } = parse(z.object({ unexcused: z.boolean() }), await readJson(c.req.raw));
  const { event, ctx } = await managedEvent(c.env.DB, actor, intParam(c, "id"));
  if (event.cancelled_at) throw conflict(t`The event has been cancelled.`);
  if (localToInstant(event.starts_at) > Date.now()) throw conflict(t`This is only possible once the event has started.`);
  const part = (ctx.participants.get(event.id) ?? []).find((p) => p.person.id === personId);
  if (!part) throw notFound(t`This person does not take part in the event.`);
  if (unexcused && part.status !== "yes" && part.status !== "open") {
    throw conflict(t`Anyone who declined, is permanently absent or inactive is excused.`);
  }
  // If the event is already in the attendance record, it is updated as well
  await c.env.DB.batch([
    unexcused
      ? stmt(c.env.DB, "INSERT OR IGNORE INTO unexcused_absences (event_id, person_id, marked_by) VALUES (?, ?, ?)", event.id, personId, actor.personId)
      : stmt(c.env.DB, "DELETE FROM unexcused_absences WHERE event_id = ? AND person_id = ?", event.id, personId),
    attendanceUpdate(c.env.DB, event.id, personId, attendanceStatus(part.status, unexcused)),
  ]);
  return c.json({ ok: true });
});

const cancelSchema = z.object({ reason: z.string().trim().min(1, { error: () => t`Please give a reason.` }).max(200) });

eventRoutes.post("/events/:id/cancel", async (c) => {
  const actor = requireActor(c);
  const { reason } = parse(cancelSchema, await readJson(c.req.raw));
  const { event, ctx, teams } = await managedEvent(c.env.DB, actor, intParam(c, "id"));
  if (event.cancelled_at) throw conflict(t`The event is already cancelled.`);
  if (localToInstant(event.starts_at) <= Date.now()) throw conflict(t`Past events cannot be cancelled.`);
  await run(
    c.env.DB,
    `UPDATE events SET cancelled_at = ?, cancelled_by = ?, cancel_reason = ?, is_detached = 1,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`,
    utcIso(),
    actor.personId,
    reason,
    event.id,
  );
  const labelOf = () => (event.kind === "training" ? t`Training` : eventTitle(event, teams));
  await notifyPersons(
    c.env,
    await affectedPersons(c.env.DB, event, ctx),
    "events",
    () => {
      const label = labelOf();
      const when = `${shortDate(event.starts_at)}, ${shortTime(event.starts_at)}`;
      return { title: t`Cancelled: ${label}`, body: t`${label} on ${when} is cancelled. Reason: ${reason}`, url: `/termine/${event.id}` };
    },
    { teamIds: teams.map((tm) => tm.id), exclude: [actor.accountId] },
  );
  const actorName = actor.firstName;
  const label = labelOf();
  const date = shortDate(event.starts_at);
  c.executionCtx.waitUntil(
    postSystemMessage(
      c.env,
      teams.map((tm) => tm.id),
      event.kind === "training" ? t`${actorName} cancelled training on ${date}.` : t`${actorName} cancelled ${label} on ${date}.`,
    ),
  );
  return c.json({ ok: true });
});

eventRoutes.post("/events/:id/uncancel", async (c) => {
  const actor = requireActor(c);
  const { event, ctx, teams } = await managedEvent(c.env.DB, actor, intParam(c, "id"));
  if (!event.cancelled_at) throw conflict(t`The event is not cancelled.`);
  if (localToInstant(event.starts_at) <= Date.now()) throw conflict(t`The event is in the past.`);
  await run(
    c.env.DB,
    `UPDATE events SET cancelled_at = NULL, cancelled_by = NULL, cancel_reason = NULL,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`,
    event.id,
  );
  const labelOf = () => (event.kind === "training" ? t`Training` : eventTitle(event, teams));
  await notifyPersons(
    c.env,
    await affectedPersons(c.env.DB, event, ctx),
    "events",
    () => {
      const label = labelOf();
      const when = `${shortDate(event.starts_at)}, ${shortTime(event.starts_at)}`;
      return { title: t`Going ahead: ${label}`, body: t`${label} on ${when} is going ahead after all.`, url: `/termine/${event.id}` };
    },
    { teamIds: teams.map((tm) => tm.id), exclude: [actor.accountId] },
  );
  const actorName = actor.firstName;
  const label = labelOf();
  const date = shortDate(event.starts_at);
  c.executionCtx.waitUntil(
    postSystemMessage(
      c.env,
      teams.map((tm) => tm.id),
      event.kind === "training"
        ? t`${actorName} withdrew the cancellation: training on ${date} is going ahead after all.`
        : t`${actorName} withdrew the cancellation: ${label} on ${date} is going ahead after all.`,
    ),
  );
  return c.json({ ok: true });
});

const updateSchema = z.object({
  title: z.string().trim().min(1).max(80).optional(),
  startsAt: z.string().refine(isLocalDateTime, { error: () => t`Invalid time` }).optional(),
  endsAt: z.string().refine(isLocalDateTime, { error: () => t`Invalid time` }).nullable().optional(),
  locationId: z.number().int().positive().nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
  meetingPoint: z.string().trim().max(200).nullable().optional(),
  meetingTime: z.string().refine(isTime, { error: () => t`Invalid time` }).nullable().optional(),
  coachNotes: z.string().trim().max(1000).nullable().optional(),
  declineHours: z.number().int().min(0).max(168).nullable().optional(),
});

eventRoutes.patch("/events/:id", async (c) => {
  const actor = requireActor(c);
  const input = parse(updateSchema, await readJson(c.req.raw));
  const { event, ctx, teams } = await managedEvent(c.env.DB, actor, intParam(c, "id"));
  const startsAt = input.startsAt ?? event.starts_at;
  const endsAt = input.endsAt === undefined ? event.ends_at : input.endsAt;
  if (endsAt && endsAt <= startsAt) throw badRequest(t`The end must be after the start.`);
  if (input.title && event.kind !== "special") throw badRequest(t`Only special events have a title.`);
  if (event.kind === "game" && (input.startsAt || input.locationId !== undefined)) {
    throw badRequest(t`Throw-off and hall come from the schedule and cannot be changed here.`);
  }
  if (input.locationId != null) {
    const loc = await first(c.env.DB, "SELECT 1 AS ok FROM locations WHERE id = ?", input.locationId);
    if (!loc) throw badRequest(t`Unknown location.`);
  }
  const moved =
    startsAt !== event.starts_at || (input.locationId !== undefined && input.locationId !== event.location_id) || endsAt !== event.ends_at;
  if (moved && localToInstant(event.starts_at) <= Date.now()) throw conflict(t`Past events cannot be moved.`);

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
    const location = fresh.loc_name;
    const point = fresh.meeting_point;
    const meetAt = fresh.meeting_time;
    await notifyPersons(
      c.env,
      await affectedPersons(c.env.DB, event, ctx),
      "events",
      () => {
        const label = event.kind === "training" ? t`Training` : eventTitle(event, teams);
        const oldDate = shortDate(event.starts_at);
        const date = shortDate(fresh.starts_at);
        const time = shortTime(fresh.starts_at);
        const body = moved
          ? location
            ? t`${label} on ${oldDate} is now on ${date} at ${time}, ${location}.`
            : t`${label} on ${oldDate} is now on ${date} at ${time}.`
          : point
            ? meetAt
              ? t`New info on ${label} on ${date}: meeting point ${point} at ${meetAt}.`
              : t`New info on ${label} on ${date}: meeting point ${point}.`
            : meetAt
              ? t`New info on ${label} on ${date} at ${meetAt}.`
              : t`New info on ${label} on ${date}.`;
        return { title: moved ? t`Changed: ${label}` : t`Info: ${label}`, body, url: `/termine/${event.id}` };
      },
      { teamIds: teams.map((tm) => tm.id), exclude: [actor.accountId] },
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
  if (event.cancelled_at || localToInstant(event.starts_at) <= Date.now()) throw conflict(t`Reminders are no longer possible for this event.`);
  const open = (ctx.participants.get(event.id) ?? []).filter((p) => p.status === "open").map((p) => p.person.id);
  const targets = personIds ? open.filter((id) => personIds.includes(id)) : open;
  if (!targets.length) return c.json({ sent: 0, persons: 0 });
  // No more than one group reminder per event and quarter of an hour.
  const key = `remind:${event.id}:${personIds ? targets.join(",") : "all"}`;
  if (await c.env.KV.get(key)) throw conflict(t`A reminder was just sent. Please wait a few minutes.`, "rate_limited");
  await c.env.KV.put(key, "1", { expirationTtl: 900 });
  const sent = await notifyPersons(
    c.env,
    targets,
    "reminders",
    () => {
      const label = event.kind === "training" ? t`Training` : eventTitle(event, teams);
      const when = `${shortDate(event.starts_at)}, ${shortTime(event.starts_at)}`;
      return {
        title: t`Please let us know`,
        body: t`${label} on ${when}: are you coming?`,
        url: `/termine/${event.id}`,
        tag: `remind-${event.id}`,
      };
    },
    { teamIds: teams.map((tm) => tm.id) },
  );
  return c.json({ sent, persons: targets.length });
});

// Special events -----------------------------------------------------------------

const specialSchema = z.object({
  title: z.string().trim().min(1, { error: () => t`Please enter a title.` }).max(80),
  startsAt: z.string().refine(isLocalDateTime, { error: () => t`Invalid start` }),
  endsAt: z.string().refine(isLocalDateTime, { error: () => t`Invalid end` }).nullable().optional(),
  locationId: z.number().int().positive().nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
  teamIds: z.array(z.number().int().positive()).max(30).default([]),
  clubWide: z.boolean().default(false),
  declineHours: z.number().int().min(0).max(168).nullable().optional(),
  /** Helper duties as time blocks; newTypeName creates a special duty for this event only. */
  duties: z
    .array(
      z.object({
        dutyTypeId: z.number().int().positive().optional(),
        newTypeName: z.string().trim().min(1).max(40).optional(),
        startsAt: z.string().refine(isLocalDateTime, { error: () => t`Invalid time` }),
        endsAt: z.string().refine(isLocalDateTime, { error: () => t`Invalid time` }),
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
  if (!input.clubWide && !teamIds.length) throw badRequest(t`Please choose at least one team.`);
  if (teamIds.length > 1 && !actor.isAdmin && !teamIds.every((t) => actor.coachTeamIds.includes(t))) {
    throw forbidden(t`Events for several teams are created by admins or the coaches of all those teams.`);
  }
  if (!actor.isAdmin && !teamIds.every((t) => actor.coachTeamIds.includes(t))) throw forbidden(t`Only coaches of this team may do this.`);
  if (input.startsAt <= nowLocal()) throw badRequest(t`The event must be in the future.`);
  if (input.endsAt && input.endsAt <= input.startsAt) throw badRequest(t`The end must be after the start.`);

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
  const title = input.title;
  const location = event.loc_name;
  await notifyPersons(
    c.env,
    (ctx.participants.get(event.id) ?? []).filter((p) => p.isActive).map((p) => p.person.id),
    "events",
    () => {
      const when = `${shortDate(input.startsAt)}, ${shortTime(input.startsAt)}`;
      return {
        title: t`New event: ${title}`,
        body: location ? t`${when}, ${location}. Please let us know if you are coming.` : t`${when}. Please let us know if you are coming.`,
        url: `/termine/${event.id}`,
      };
    },
    { teamIds, exclude: [actor.accountId] },
  );
  // Staff do not respond, so their message carries no request
  await notifyPersons(
    c.env,
    await staffOf(c.env.DB, teamIds),
    "events",
    () => {
      const when = `${shortDate(input.startsAt)}, ${shortTime(input.startsAt)}`;
      return { title: t`New event: ${title}`, body: location ? `${when}, ${location}` : when, url: `/termine/${event.id}` };
    },
    { teamIds, exclude: [actor.accountId] },
  );
  return c.json(toDetail(event, ctx, actor, Date.now()), 201);
});

/** Time blocks of a new special event; special duties with the same name are created once. */
async function createDutyBlocks(
  db: D1Database,
  eventId: number,
  blocks: { dutyTypeId?: number; newTypeName?: string; startsAt: string; endsAt: string; slots: number }[],
) {
  const types = await loadDutyTypes(db);
  const created = new Map<string, number>();
  const statements: D1PreparedStatement[] = [];
  for (const [i, b] of blocks.entries()) {
    if (b.endsAt < b.startsAt) throw badRequest(t`In one time block the end is before the start.`);
    let typeId = b.dutyTypeId ?? null;
    if (typeId != null) {
      const type = types.get(typeId);
      if (!type || type.archived || type.whoReferees) throw badRequest(t`This duty does not exist.`);
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
    } else throw badRequest(t`Please choose a duty for each time block.`);
    statements.push(
      stmt(db, "INSERT INTO event_duties (event_id, duty_type_id, starts_at, ends_at, slots, sort) VALUES (?, ?, ?, ?, ?, ?)", eventId, typeId, b.startsAt, b.endsAt, b.slots, i + 1),
    );
  }
  if (statements.length) await db.batch(statements);
}

eventRoutes.delete("/events/:id", async (c) => {
  const actor = requireActor(c);
  const { event } = await managedEvent(c.env.DB, actor, intParam(c, "id"));
  if (event.kind !== "special") throw badRequest(t`Only special events can be deleted. Please cancel trainings and games instead.`);
  await run(c.env.DB, "DELETE FROM events WHERE id = ?", event.id);
  return c.json({ ok: true });
});

// Standing absences (coaches only) ------------------------------------------

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
  if (!ruleTeams.length) throw notFound(t`This training time does not exist.`);
  if (!isCoachOfAny(actor, ruleTeams.map((r) => r.team_id))) throw forbidden(t`Only coaches set standing absences.`);
  const member = await first(
    c.env.DB,
    "SELECT 1 AS ok FROM team_memberships WHERE person_id = ? AND team_id IN (SELECT value FROM json_each(?)) AND role IN ('player', 'helper')",
    personId,
    list(ruleTeams.map((r) => r.team_id)),
  );
  if (!member) throw badRequest(t`This person does not belong to the teams of this training time.`);
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
