import { Hono } from "hono";
import { z } from "zod";
import { type AppEnv, intParam, requireActor } from "../app";
import { requireAdmin } from "../auth/actor";
import { isRelevantEvent } from "../../shared/relevance";
import { listVisibleEvents, loadEventContext, toSummary } from "../domain/events";
import { listExtraEvents } from "../domain/extra-events";
import { generateTrainings } from "../domain/generate";
import { HOLIDAY_SOURCE, holidayPeriods, MAX_HOLIDAY_DAYS } from "../domain/holidays";
import { all, first, run, stmt } from "../lib/db";
import { badRequest, conflict, forbidden, notFound, parse, readJson } from "../lib/http";
import { eachDay, isDate, nowLocal, utcIso } from "../lib/time";

export const adminRoutes = new Hono<AppEnv>();

// Trainingsorte -----------------------------------------------------------------

adminRoutes.get("/locations", async (c) => {
  requireActor(c);
  const rows = await all<{ id: number; name: string; address: string | null; map_url: string | null; kind: "hall" | "custom" | "external"; used: number }>(
    c.env.DB,
    `SELECT l.id, l.name, l.address, l.map_url, l.kind,
            EXISTS (SELECT 1 FROM training_rules r WHERE r.location_id = l.id) AS used
       FROM locations l
      WHERE ? = 1 OR l.kind <> 'external'
      ORDER BY CASE l.kind WHEN 'hall' THEN 0 WHEN 'custom' THEN 1 ELSE 2 END, l.name`,
    c.req.query("all") === "1" ? 1 : 0,
  );
  return c.json({
    locations: rows.map((l) => ({ id: l.id, name: l.name, address: l.address, mapUrl: l.map_url, kind: l.kind, inUse: l.used === 1 })),
  });
});

const urlField = z
  .string()
  .trim()
  .max(500)
  .refine((u) => /^https:\/\//.test(u), "Bitte einen https-Link angeben.");

const locationSchema = z.object({
  name: z.string().trim().min(1, "Bitte gib einen Namen ein.").max(80),
  address: z.string().trim().max(200).nullable().optional(),
  mapUrl: urlField.nullable().optional(),
});

adminRoutes.post("/locations", async (c) => {
  const actor = requireActor(c);
  if (!actor.isAdmin && !actor.coachTeamIds.length) throw forbidden("Trainingsorte legen Trainer und Admins an.");
  const input = parse(locationSchema, await readJson(c.req.raw));
  const row = await first<{ id: number }>(
    c.env.DB,
    "INSERT INTO locations (name, address, map_url, kind) VALUES (?, ?, ?, 'custom') RETURNING id",
    input.name,
    input.address ?? null,
    input.mapUrl ?? null,
  );
  return c.json({ id: row!.id }, 201);
});

adminRoutes.patch("/locations/:id", async (c) => {
  const actor = requireActor(c);
  const loc = await first<{ id: number; kind: string; name: string; address: string | null; map_url: string | null }>(
    c.env.DB,
    "SELECT * FROM locations WHERE id = ?",
    intParam(c, "id"),
  );
  if (!loc) throw notFound();
  if (loc.kind !== "custom") requireAdmin(actor);
  else if (!actor.isAdmin && !actor.coachTeamIds.length) throw forbidden();
  const input = parse(locationSchema.partial(), await readJson(c.req.raw));
  await run(
    c.env.DB,
    "UPDATE locations SET name = ?, address = ?, map_url = ? WHERE id = ?",
    input.name ?? loc.name,
    input.address === undefined ? loc.address : input.address,
    input.mapUrl === undefined ? loc.map_url : input.mapUrl,
    loc.id,
  );
  return c.json({ ok: true });
});

adminRoutes.delete("/locations/:id", async (c) => {
  const actor = requireActor(c);
  const loc = await first<{ id: number; kind: string }>(c.env.DB, "SELECT id, kind FROM locations WHERE id = ?", intParam(c, "id"));
  if (!loc) throw notFound();
  if (loc.kind === "hall") throw conflict("Die Vereinshallen können nicht gelöscht werden.");
  if (loc.kind === "external") requireAdmin(actor);
  else if (!actor.isAdmin && !actor.coachTeamIds.length) throw forbidden();
  const used = await first(c.env.DB, "SELECT 1 AS used FROM training_rules WHERE location_id = ?", loc.id);
  if (used) throw conflict("Der Ort wird noch in einem Trainingsplan verwendet.");
  await run(c.env.DB, "DELETE FROM locations WHERE id = ?", loc.id);
  return c.json({ ok: true });
});

// Ferien --------------------------------------------------------------------------

const holidaySchema = z
  .object({
    name: z.string().trim().min(1, "Bitte gib einen Namen ein.").max(60),
    startsOn: z.string().refine(isDate, "Ungültiges Datum"),
    endsOn: z.string().refine(isDate, "Ungültiges Datum"),
  })
  .refine((h) => h.startsOn <= h.endsOn, "Das Ende muss nach dem Beginn liegen.")
  .refine((h) => eachDay(h.startsOn, h.endsOn).length <= MAX_HOLIDAY_DAYS, `Ein Zeitraum darf höchstens ${MAX_HOLIDAY_DAYS} Tage lang sein.`);

adminRoutes.get("/holidays", async (c) => {
  requireActor(c);
  const periods = await holidayPeriods(c.env.DB);
  // Verknüpfte Ferienpläne je Zeitraum (ziehen bei Änderungen mit)
  const plans = await all<{ holiday_period_id: number; n: number }>(
    c.env.DB,
    "SELECT holiday_period_id, count(*) AS n FROM training_plans WHERE holiday_period_id IS NOT NULL GROUP BY holiday_period_id",
  );
  const count = new Map(plans.map((p) => [p.holiday_period_id, p.n]));
  return c.json({ periods: periods.map((p) => ({ ...p, plans: count.get(p.id) ?? 0 })), source: HOLIDAY_SOURCE });
});

adminRoutes.post("/holidays", async (c) => {
  requireAdmin(requireActor(c));
  const input = parse(holidaySchema, await readJson(c.req.raw));
  const row = await first<{ id: number }>(
    c.env.DB,
    "INSERT INTO holiday_periods (name, starts_on, ends_on) VALUES (?, ?, ?) RETURNING id",
    input.name,
    input.startsOn,
    input.endsOn,
  );
  return c.json({ id: row!.id }, 201);
});

/** Zeitraum ändern; verknüpfte Ferienpläne übernehmen die neuen Daten, Trainings werden neu berechnet. */
adminRoutes.patch("/holidays/:id", async (c) => {
  requireAdmin(requireActor(c));
  const id = intParam(c, "id");
  const input = parse(holidaySchema, await readJson(c.req.raw));
  const res = await c.env.DB.batch([
    stmt(c.env.DB, "UPDATE holiday_periods SET name = ?, starts_on = ?, ends_on = ?, updated_at = ? WHERE id = ?", input.name, input.startsOn, input.endsOn, utcIso(), id),
    stmt(c.env.DB, "UPDATE training_plans SET valid_from = ?, valid_to = ? WHERE holiday_period_id = ?", input.startsOn, input.endsOn, id),
  ]);
  if (!res[0]!.meta.changes) throw notFound("Diesen Ferienzeitraum gibt es nicht.");
  await generateTrainings(c.env.DB);
  return c.json({ ok: true, plans: res[1]!.meta.changes });
});

/** Zeitraum löschen; verknüpfte Ferienpläne bleiben mit ihren Daten bestehen. */
adminRoutes.delete("/holidays/:id", async (c) => {
  requireAdmin(requireActor(c));
  const id = intParam(c, "id");
  const res = await run(c.env.DB, "DELETE FROM holiday_periods WHERE id = ?", id);
  if (!res.meta.changes) throw notFound("Diesen Ferienzeitraum gibt es nicht.");
  return c.json({ ok: true });
});

// Saison und Altersklassen ------------------------------------------------------

adminRoutes.get("/age-classes", async (c) => {
  requireActor(c);
  const season = await first<{ id: number; name: string; starts_on: string; ends_on: string }>(
    c.env.DB,
    "SELECT id, name, starts_on, ends_on FROM seasons WHERE is_current = 1",
  );
  const rows = season
    ? await all<{ id: number; code: string; name: string; gender: string; rank: number; is_youth: number; birth_year_min: number | null; birth_year_max: number | null }>(
        c.env.DB,
        "SELECT * FROM age_classes WHERE season_id = ? ORDER BY rank, gender, code",
        season.id,
      )
    : [];
  return c.json({
    season: season ? { id: season.id, name: season.name, startsOn: season.starts_on, endsOn: season.ends_on } : null,
    ageClasses: rows.map((r) => ({
      code: r.code,
      name: r.name,
      gender: r.gender,
      rank: r.rank,
      isYouth: r.is_youth === 1,
      birthYearMin: r.birth_year_min,
      birthYearMax: r.birth_year_max,
    })),
  });
});

export const ageClassSchema = z.object({
  code: z.string().trim().min(1).max(10),
  name: z.string().trim().min(1).max(60),
  gender: z.enum(["w", "m", "x"]),
  rank: z.number().int().min(0).max(20),
  isYouth: z.boolean(),
  birthYearMin: z.number().int().min(1900).max(2100).nullable(),
  birthYearMax: z.number().int().min(1900).max(2100).nullable(),
});

adminRoutes.put("/age-classes", async (c) => {
  requireAdmin(requireActor(c));
  const { ageClasses } = parse(z.object({ ageClasses: z.array(ageClassSchema).max(40) }), await readJson(c.req.raw));
  const codes = new Set(ageClasses.map((a) => a.code));
  if (codes.size !== ageClasses.length) throw badRequest("Jedes Kürzel darf nur einmal vorkommen.");
  for (const a of ageClasses) {
    if (a.birthYearMin != null && a.birthYearMax != null && a.birthYearMin > a.birthYearMax) {
      throw badRequest(`${a.name}: Der älteste Jahrgang muss vor dem jüngsten liegen.`);
    }
  }
  const season = await first<{ id: number }>(c.env.DB, "SELECT id FROM seasons WHERE is_current = 1");
  if (!season) throw conflict("Es gibt keine laufende Saison.");
  await c.env.DB.batch([
    stmt(c.env.DB, "DELETE FROM age_classes WHERE season_id = ?", season.id),
    ...ageClasses.map((a) =>
      stmt(
        c.env.DB,
        `INSERT INTO age_classes (season_id, code, name, gender, rank, is_youth, birth_year_min, birth_year_max)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        season.id,
        a.code,
        a.name,
        a.gender,
        a.rank,
        a.isYouth ? 1 : 0,
        a.birthYearMin,
        a.birthYearMax,
      ),
    ),
  ]);
  return c.json({ ok: true });
});

/**
 * Verwaltung → Sondertermine und Spiele: kommende, von Hand angelegte Termine aller Mannschaften
 * (Sondertermine und Spiele ohne handball4all), ohne die, die der Admin ohnehin unter Termine sieht.
 */
adminRoutes.get("/admin/extra-events", async (c) => {
  const actor = requireActor(c);
  requireAdmin(actor);
  const db = c.env.DB;
  const events = await listExtraEvents(db, actor);
  // Eigene Termine (wie in der Terminübersicht) stehen nicht in der Liste
  const own = await listVisibleEvents(db, actor, { from: nowLocal(), to: "9999-12-31T00:00" });
  const ownCtx = await loadEventContext(db, own);
  const now = Date.now();
  // Selbst angelegte Termine bleiben in der Liste, damit Admins sie hier wiederfinden
  const created = new Set((await all<{ id: number }>(db, "SELECT id FROM events WHERE created_by = ?", actor.personId)).map((r) => r.id));
  const ownIds = new Set(own.map((e) => toSummary(e, ownCtx, actor, now)).filter(isRelevantEvent).map((e) => e.id).filter((id) => !created.has(id)));
  return c.json({ events: events.filter((e) => !ownIds.has(e.id)) });
});
