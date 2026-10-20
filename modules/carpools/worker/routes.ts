// Carpool API. Rules in domain.ts.
import { plural, t } from "@lingui/core/macro";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { type AppEnv, intParam, requireActor } from "../../../worker/app";
import { type Actor, actsFor, isCoachOfAny } from "../../../worker/auth/actor";
import {
  assertNoConflict,
  type CarpoolEvent,
  carpoolGame,
  carpoolOpen,
  driverCandidates,
  eligibleRiders,
  familyConflict,
  gameWhat,
  loadCarpoolRows,
  MAX_COMPANIONS,
  MAX_SEATS,
  mayViewCarpool,
  notifyCarpool,
  notifyMatches,
  type OfferRow,
  type RequestRow,
  riderLabel,
  seatsOf,
  suppressMatches,
  takenSeats,
} from "./domain";
import { loadEventContext, loadVisibleEvent } from "../../../worker/domain/events";
import { all, list, run, stmt } from "../../../worker/lib/db";
import { badRequest, conflict, forbidden, notFound, parse, readJson } from "../../../worker/lib/http";
import { utcIso } from "../../../worker/lib/time";

export const carpoolRoutes = new Hono<AppEnv>();

interface Scope extends CarpoolEvent {
  actor: Actor;
  db: D1Database;
  manage: boolean;
  offers: OfferRow[];
  requests: RequestRow[];
}

/** Load and check the game: visible, away game, involved, still open. */
async function scope(c: Context<AppEnv>): Promise<Scope> {
  const actor = requireActor(c);
  const db = c.env.DB;
  const event = await loadVisibleEvent(db, actor, intParam(c, "id"));
  if (!event) throw notFound(t`This event does not exist or you cannot see it.`);
  if (!carpoolGame(event)) throw notFound(t`Carpools only exist for away games.`);
  const ctx = await loadEventContext(db, [event]);
  const { offers, requests } = await loadCarpoolRows(db, event.id);
  if (!mayViewCarpool(actor, event, ctx, offers)) throw forbidden(t`Only nominated players, their parents and the coaches see carpools.`);
  if (!carpoolOpen(event, Date.now())) throw conflict(t`The game is not taking place or has already started.`);
  const teamIds = ctx.eventTeams.get(event.id) ?? [];
  return { actor, db, event, ctx, teamIds, manage: isCoachOfAny(actor, teamIds), offers, requests };
}

// Pushes name the coach when a coach made the entry for someone else ("(entered by …)").

// Offers ---------------------------------------------------------------------------

/** Own offer, or a coach for others. */
function offerAccess(s: Scope, personId: number): { own: boolean } {
  const own = personId === s.actor.personId;
  if (!own && !s.manage) throw forbidden(t`Only coaches enter offers for others.`);
  return { own };
}

const offerSchema = z.object({
  seats: z
    .number()
    .int()
    .min(1, { error: () => t`At least one free seat.` })
    .max(MAX_SEATS, {
      error: () => {
        const max = MAX_SEATS;
        return t`At most ${max} free seats.`;
      },
    }),
  /** When lowering below the seats taken: no longer take these passengers. */
  removeRequestIds: z.array(z.number().int().positive()).max(MAX_SEATS).optional(),
});

carpoolRoutes.put("/events/:id/carpool/offers/:personId", async (c) => {
  const s = await scope(c);
  const personId = intParam(c, "personId");
  const { own } = offerAccess(s, personId);
  const input = parse(offerSchema, await readJson(c.req.raw));
  const existing = s.offers.find((o) => o.person_id === personId);

  if (!existing) {
    if (!own && !(await driverCandidates(s.db, s.event, s.ctx)).some((p) => p.id === personId)) {
      throw badRequest(t`Drivers can be nominated players, their parents and the coaches.`);
    }
    assertNoConflict(await familyConflict(s.db, s.event.id, { driverId: personId }), "driver");
    await run(s.db, "INSERT INTO carpool_offers (event_id, person_id, seats, created_by) VALUES (?, ?, ?, ?)", s.event.id, personId, input.seats, s.actor.personId);
    if (!own) {
      const coach = s.actor.firstName;
      const seats = input.seats;
      await notifyCarpool(
        c.env,
        s,
        [personId],
        () => {
          const game = gameWhat(s);
          return {
            title: t`Entered as driver`,
            body: plural(seats, {
              one: `${coach} entered you as a driver with one free seat: ${game}.`,
              other: `${coach} entered you as a driver with # free seats: ${game}.`,
            }),
          };
        },
        [s.actor.accountId],
      );
    }
    await notifyMatches(c.env, s, [s.actor.accountId]);
    return c.json({ ok: true }, 201);
  }

  const riders = s.requests.filter((r) => r.offer_id === existing.id);
  const removeIds = [...new Set(input.removeRequestIds ?? [])];
  const removed = riders.filter((r) => removeIds.includes(r.id));
  if (removed.length !== removeIds.length) throw badRequest(t`At least one passenger is not riding with this driver.`);
  const takenAfter = takenSeats(existing.id, s.requests) - removed.reduce((n, r) => n + seatsOf(r), 0);
  if (input.seats < takenAfter) {
    throw conflict(t`${takenAfter} people are already riding along. Please choose whom you can no longer take.`, "carpool_overbooked");
  }
  const [, updated] = await s.db.batch([
    stmt(
      s.db,
      "UPDATE carpool_requests SET offer_id = NULL, booked_at = NULL WHERE offer_id = ? AND id IN (SELECT value FROM json_each(?))",
      existing.id,
      list(removed.map((r) => r.id)),
    ),
    // Against simultaneous bookings: only if the seats are still enough
    stmt(
      s.db,
      "UPDATE carpool_offers SET seats = ?1 WHERE id = ?2 AND ?1 >= (SELECT coalesce(sum(1 + companions), 0) FROM carpool_requests WHERE offer_id = ?2)",
      input.seats,
      existing.id,
    ),
  ]);
  await afterRemoval(c.env, s, existing, removed, own);
  if (!updated!.meta.changes) throw conflict(t`Someone has booked in the meantime. Please try again.`, "carpool_overbooked");
  if (input.seats > existing.seats || removed.length) await notifyMatches(c.env, s, [s.actor.accountId]);
  return c.json({ ok: true });
});

/** Removed passengers search again and are told; the app does not suggest the same offer to them again. */
async function afterRemoval(env: Env, s: Scope, offer: OfferRow, removed: RequestRow[], own: boolean) {
  await suppressMatches(s.db, removed.map((r) => [offer.id, r.id]));
  const driver = offer.name;
  const coach = s.actor.firstName;
  for (const r of removed) {
    const rider = r.name;
    await notifyCarpool(
      env,
      s,
      [r.player_id],
      () => {
        const game = gameWhat(s);
        return {
          title: t`Lift is off`,
          body: own
            ? t`${driver} can no longer take ${rider}: ${game}. The search continues.`
            : t`${driver} can no longer take ${rider}: ${game}. The search continues (entered by ${coach}).`,
        };
      },
      [s.actor.accountId],
    );
  }
}

carpoolRoutes.delete("/events/:id/carpool/offers/:personId", async (c) => {
  const s = await scope(c);
  const personId = intParam(c, "personId");
  const { own } = offerAccess(s, personId);
  const offer = s.offers.find((o) => o.person_id === personId);
  if (!offer) throw notFound(t`This offer does not exist.`);
  const riders = s.requests.filter((r) => r.offer_id === offer.id);
  await s.db.batch([
    stmt(s.db, "UPDATE carpool_requests SET offer_id = NULL, booked_at = NULL WHERE offer_id = ?", offer.id),
    stmt(s.db, "DELETE FROM carpool_offers WHERE id = ?", offer.id),
  ]);
  const driver = offer.name;
  const coach = s.actor.firstName;
  for (const r of riders) {
    const rider = r.name;
    await notifyCarpool(
      c.env,
      s,
      [r.player_id],
      () => {
        const game = gameWhat(s);
        return {
          title: t`Lift is off`,
          body: own
            ? t`${driver} is not driving: ${game}. The search for a lift for ${rider} continues.`
            : t`${driver} is not driving: ${game}. The search for a lift for ${rider} continues (entered by ${coach}).`,
        };
      },
      [s.actor.accountId],
    );
  }
  if (!own) {
    await notifyCarpool(
      c.env,
      s,
      [personId],
      () => {
        const game = gameWhat(s);
        return { title: t`Offer withdrawn`, body: t`${coach} withdrew your offer as a driver: ${game}.` };
      },
      [s.actor.accountId],
    );
  }
  if (riders.length) await notifyMatches(c.env, s, [s.actor.accountId]);
  return c.json({ ok: true });
});

carpoolRoutes.delete("/events/:id/carpool/offers/:personId/riders/:requestId", async (c) => {
  const s = await scope(c);
  const personId = intParam(c, "personId");
  const { own } = offerAccess(s, personId);
  const offer = s.offers.find((o) => o.person_id === personId);
  const rider = s.requests.find((r) => r.id === intParam(c, "requestId"));
  if (!offer || !rider || rider.offer_id !== offer.id) throw notFound(t`This person is not riding here.`);
  await run(s.db, "UPDATE carpool_requests SET offer_id = NULL, booked_at = NULL WHERE id = ? AND offer_id = ?", rider.id, offer.id);
  await afterRemoval(c.env, s, offer, [rider], own);
  await notifyMatches(c.env, s, [s.actor.accountId]);
  return c.json({ ok: true });
});

// Searches and bookings ------------------------------------------------------------

/** For oneself, a child (parents in charge) or as a coach for nominated players. */
function requestAccess(s: Scope, playerId: number): { own: boolean } {
  const own = actsFor(s.actor, playerId, s.teamIds);
  if (!own && !s.manage) throw forbidden(t`You can only look for a lift for yourself or your children.`);
  return { own };
}

function existingRequest(s: Scope, playerId: number): RequestRow {
  const r = s.requests.find((x) => x.player_id === playerId);
  if (!r) throw notFound(t`There is no search for this person.`);
  return r;
}

const requestSchema = z.object({
  companions: z
    .number()
    .int()
    .min(0)
    .max(MAX_COMPANIONS, {
      error: () => {
        const max = MAX_COMPANIONS;
        return t`At most ${max} companions.`;
      },
    }),
});

carpoolRoutes.put("/events/:id/carpool/requests/:playerId", async (c) => {
  const s = await scope(c);
  const playerId = intParam(c, "playerId");
  const { own } = requestAccess(s, playerId);
  const { companions } = parse(requestSchema, await readJson(c.req.raw));
  const rider = (await eligibleRiders(s.db, s.event, s.ctx)).find((p) => p.person.id === playerId);
  if (!rider) throw badRequest(t`Passengers can be nominated players who have not declined, and the coaches.`, "not_eligible");
  const existing = s.requests.find((r) => r.player_id === playerId);

  if (!existing) {
    assertNoConflict(await familyConflict(s.db, s.event.id, { playerId }), "rider");
    const row = (await all<{ id: number }>(
      s.db,
      "INSERT INTO carpool_requests (event_id, player_id, companions, created_by) VALUES (?, ?, ?, ?) RETURNING id",
      s.event.id,
      playerId,
      companions,
      s.actor.personId,
    ))[0]!;
    // Free seats are offered right away, so no push for them
    const need = 1 + companions;
    await suppressMatches(
      s.db,
      s.offers.filter((o) => o.seats - takenSeats(o.id, s.requests) >= need).map((o) => [o.id, row.id]),
    );
    if (!own) {
      const name = riderLabel({ name: rider.person.firstName, companions });
      const coach = s.actor.firstName;
      await notifyCarpool(
        c.env,
        s,
        [playerId],
        () => {
          const game = gameWhat(s);
          return { title: t`Looking for a lift`, body: t`Looking for a lift for ${name}: ${game} (entered by ${coach}).` };
        },
        [s.actor.accountId],
      );
    }
    return c.json({ ok: true, id: row.id }, 201);
  }

  if (companions === existing.companions) return c.json({ ok: true, id: existing.id });
  // Booked: more seats only if the driver has them
  const res = await run(
    s.db,
    `UPDATE carpool_requests SET companions = ?1
      WHERE id = ?2 AND (offer_id IS NULL OR
        (SELECT o.seats FROM carpool_offers o WHERE o.id = carpool_requests.offer_id)
          - (SELECT coalesce(sum(1 + r2.companions), 0) FROM carpool_requests r2 WHERE r2.offer_id = carpool_requests.offer_id AND r2.id <> ?2) >= 1 + ?1)`,
    companions,
    existing.id,
  );
  if (!res.meta.changes) throw conflict(t`The driver does not have enough free seats. Please cancel the lift and book again.`, "carpool_full");
  const offer = s.offers.find((o) => o.id === existing.offer_id);
  if (offer) {
    const rider = riderLabel({ name: existing.name, companions });
    const coach = s.actor.firstName;
    await notifyCarpool(
      c.env,
      s,
      [offer.person_id],
      () => {
        const game = gameWhat(s);
        return { title: t`Lift changed`, body: ridingWithYou(own, rider, game, coach) };
      },
      [s.actor.accountId],
    );
    if (companions < existing.companions) await notifyMatches(c.env, s, [s.actor.accountId]);
  }
  return c.json({ ok: true, id: existing.id });
});

carpoolRoutes.delete("/events/:id/carpool/requests/:playerId", async (c) => {
  const s = await scope(c);
  const playerId = intParam(c, "playerId");
  const { own } = requestAccess(s, playerId);
  const existing = existingRequest(s, playerId);
  await run(s.db, "DELETE FROM carpool_requests WHERE id = ?", existing.id);
  const offer = s.offers.find((o) => o.id === existing.offer_id);
  if (offer) {
    await notifyNotRiding(c.env, s, offer, riderLabel(existing), own);
    await notifyMatches(c.env, s, [s.actor.accountId]);
  }
  return c.json({ ok: true });
});

carpoolRoutes.put("/events/:id/carpool/requests/:playerId/booking", async (c) => {
  const s = await scope(c);
  const playerId = intParam(c, "playerId");
  const { own } = requestAccess(s, playerId);
  const { offerId } = parse(z.object({ offerId: z.number().int().positive() }), await readJson(c.req.raw));
  const request = existingRequest(s, playerId);
  if (request.offer_id === offerId) return c.json({ ok: true });
  if (request.offer_id != null) throw conflict(t`Please cancel the current lift first.`, "carpool_booked");
  const offer = s.offers.find((o) => o.id === offerId);
  if (!offer) throw notFound(t`This offer no longer exists.`);
  if (offer.person_id === playerId) throw conflict(t`You cannot ride with yourself.`, "carpool_family");
  // Take the seat atomically: whoever books first gets it
  const res = await run(
    s.db,
    `UPDATE carpool_requests SET offer_id = ?1, booked_at = ?3
      WHERE id = ?2 AND offer_id IS NULL
        AND (SELECT seats FROM carpool_offers WHERE id = ?1)
          - (SELECT coalesce(sum(1 + companions), 0) FROM carpool_requests WHERE offer_id = ?1) >= 1 + companions`,
    offer.id,
    request.id,
    utcIso(),
  );
  const driver = offer.name;
  if (!res.meta.changes) throw conflict(t`${driver} no longer has enough free seats.`, "carpool_full");
  const rider = riderLabel(request);
  const name = request.name;
  const coach = s.actor.firstName;
  await notifyCarpool(
    c.env,
    s,
    [offer.person_id],
    () => {
      const game = gameWhat(s);
      return { title: t`New passenger`, body: ridingWithYou(own, rider, game, coach) };
    },
    [s.actor.accountId],
  );
  if (!own) {
    await notifyCarpool(
      c.env,
      s,
      [playerId],
      () => {
        const game = gameWhat(s);
        return { title: t`Lift booked`, body: t`${name} is riding with ${driver}: ${game} (entered by ${coach}).` };
      },
      [s.actor.accountId],
    );
  }
  return c.json({ ok: true });
});

carpoolRoutes.delete("/events/:id/carpool/requests/:playerId/booking", async (c) => {
  const s = await scope(c);
  const playerId = intParam(c, "playerId");
  const { own } = requestAccess(s, playerId);
  const request = existingRequest(s, playerId);
  const offer = s.offers.find((o) => o.id === request.offer_id);
  if (!offer) return c.json({ ok: true });
  await run(s.db, "UPDATE carpool_requests SET offer_id = NULL, booked_at = NULL WHERE id = ? AND offer_id = ?", request.id, offer.id);
  await suppressMatches(s.db, [[offer.id, request.id]]);
  await notifyNotRiding(c.env, s, offer, riderLabel(request), own);
  if (!own) {
    const name = request.name;
    const driver = offer.name;
    const coach = s.actor.firstName;
    await notifyCarpool(
      c.env,
      s,
      [playerId],
      () => {
        const game = gameWhat(s);
        return { title: t`Lift cancelled`, body: t`${name} is no longer riding with ${driver}: ${game}. The search continues (entered by ${coach}).` };
      },
      [s.actor.accountId],
    );
  }
  await notifyMatches(c.env, s, [s.actor.accountId]);
  return c.json({ ok: true });
});

/** Push text to the driver: "Lena M. + 1 is riding with you: …", naming the coach who made the entry. */
function ridingWithYou(own: boolean, rider: string, game: string, coach: string): string {
  return own ? t`${rider} is riding with you: ${game}.` : t`${rider} is riding with you: ${game} (entered by ${coach}).`;
}

/** Tells the driver that a passenger is not riding with them after all. */
async function notifyNotRiding(env: Env, s: Scope, offer: OfferRow, rider: string, own: boolean) {
  const coach = s.actor.firstName;
  await notifyCarpool(
    env,
    s,
    [offer.person_id],
    () => {
      const game = gameWhat(s);
      return {
        title: t`Lift cancelled`,
        body: own
          ? t`${rider} is not riding with you after all: ${game}.`
          : t`${rider} is not riding with you after all: ${game} (entered by ${coach}).`,
      };
    },
    [s.actor.accountId],
  );
}
