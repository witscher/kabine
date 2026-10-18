// Fahrgemeinschaften-API. Regeln in worker/domain/carpool.ts.
import { type Context, Hono } from "hono";
import { z } from "zod";
import { type AppEnv, intParam, requireActor } from "../app";
import { type Actor, actsFor, isCoachOfAny } from "../auth/actor";
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
} from "../domain/carpool";
import { loadEventContext, loadVisibleEvent } from "../domain/events";
import { all, list, run, stmt } from "../lib/db";
import { badRequest, conflict, forbidden, notFound, parse, readJson } from "../lib/http";
import { utcIso } from "../lib/time";

export const carpoolRoutes = new Hono<AppEnv>();

interface Scope extends CarpoolEvent {
  actor: Actor;
  db: D1Database;
  manage: boolean;
  offers: OfferRow[];
  requests: RequestRow[];
}

/** Spiel laden und prüfen: sichtbar, Auswärtsspiel, beteiligt, noch offen. */
async function scope(c: Context<AppEnv>): Promise<Scope> {
  const actor = requireActor(c);
  const db = c.env.DB;
  const event = await loadVisibleEvent(db, actor, intParam(c, "id"));
  if (!event) throw notFound("Diesen Termin gibt es nicht oder du kannst ihn nicht sehen.");
  if (!carpoolGame(event)) throw notFound("Fahrgemeinschaften gibt es nur bei Auswärtsspielen.");
  const ctx = await loadEventContext(db, [event]);
  const { offers, requests } = await loadCarpoolRows(db, event.id);
  if (!mayViewCarpool(actor, event, ctx, offers)) throw forbidden("Fahrgemeinschaften sehen nur Nominierte, ihre Eltern und die Trainer.");
  if (!carpoolOpen(event, Date.now())) throw conflict("Das Spiel ist abgesagt oder hat schon begonnen.");
  const teamIds = ctx.eventTeams.get(event.id) ?? [];
  return { actor, db, event, ctx, teamIds, manage: isCoachOfAny(actor, teamIds), offers, requests };
}

/** Zusatz in Pushes, wenn ein Trainer für andere eingetragen hat. */
const byline = (s: Scope, own: boolean) => (own ? "" : ` (eingetragen von ${s.actor.firstName})`);

// Angebote -------------------------------------------------------------------------

/** Eigenes Angebot, oder Trainer für andere. */
function offerAccess(s: Scope, personId: number): { own: boolean } {
  const own = personId === s.actor.personId;
  if (!own && !s.manage) throw forbidden("Angebote für andere tragen nur Trainer ein.");
  return { own };
}

const offerSchema = z.object({
  seats: z.number().int().min(1, "Mindestens ein freier Platz.").max(MAX_SEATS, `Höchstens ${MAX_SEATS} freie Plätze.`),
  /** Beim Senken unter die Belegung: diese Mitfahrer nicht mehr mitnehmen. */
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
      throw badRequest("Fahrer können Nominierte, ihre Eltern und die Trainer sein.");
    }
    assertNoConflict(await familyConflict(s.db, s.event.id, { driverId: personId }), "driver");
    await run(s.db, "INSERT INTO carpool_offers (event_id, person_id, seats, created_by) VALUES (?, ?, ?, ?)", s.event.id, personId, input.seats, s.actor.personId);
    if (!own) {
      await notifyCarpool(
        c.env,
        s,
        [personId],
        "Als Fahrer eingetragen",
        `${s.actor.firstName} hat dich mit ${input.seats === 1 ? "einem freien Platz" : `${input.seats} freien Plätzen`} als Fahrer eingetragen: ${gameWhat(s)}.`,
        [s.actor.accountId],
      );
    }
    await notifyMatches(c.env, s, [s.actor.accountId]);
    return c.json({ ok: true }, 201);
  }

  const riders = s.requests.filter((r) => r.offer_id === existing.id);
  const removeIds = [...new Set(input.removeRequestIds ?? [])];
  const removed = riders.filter((r) => removeIds.includes(r.id));
  if (removed.length !== removeIds.length) throw badRequest("Mindestens ein Mitfahrer fährt nicht bei diesem Fahrer mit.");
  const takenAfter = takenSeats(existing.id, s.requests) - removed.reduce((n, r) => n + seatsOf(r), 0);
  if (input.seats < takenAfter) {
    throw conflict(`Es fahren schon ${takenAfter} Personen mit. Bitte wähle aus, wen du nicht mehr mitnehmen kannst.`, "carpool_overbooked");
  }
  const [, updated] = await s.db.batch([
    stmt(
      s.db,
      "UPDATE carpool_requests SET offer_id = NULL, booked_at = NULL WHERE offer_id = ? AND id IN (SELECT value FROM json_each(?))",
      existing.id,
      list(removed.map((r) => r.id)),
    ),
    // Gegen gleichzeitige Buchungen: nur, wenn die Plätze noch reichen
    stmt(
      s.db,
      "UPDATE carpool_offers SET seats = ?1 WHERE id = ?2 AND ?1 >= (SELECT coalesce(sum(1 + companions), 0) FROM carpool_requests WHERE offer_id = ?2)",
      input.seats,
      existing.id,
    ),
  ]);
  await afterRemoval(c.env, s, existing, removed, own);
  if (!updated!.meta.changes) throw conflict("Inzwischen hat jemand gebucht. Bitte noch einmal versuchen.", "carpool_overbooked");
  if (input.seats > existing.seats || removed.length) await notifyMatches(c.env, s, [s.actor.accountId]);
  return c.json({ ok: true });
});

/** Herausgenommene Mitfahrer suchen wieder und erfahren es; dasselbe Angebot schlägt ihnen die App nicht erneut vor. */
async function afterRemoval(env: Env, s: Scope, offer: OfferRow, removed: RequestRow[], own: boolean) {
  await suppressMatches(s.db, removed.map((r) => [offer.id, r.id]));
  for (const r of removed) {
    await notifyCarpool(
      env,
      s,
      [r.player_id],
      "Mitfahrt entfällt",
      `${offer.name} kann ${r.name} nicht mehr mitnehmen: ${gameWhat(s)}. Die Suche läuft weiter${byline(s, own)}.`,
      [s.actor.accountId],
    );
  }
}

carpoolRoutes.delete("/events/:id/carpool/offers/:personId", async (c) => {
  const s = await scope(c);
  const personId = intParam(c, "personId");
  const { own } = offerAccess(s, personId);
  const offer = s.offers.find((o) => o.person_id === personId);
  if (!offer) throw notFound("Dieses Angebot gibt es nicht.");
  const riders = s.requests.filter((r) => r.offer_id === offer.id);
  await s.db.batch([
    stmt(s.db, "UPDATE carpool_requests SET offer_id = NULL, booked_at = NULL WHERE offer_id = ?", offer.id),
    stmt(s.db, "DELETE FROM carpool_offers WHERE id = ?", offer.id),
  ]);
  for (const r of riders) {
    await notifyCarpool(
      c.env,
      s,
      [r.player_id],
      "Mitfahrt entfällt",
      `${offer.name} fährt nicht: ${gameWhat(s)}. Die Suche nach einer Mitfahrgelegenheit für ${r.name} läuft weiter${byline(s, own)}.`,
      [s.actor.accountId],
    );
  }
  if (!own) await notifyCarpool(c.env, s, [personId], "Angebot zurückgezogen", `${s.actor.firstName} hat dein Angebot als Fahrer zurückgezogen: ${gameWhat(s)}.`, [s.actor.accountId]);
  if (riders.length) await notifyMatches(c.env, s, [s.actor.accountId]);
  return c.json({ ok: true });
});

carpoolRoutes.delete("/events/:id/carpool/offers/:personId/riders/:requestId", async (c) => {
  const s = await scope(c);
  const personId = intParam(c, "personId");
  const { own } = offerAccess(s, personId);
  const offer = s.offers.find((o) => o.person_id === personId);
  const rider = s.requests.find((r) => r.id === intParam(c, "requestId"));
  if (!offer || !rider || rider.offer_id !== offer.id) throw notFound("Diese Person fährt hier nicht mit.");
  await run(s.db, "UPDATE carpool_requests SET offer_id = NULL, booked_at = NULL WHERE id = ? AND offer_id = ?", rider.id, offer.id);
  await afterRemoval(c.env, s, offer, [rider], own);
  await notifyMatches(c.env, s, [s.actor.accountId]);
  return c.json({ ok: true });
});

// Suchen und Buchungen -------------------------------------------------------------

/** Für sich, ein Kind (zuständige Eltern) oder als Trainer für Nominierte. */
function requestAccess(s: Scope, playerId: number): { own: boolean } {
  const own = actsFor(s.actor, playerId, s.teamIds);
  if (!own && !s.manage) throw forbidden("Du kannst nur für dich oder deine Kinder eine Mitfahrgelegenheit suchen.");
  return { own };
}

function existingRequest(s: Scope, playerId: number): RequestRow {
  const r = s.requests.find((x) => x.player_id === playerId);
  if (!r) throw notFound("Für diese Person gibt es keine Suche.");
  return r;
}

const requestSchema = z.object({
  companions: z.number().int().min(0).max(MAX_COMPANIONS, `Höchstens ${MAX_COMPANIONS} Begleitpersonen.`),
});

carpoolRoutes.put("/events/:id/carpool/requests/:playerId", async (c) => {
  const s = await scope(c);
  const playerId = intParam(c, "playerId");
  const { own } = requestAccess(s, playerId);
  const { companions } = parse(requestSchema, await readJson(c.req.raw));
  const rider = (await eligibleRiders(s.db, s.event, s.ctx)).find((p) => p.person.id === playerId);
  if (!rider) throw badRequest("Mitfahren können nominierte Spieler, die nicht abgesagt haben, und die Trainer.", "not_eligible");
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
    // Freie Plätze stehen gleich zur Auswahl, dafür kein Push
    const need = 1 + companions;
    await suppressMatches(
      s.db,
      s.offers.filter((o) => o.seats - takenSeats(o.id, s.requests) >= need).map((o) => [o.id, row.id]),
    );
    if (!own) {
      const name = riderLabel({ name: rider.person.firstName, companions });
      await notifyCarpool(c.env, s, [playerId], "Mitfahrgelegenheit gesucht", `Für ${name} wird eine Mitfahrgelegenheit gesucht: ${gameWhat(s)}${byline(s, own)}.`, [s.actor.accountId]);
    }
    return c.json({ ok: true, id: row.id }, 201);
  }

  if (companions === existing.companions) return c.json({ ok: true, id: existing.id });
  // Gebucht: mehr Plätze nur, wenn der Fahrer sie hat
  const res = await run(
    s.db,
    `UPDATE carpool_requests SET companions = ?1
      WHERE id = ?2 AND (offer_id IS NULL OR
        (SELECT o.seats FROM carpool_offers o WHERE o.id = carpool_requests.offer_id)
          - (SELECT coalesce(sum(1 + r2.companions), 0) FROM carpool_requests r2 WHERE r2.offer_id = carpool_requests.offer_id AND r2.id <> ?2) >= 1 + ?1)`,
    companions,
    existing.id,
  );
  if (!res.meta.changes) throw conflict("Beim Fahrer ist nicht genug Platz frei. Bitte die Mitfahrt absagen und neu buchen.", "carpool_full");
  const offer = s.offers.find((o) => o.id === existing.offer_id);
  if (offer) {
    await notifyCarpool(
      c.env,
      s,
      [offer.person_id],
      "Mitfahrt geändert",
      `${riderLabel({ name: existing.name, companions })} fährt mit dir mit: ${gameWhat(s)}${byline(s, own)}.`,
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
    await notifyCarpool(c.env, s, [offer.person_id], "Mitfahrt abgesagt", `${riderLabel(existing)} fährt doch nicht mit dir mit: ${gameWhat(s)}${byline(s, own)}.`, [s.actor.accountId]);
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
  if (request.offer_id != null) throw conflict("Bitte die bisherige Mitfahrt zuerst absagen.", "carpool_booked");
  const offer = s.offers.find((o) => o.id === offerId);
  if (!offer) throw notFound("Dieses Angebot gibt es nicht mehr.");
  if (offer.person_id === playerId) throw conflict("Mit sich selbst kann man nicht mitfahren.", "carpool_family");
  // Platz atomar belegen: Wer zuerst bucht, bekommt ihn
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
  if (!res.meta.changes) throw conflict(`Bei ${offer.name} ist nicht mehr genug Platz frei.`, "carpool_full");
  await notifyCarpool(c.env, s, [offer.person_id], "Neuer Mitfahrer", `${riderLabel(request)} fährt mit dir mit: ${gameWhat(s)}${byline(s, own)}.`, [s.actor.accountId]);
  if (!own) {
    await notifyCarpool(c.env, s, [playerId], "Mitfahrt eingetragen", `${request.name} fährt bei ${offer.name} mit: ${gameWhat(s)}${byline(s, own)}.`, [s.actor.accountId]);
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
  await notifyCarpool(c.env, s, [offer.person_id], "Mitfahrt abgesagt", `${riderLabel(request)} fährt doch nicht mit dir mit: ${gameWhat(s)}${byline(s, own)}.`, [s.actor.accountId]);
  if (!own) {
    await notifyCarpool(c.env, s, [playerId], "Mitfahrt abgesagt", `${request.name} fährt nicht mehr bei ${offer.name} mit: ${gameWhat(s)}. Die Suche läuft weiter${byline(s, own)}.`, [s.actor.accountId]);
  }
  await notifyMatches(c.env, s, [s.actor.accountId]);
  return c.json({ ok: true });
});
