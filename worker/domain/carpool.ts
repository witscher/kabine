// Carpools for away games (see docs/design.md, Carpools).
// Drivers offer free seats, passengers book themselves. The system assigns nothing, it only notifies.
import { plural, t } from "@lingui/core/macro";
import type { CarpoolInfo, CarpoolOffer, CarpoolPersonRef, CarpoolRequest } from "../../shared/types";
import { type Actor, actsFor, isCoachOfAny, parentsInChargeSql, scopePersonIds } from "../auth/actor";
import { all, list, run } from "../lib/db";
import { conflict } from "../lib/http";
import { addDays, localToInstant, toLocal, todayLocal } from "../lib/time";
import { clockTimeIn } from "../../shared/dates";
import { currentLocale } from "../i18n";
import { postSystemMessage } from "./chat";
import { SHORT_NAME_SQL } from "./duties";
import type { PersonRef } from "../../shared/types";
import { type EventContext, type EventRow, EVENT_SELECT, eventTeams, eventTitle, loadEventContext } from "./events";
import { notifyPersons, shortDate, shortTime } from "./notify";
import { isModuleOn } from "./club";

/** At most this many free seats per driver. */
export const MAX_SEATS = 8;
/** Companions per search (parents), so 1 to 3 seats needed. */
export const MAX_COMPANIONS = 2;
/** Chat note on the day before: once from each of these hours. */
export const CHAT_REMINDER_HOURS = [10, 18] as const;

export interface OfferRow {
  id: number;
  person_id: number;
  seats: number;
  name: string;
}

export interface RequestRow {
  id: number;
  player_id: number;
  companions: number;
  offer_id: number | null;
  name: string;
}

/** Carpools exist for away games. */
export function carpoolGame(e: EventRow): boolean {
  return e.kind === "game" && e.is_home === 0 && isModuleOn("carpools");
}

export function carpoolOpen(e: EventRow, now: number): boolean {
  return carpoolGame(e) && !e.cancelled_at && localToInstant(e.starts_at) > now;
}

export const seatsOf = (r: { companions: number }) => 1 + r.companions;

/** „Lena M. + 1“ */
export function riderLabel(r: { name: string; companions: number }): string {
  return r.companions ? `${r.name} + ${r.companions}` : r.name;
}

export interface Rider {
  person: PersonRef;
  coach: boolean;
}

/**
 * Passengers can be nominated players who have not declined and are active, and the
 * coaches of the teams involved.
 */
export async function eligibleRiders(db: D1Database, e: EventRow, ctx: EventContext): Promise<Rider[]> {
  const players: Rider[] = (ctx.participants.get(e.id) ?? [])
    .filter((p) => p.status !== "no" && p.status !== "inactive")
    .map((p) => ({ person: p.person, coach: false }));
  const coaches = await all<{ id: number; first_name: string; last_name: string | null }>(
    db,
    `SELECT DISTINCT p.id, p.first_name, p.last_name FROM team_memberships tm JOIN persons p ON p.id = tm.person_id
      WHERE tm.role = 'coach' AND tm.team_id IN (SELECT value FROM json_each(?)) AND p.is_former = 0 AND p.is_active = 1
      ORDER BY p.first_name, p.last_name, p.id`,
    list(ctx.eventTeams.get(e.id) ?? []),
  );
  const ids = new Set(players.map((p) => p.person.id));
  return [
    ...players,
    ...coaches.filter((c) => !ids.has(c.id)).map((c) => ({ person: { id: c.id, firstName: c.first_name, lastName: c.last_name }, coach: true })),
  ];
}

function shortName(p: { firstName: string; lastName: string | null }): string {
  return p.lastName ? `${p.firstName} ${p.lastName.charAt(0)}.` : p.firstName;
}

export async function loadCarpoolRows(db: D1Database, eventId: number): Promise<{ offers: OfferRow[]; requests: RequestRow[] }> {
  const [offers, requests] = await db.batch([
    db
      .prepare(
        `SELECT o.id, o.person_id, o.seats, ${SHORT_NAME_SQL("p")} AS name
           FROM carpool_offers o JOIN persons p ON p.id = o.person_id
          WHERE o.event_id = ? ORDER BY o.created_at, o.id`,
      )
      .bind(eventId),
    db
      .prepare(
        `SELECT r.id, r.player_id, r.companions, r.offer_id, ${SHORT_NAME_SQL("p")} AS name
           FROM carpool_requests r JOIN persons p ON p.id = r.player_id
          WHERE r.event_id = ? ORDER BY r.created_at, r.id`,
      )
      .bind(eventId),
  ]);
  return { offers: offers!.results as OfferRow[], requests: requests!.results as RequestRow[] };
}

export function takenSeats(offerId: number, requests: RequestRow[]): number {
  return requests.filter((r) => r.offer_id === offerId).reduce((sum, r) => sum + seatsOf(r), 0);
}

/**
 * Who is involved in the game and sees the carpools: coaches and admins, whoever
 * has an offer, and once the squad is published the nominated players and
 * their parents in charge.
 */
export function mayViewCarpool(actor: Actor, e: EventRow, ctx: EventContext, offers: OfferRow[]): boolean {
  const teamIds = ctx.eventTeams.get(e.id) ?? [];
  if (isCoachOfAny(actor, teamIds)) return true;
  if (offers.some((o) => o.person_id === actor.personId)) return true;
  if (!e.squad_published_at) return false;
  const family = scopePersonIds(actor).filter((pid) => actsFor(actor, pid, teamIds));
  return (ctx.participants.get(e.id) ?? []).some((p) => family.includes(p.person.id));
}

/**
 * Family conflict: whoever drives does not search for themselves or their child, and vice versa.
 * driverId and playerId are the two sides; the other one is checked.
 */
/** SQL: the family of person ?2 (themselves, parents, children, siblings). */
const FAMILY_SQL = `SELECT ?2 AS id
   UNION SELECT guardian_id FROM guardianships WHERE child_id = ?2
   UNION SELECT child_id FROM guardianships WHERE guardian_id = ?2
   UNION SELECT g2.child_id FROM guardianships g1 JOIN guardianships g2 ON g2.guardian_id = g1.guardian_id WHERE g1.child_id = ?2`;

/**
 * Family conflict: if a family member (parents, children, siblings) drives, the whole family counts as covered.
 * So whoever drives does not search for anyone in the family, and vice versa. There is at most one search
 * per family; further family members ride along there as companions.
 */
export async function familyConflict(
  db: D1Database,
  eventId: number,
  side: { driverId: number } | { playerId: number },
): Promise<"driving" | "searching" | null> {
  if ("driverId" in side) {
    const rows = await all(db, `SELECT 1 FROM carpool_requests r WHERE r.event_id = ?1 AND r.player_id IN (${FAMILY_SQL})`, eventId, side.driverId);
    return rows.length ? "searching" : null;
  }
  const driving = await all(db, `SELECT 1 FROM carpool_offers o WHERE o.event_id = ?1 AND o.person_id IN (${FAMILY_SQL})`, eventId, side.playerId);
  if (driving.length) return "driving";
  const searching = await all(
    db,
    `SELECT 1 FROM carpool_requests r WHERE r.event_id = ?1 AND r.player_id <> ?2 AND r.player_id IN (${FAMILY_SQL})`,
    eventId,
    side.playerId,
  );
  return searching.length ? "searching" : null;
}

/**
 * Drivers coaches can enter: nominated players, their parents (where parents
 * are involved) and the coaches of the teams involved.
 */
export async function driverCandidates(db: D1Database, e: EventRow, ctx: EventContext): Promise<CarpoolPersonRef[]> {
  const teamIds = ctx.eventTeams.get(e.id) ?? [];
  const playerIds = (ctx.participants.get(e.id) ?? []).filter((p) => p.status !== "inactive").map((p) => p.person.id);
  return all<CarpoolPersonRef>(
    db,
    `SELECT p.id, ${SHORT_NAME_SQL("p")} AS name FROM persons p
      WHERE p.is_former = 0 AND (
        p.id IN (SELECT value FROM json_each(?1))
        OR p.id IN (SELECT g.guardian_id FROM guardianships g
                     WHERE g.child_id IN (SELECT value FROM json_each(?1))
                       AND ${parentsInChargeSql("g.child_id", "SELECT value FROM json_each(?2)")})
        OR p.id IN (SELECT person_id FROM team_memberships WHERE role = 'coach' AND team_id IN (SELECT value FROM json_each(?2)))
      )
      ORDER BY p.first_name, p.last_name, p.id`,
    list(playerIds),
    list(teamIds),
  );
}

/**
 * Summary for the event overview: taken and offered seats, plus who is still looking.
 * Only upcoming away games with at least one entry and only for those involved (like the detail view).
 */
export async function loadCarpoolCounts(
  db: D1Database,
  actor: Actor,
  events: EventRow[],
  ctx: EventContext,
  now: number,
): Promise<Map<number, { taken: number; seats: number; waiting: number }>> {
  const out = new Map<number, { taken: number; seats: number; waiting: number }>();
  const games = events.filter((e) => carpoolOpen(e, now));
  if (!games.length) return out;
  const ids = list(games.map((e) => e.id));
  const [offers, requests] = await Promise.all([
    all<{ id: number; event_id: number; person_id: number; seats: number }>(
      db,
      "SELECT id, event_id, person_id, seats FROM carpool_offers WHERE event_id IN (SELECT value FROM json_each(?))",
      ids,
    ),
    all<{ event_id: number; offer_id: number | null; companions: number }>(
      db,
      "SELECT event_id, offer_id, companions FROM carpool_requests WHERE event_id IN (SELECT value FROM json_each(?))",
      ids,
    ),
  ]);
  for (const e of games) {
    const o = offers.filter((x) => x.event_id === e.id);
    const r = requests.filter((x) => x.event_id === e.id);
    if (!o.length && !r.length) continue;
    if (!mayViewCarpool(actor, e, ctx, o.map((x) => ({ id: x.id, person_id: x.person_id, seats: x.seats, name: "" })))) continue;
    out.set(e.id, {
      seats: o.reduce((n, x) => n + x.seats, 0),
      taken: r.filter((x) => x.offer_id != null).reduce((n, x) => n + seatsOf(x), 0),
      waiting: r.filter((x) => x.offer_id == null).length,
    });
  }
  return out;
}

/** Carpools for the detail view; null if there are none or the account is not involved. */
export async function loadCarpool(db: D1Database, actor: Actor, e: EventRow, ctx: EventContext, now: number): Promise<CarpoolInfo | null> {
  if (!carpoolGame(e)) return null;
  const { offers, requests } = await loadCarpoolRows(db, e.id);
  if (!mayViewCarpool(actor, e, ctx, offers)) return null;
  const teamIds = ctx.eventTeams.get(e.id) ?? [];
  const manage = isCoachOfAny(actor, teamIds);
  const open = carpoolOpen(e, now);
  const riders = await eligibleRiders(db, e, ctx);
  const riderIds = new Set(riders.map((p) => p.person.id));
  const family = new Set(scopePersonIds(actor).filter((pid) => actsFor(actor, pid, teamIds)));

  const toRequest = (r: RequestRow): CarpoolRequest => ({
    id: r.id,
    playerId: r.player_id,
    name: r.name,
    companions: r.companions,
    seats: seatsOf(r),
    offerId: r.offer_id,
    mine: family.has(r.player_id),
    canEdit: open && (manage || family.has(r.player_id)),
  });
  const offerList: CarpoolOffer[] = offers.map((o) => ({
    id: o.id,
    personId: o.person_id,
    name: o.name,
    seats: o.seats,
    free: Math.max(0, o.seats - takenSeats(o.id, requests)),
    riders: requests.filter((r) => r.offer_id === o.id).map(toRequest),
    mine: o.person_id === actor.personId,
    canEdit: open && (manage || o.person_id === actor.personId),
  }));
  // Whoever declined or is no longer nominated no longer searches (searches are deleted then, this is only a safeguard)
  const waiting = requests.filter((r) => r.offer_id == null && riderIds.has(r.player_id)).map(toRequest);
  // If someone in the family (parents, children, siblings) drives, the family is covered: offer no search.
  // If someone in the family already searches, the others ride along there as companions: no second search.
  const drivers = new Set(offers.map((o) => o.person_id));
  const searchers = new Set(requests.map((r) => r.player_id));
  const links = drivers.size || searchers.size
    ? await all<{ guardian_id: number; child_id: number }>(
        db,
        `SELECT guardian_id, child_id FROM guardianships
          WHERE guardian_id IN (SELECT value FROM json_each(?1)) OR child_id IN (SELECT value FROM json_each(?1))
             OR guardian_id IN (SELECT guardian_id FROM guardianships WHERE child_id IN (SELECT value FROM json_each(?1)))`,
        list([...family]),
      )
    : [];
  const familyOf = (pid: number) => {
    const parents = links.filter((l) => l.child_id === pid).map((l) => l.guardian_id);
    const kids = links.filter((l) => l.guardian_id === pid).map((l) => l.child_id);
    const siblings = links.filter((l) => parents.includes(l.guardian_id)).map((l) => l.child_id);
    return [pid, ...parents, ...kids, ...siblings];
  };
  const driving = (pid: number) => familyOf(pid).some((x) => drivers.has(x));
  const othersSearch = (pid: number) => familyOf(pid).some((x) => x !== pid && searchers.has(x));
  // Parents of the passengers with names, to choose as companions (only for one's own family and for coaches)
  const guardianRows = await all<{ child_id: number; id: number; first_name: string; last_name: string | null }>(
    db,
    `SELECT g.child_id, p.id, p.first_name, p.last_name FROM guardianships g JOIN persons p ON p.id = g.guardian_id AND p.is_former = 0
      WHERE g.child_id IN (SELECT value FROM json_each(?)) ORDER BY p.first_name, p.last_name, p.id`,
    list(manage ? [...riderIds] : [...family]),
  );
  const guardiansOf = (pid: number) =>
    guardianRows.filter((g) => g.child_id === pid).map((g) => ({ id: g.id, name: shortName({ firstName: g.first_name, lastName: g.last_name }) }));
  const toRider = (p: Rider) => ({ id: p.person.id, name: shortName(p.person), coach: p.coach, guardians: p.coach ? [] : guardiansOf(p.person.id) });
  const mine = riders
    .filter((p) => family.has(p.person.id))
    .filter((p) => searchers.has(p.person.id) || (!driving(p.person.id) && !othersSearch(p.person.id)))
    .map((p) => {
      const req = requests.find((r) => r.player_id === p.person.id);
      return { player: { ...toRider(p), self: p.person.id === actor.personId }, request: req ? toRequest(req) : null };
    });
  const familyIds = [...family];
  const familySearches = requests.some((r) => familyIds.includes(r.player_id));
  return {
    open,
    offers: offerList,
    waiting,
    mine,
    canOffer: open && !offers.some((o) => o.person_id === actor.personId) && !familySearches,
    coach:
      manage && open
        ? { drivers: await driverCandidates(db, e, ctx), riders: riders.map(toRider) }
        : null,
  };
}

// Notifications --------------------------------------------------------------------

export interface CarpoolEvent {
  event: EventRow;
  ctx: EventContext;
  teamIds: number[];
}

/** "Game on Fri 2 Oct, 14:00", in the current language. */
export function gameWhat(c: CarpoolEvent): string {
  const title = eventTitle(c.event, eventTeams(c.event, c.ctx));
  const date = shortDate(c.event.starts_at);
  const time = clockTimeIn(currentLocale(), shortTime(c.event.starts_at));
  return t`${title} on ${date}, ${time}`;
}

/**
 * Push to persons (and their parents in charge), topic carpools. content builds title and body;
 * it runs in the language of the recipients, so call gameWhat inside it.
 */
export async function notifyCarpool(
  env: Env,
  c: CarpoolEvent,
  personIds: number[],
  content: () => { title: string; body: string },
  exclude: number[] = [],
): Promise<number> {
  return notifyPersons(env, personIds, "carpool", () => ({ ...content(), url: `/termine/${c.event.id}`, tag: `carpool-${c.event.id}` }), {
    teamIds: c.teamIds,
    exclude,
  });
}

/** Mark an offer/search pair as notified; true if it is new. */
async function claimMatch(db: D1Database, offerId: number, requestId: number): Promise<boolean> {
  const res = await run(db, "INSERT OR IGNORE INTO duty_notifications (kind, ref) VALUES ('carpool-match', ?)", `${offerId}:${requestId}`);
  return (res.meta.changes ?? 0) > 0;
}

/** Mark without a push: whoever already knows the offer (just seen, just left) gets no note about it. */
export async function suppressMatches(db: D1Database, pairs: [offerId: number, requestId: number][]): Promise<void> {
  for (const [o, r] of pairs) await claimMatch(db, o, r);
}

/**
 * Those waiting whose seats needed fit into an offer get a push.
 * At most once per offer/search pair. Whoever books first gets the seat.
 */
export async function notifyMatches(env: Env, c: CarpoolEvent, exclude: number[] = []): Promise<number> {
  if (!carpoolOpen(c.event, Date.now())) return 0;
  const { offers, requests } = await loadCarpoolRows(env.DB, c.event.id);
  const riderIds = new Set((await eligibleRiders(env.DB, c.event, c.ctx)).map((p) => p.person.id));
  const free = offers.map((o) => ({ ...o, free: o.seats - takenSeats(o.id, requests) })).sort((a, b) => b.free - a.free);
  let sent = 0;
  for (const r of requests) {
    if (r.offer_id != null || !riderIds.has(r.player_id)) continue;
    let best: (typeof free)[number] | null = null;
    for (const o of free) {
      if (o.free < seatsOf(r) || o.person_id === r.player_id) continue;
      if (await claimMatch(env.DB, o.id, r.id)) best ??= o;
    }
    if (!best) continue;
    const driver = best.name;
    const seats = best.free;
    sent += await notifyCarpool(
      env,
      c,
      [r.player_id],
      () => {
        const game = gameWhat(c);
        return {
          title: t`Lift available`,
          body: plural(seats, {
            one: `${driver} has one free seat: ${game}. Book it in the app.`,
            other: `${driver} has # free seats: ${game}. Book it in the app.`,
          }),
        };
      },
      exclude,
    );
  }
  return sent;
}

/**
 * Delete searches of players who declined or are no longer in the squad.
 * Booked drivers are told, seats that became free go to those waiting.
 */
export async function releaseRequests(env: Env, c: CarpoolEvent, playerIds: number[], exclude: number[] = []): Promise<void> {
  if (!playerIds.length || !carpoolGame(c.event)) return;
  const { offers, requests } = await loadCarpoolRows(env.DB, c.event.id);
  const gone = requests.filter((r) => playerIds.includes(r.player_id));
  if (!gone.length) return;
  await run(env.DB, "DELETE FROM carpool_requests WHERE id IN (SELECT value FROM json_each(?))", list(gone.map((r) => r.id)));
  if (!carpoolOpen(c.event, Date.now())) return;
  for (const r of gone) {
    const offer = offers.find((o) => o.id === r.offer_id);
    const rider = riderLabel(r);
    if (offer) {
      await notifyCarpool(env, c, [offer.person_id], () => {
        const game = gameWhat(c);
        return { title: t`Lift is off`, body: t`${rider} is not riding with you: ${game}.` };
      }, exclude);
    }
  }
  if (gone.some((r) => r.offer_id != null)) await notifyMatches(env, c, exclude);
}

export function assertNoConflict(kind: "driving" | "searching" | null, side: "driver" | "rider"): void {
  if (!kind) return;
  throw conflict(
    side === "driver"
      ? t`This family is already looking for a lift. Please delete the search first.`
      : kind === "driving"
        ? t`Someone in this family is already driving. Please withdraw the offer first.`
        : t`Someone in this family is already looking for a lift. Further family members ride along there as companions.`,
    "carpool_family",
  );
}

// Chat on the day before ------------------------------------------------------------

/**
 * On the day before an away game at 10 am and 6 pm: who is still looking is posted in the
 * team chat. Once per game, team and hour, only if someone is looking.
 */
export async function sendCarpoolChatReminders(env: Env, now = Date.now()): Promise<number> {
  if (!isModuleOn("carpools")) return 0;
  const hour = Number(toLocal(now).slice(11, 13));
  const slot = [...CHAT_REMINDER_HOURS].reverse().find((h) => hour >= h);
  if (slot == null) return 0;
  const tomorrow = addDays(todayLocal(now), 1);
  const games = await all<EventRow>(
    env.DB,
    `${EVENT_SELECT} WHERE e.kind = 'game' AND e.is_home = 0 AND e.cancelled_at IS NULL AND substr(e.starts_at, 1, 10) = ?
        AND EXISTS (SELECT 1 FROM carpool_requests r WHERE r.event_id = e.id AND r.offer_id IS NULL)`,
    tomorrow,
  );
  if (!games.length) return 0;
  const ctx = await loadEventContext(env.DB, games);
  let posted = 0;
  for (const e of games) {
    const riderIds = new Set((await eligibleRiders(env.DB, e, ctx)).map((p) => p.person.id));
    const { requests } = await loadCarpoolRows(env.DB, e.id);
    const waiting = requests.filter((r) => r.offer_id == null && riderIds.has(r.player_id));
    if (!waiting.length) continue;
    const text = chatText(e, ctx, waiting);
    for (const teamId of ctx.eventTeams.get(e.id) ?? []) {
      const claimed = await run(env.DB, "INSERT OR IGNORE INTO duty_notifications (kind, ref) VALUES (?, ?)", `carpool-chat-${slot}`, `${e.id}:${teamId}`);
      if (!claimed.meta.changes) continue;
      await postSystemMessage(env, [teamId], text);
      posted++;
    }
  }
  return posted;
}

/** At most 300 characters (limit for system messages in the chat). In the current language (cron: the club's). */
export function chatText(e: EventRow, ctx: EventContext, waiting: { name: string; companions: number }[]): string {
  const title = eventTitle(e, eventTeams(e, ctx));
  const time = clockTimeIn(currentLocale(), shortTime(e.starts_at));
  const count = waiting.length;
  const message = (names: string) =>
    plural(count, {
      one: `Carpool for tomorrow, ${title} (${time}): ${names} is still looking for a lift. If you have free seats, please add them in the event.`,
      other: `Carpool for tomorrow, ${title} (${time}): ${names} are still looking for a lift. If you have free seats, please add them in the event.`,
    });
  const names = waiting.map((r) => {
    const name = r.name;
    const seats = seatsOf(r);
    return r.companions ? t`${name} (${seats} seats)` : name;
  });
  for (let shown = names.length; shown >= 1; shown--) {
    const rest = names.length - shown;
    const parts = names.slice(0, shown);
    const list = parts.slice(0, -1).join(", ");
    const listAll = parts.join(", ");
    const last = parts.at(-1)!;
    const joined =
      rest > 0
        ? plural(rest, { one: `${listAll} and # other person`, other: `${listAll} and # others` })
        : parts.length > 1
          ? t`${list} and ${last}`
          : parts[0]!;
    const text = message(joined);
    if (text.length <= 300) return text;
  }
  const total = names.length;
  return message(plural(total, { one: "# person", other: "# people" })).slice(0, 300);
}
