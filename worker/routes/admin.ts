import { select, t } from "@lingui/core/macro";
import { Hono } from "hono";
import { z } from "zod";
import { type AppEnv, intParam, requireActor } from "../app";
import { requireAdmin } from "../auth/actor";
import { isRelevantEvent } from "../../shared/relevance";
import { listVisibleEvents, loadEventContext, toSummary } from "../domain/events";
import { listExtraEvents } from "../domain/extra-events";
import { generateTrainings } from "../domain/generate";
import { completeLimits, FULL_LIMITS, type LimitRow, toLimits } from "../domain/child-limits";
import { holidayPeriods, holidaySourceLabel, importRegionHolidays, MAX_HOLIDAY_DAYS } from "../domain/holidays";
import { all, first, run, stmt } from "../lib/db";
import { badRequest, conflict, forbidden, notFound, parse, readJson } from "../lib/http";
import { eachDay, isDate, nowLocal, todayLocal, utcIso } from "../lib/time";
import { loadClub, ownVenue } from "../domain/club";
import { birthYears, SPORTS, type SportId } from "../../shared/sports";
import type { Locale } from "../../shared/i18n";

export const adminRoutes = new Hono<AppEnv>();

// Training locations ------------------------------------------------------------

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
  .refine((u) => /^https:\/\//.test(u), { error: () => t`Please enter an https link.` });

const locationSchema = z.object({
  name: z.string().trim().min(1, { error: () => t`Please enter a name.` }).max(80),
  address: z.string().trim().max(200).nullable().optional(),
  mapUrl: urlField.nullable().optional(),
});

adminRoutes.post("/locations", async (c) => {
  const actor = requireActor(c);
  if (!actor.isAdmin && !actor.coachTeamIds.length) throw forbidden(t`Training locations are created by coaches and admins.`);
  // The club's own halls or pitches are added by admins (Administration → Training venues); coaches add other venues
  const input = parse(locationSchema.extend({ kind: z.enum(["hall", "custom"]).default("custom") }), await readJson(c.req.raw));
  if (input.kind === "hall") requireAdmin(actor);
  const row = await first<{ id: number }>(
    c.env.DB,
    "INSERT INTO locations (name, address, map_url, kind) VALUES (?, ?, ?, ?) RETURNING id",
    input.name,
    input.address ?? null,
    input.mapUrl ?? null,
    input.kind,
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
  const venue = ownVenue();
  if (loc.kind === "hall") throw conflict(select(venue, { hall: "The club's halls cannot be deleted.", pitch: "The club's pitches cannot be deleted.", other: "The club's own venues cannot be deleted." }));
  if (loc.kind === "external") requireAdmin(actor);
  else if (!actor.isAdmin && !actor.coachTeamIds.length) throw forbidden();
  const used = await first(c.env.DB, "SELECT 1 AS used FROM training_rules WHERE location_id = ?", loc.id);
  if (used) throw conflict(t`The location is still used in a training plan.`);
  await run(c.env.DB, "DELETE FROM locations WHERE id = ?", loc.id);
  return c.json({ ok: true });
});

// Holidays ------------------------------------------------------------------------

const holidaySchema = z
  .object({
    name: z.string().trim().min(1, { error: () => t`Please enter a name.` }).max(60),
    startsOn: z.string().refine(isDate, { error: () => t`Invalid date` }),
    endsOn: z.string().refine(isDate, { error: () => t`Invalid date` }),
  })
  .refine((h) => h.startsOn <= h.endsOn, { error: () => t`The end must be after the start.` })
  .refine((h) => eachDay(h.startsOn, h.endsOn).length <= MAX_HOLIDAY_DAYS, {
    error: () => {
      const days = MAX_HOLIDAY_DAYS;
      return t`A period may be at most ${days} days long.`;
    },
  });

adminRoutes.get("/holidays", async (c) => {
  requireActor(c);
  const periods = await holidayPeriods(c.env.DB);
  // Linked holiday plans per period (they follow changes)
  const plans = await all<{ holiday_period_id: number; n: number }>(
    c.env.DB,
    "SELECT holiday_period_id, count(*) AS n FROM training_plans WHERE holiday_period_id IS NOT NULL GROUP BY holiday_period_id",
  );
  const count = new Map(plans.map((p) => [p.holiday_period_id, p.n]));
  const publicHolidays = await all<{ day: string; name: string }>(c.env.DB, "SELECT day, name FROM public_holidays WHERE day >= ? ORDER BY day", todayLocal());
  return c.json({
    periods: periods.map((p) => ({ ...p, plans: count.get(p.id) ?? 0 })),
    publicHolidays,
    source: holidaySourceLabel(),
  });
});

/**
 * School and public holidays of the club's region for the current season. Otherwise they only come with the season
 * change, so a new installation (or a club that sets its region later) would have none.
 */
adminRoutes.post("/holidays/import", async (c) => {
  requireAdmin(requireActor(c));
  const db = c.env.DB;
  const club = await loadClub(db);
  if (!club.subdivision) throw badRequest(t`Choose the club's state or region first (Administration → Club → Language and region).`, "region_missing");
  const season = await first<{ starts_on: string; ends_on: string }>(db, "SELECT starts_on, ends_on FROM seasons WHERE is_current = 1");
  if (!season) throw badRequest(t`There is no current season yet.`, "no_season");
  let result: { periods: number; publicHolidays: number };
  try {
    result = await importRegionHolidays(db, { country: club.country, subdivision: club.subdivision, language: club.defaultLocale }, season.starts_on, season.ends_on);
  } catch (err) {
    console.warn("holiday import failed", err);
    throw conflict(t`The holiday calendar could not be reached. Please try again later.`, "holidays_unavailable");
  }
  await generateTrainings(db);
  return c.json(result);
});

/** Removes a public holiday, e.g. when the club trains on it after all; trainings are generated again. */
adminRoutes.delete("/public-holidays/:day", async (c) => {
  requireAdmin(requireActor(c));
  const day = c.req.param("day");
  if (!isDate(day)) throw badRequest(t`Invalid date`);
  await run(c.env.DB, "DELETE FROM public_holidays WHERE day = ?", day);
  await generateTrainings(c.env.DB);
  return c.json({ ok: true });
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

/** Changes a period; linked holiday plans take the new dates, trainings are recalculated. */
adminRoutes.patch("/holidays/:id", async (c) => {
  requireAdmin(requireActor(c));
  const id = intParam(c, "id");
  const input = parse(holidaySchema, await readJson(c.req.raw));
  const res = await c.env.DB.batch([
    stmt(c.env.DB, "UPDATE holiday_periods SET name = ?, starts_on = ?, ends_on = ?, updated_at = ? WHERE id = ?", input.name, input.startsOn, input.endsOn, utcIso(), id),
    stmt(c.env.DB, "UPDATE training_plans SET valid_from = ?, valid_to = ? WHERE holiday_period_id = ?", input.startsOn, input.endsOn, id),
  ]);
  if (!res[0]!.meta.changes) throw notFound(t`This holiday period does not exist.`);
  await generateTrainings(c.env.DB);
  return c.json({ ok: true, plans: res[1]!.meta.changes });
});

/** Deletes a period; linked holiday plans remain with their dates. */
adminRoutes.delete("/holidays/:id", async (c) => {
  requireAdmin(requireActor(c));
  const id = intParam(c, "id");
  const res = await run(c.env.DB, "DELETE FROM holiday_periods WHERE id = ?", id);
  if (!res.meta.changes) throw notFound(t`This holiday period does not exist.`);
  return c.json({ ok: true });
});

// Season and age classes -------------------------------------------------------

adminRoutes.get("/age-classes", async (c) => {
  requireActor(c);
  const season = await first<{ id: number; name: string; starts_on: string; ends_on: string }>(
    c.env.DB,
    "SELECT id, name, starts_on, ends_on FROM seasons WHERE is_current = 1",
  );
  const rows = season ? await all<AgeClassDbRow>(c.env.DB, "SELECT * FROM age_classes WHERE season_id = ? ORDER BY rank, code", season.id) : [];
  return c.json({
    season: season ? { id: season.id, name: season.name, startsOn: season.starts_on, endsOn: season.ends_on } : null,
    ageClasses: rows.map(ageClassJson),
  });
});

export interface AgeClassDbRow extends LimitRow {
  code: string;
  name: string;
  rank: number;
  is_youth: number;
  birth_year_min: number | null;
  birth_year_max: number | null;
  game_minutes: number;
  youth_referee: number;
}

export function ageClassJson(r: AgeClassDbRow) {
  return {
    code: r.code,
    name: r.name,
    rank: r.rank,
    isYouth: r.is_youth === 1,
    birthYearMin: r.birth_year_min,
    birthYearMax: r.birth_year_max,
    gameMinutes: r.game_minutes,
    youthReferee: r.youth_referee === 1,
    childLimits: toLimits(r),
  };
}

export const ageClassSchema = z.object({
  code: z.string().trim().min(1).max(10),
  name: z.string().trim().min(1).max(60),
  rank: z.number().int().min(0).max(20),
  isYouth: z.boolean(),
  birthYearMin: z.number().int().min(1900).max(2100).nullable(),
  birthYearMax: z.number().int().min(1900).max(2100).nullable(),
  gameMinutes: z.number().int().min(15).max(300).default(90),
  youthReferee: z.boolean().default(false),
  /** What players of this youth class may do themselves (children in the app); no effect on adult classes. */
  childLimits: z.object({ account: z.boolean(), respond: z.boolean(), chat: z.enum(["none", "read", "write"]), help: z.boolean() }).optional(),
});

type AgeClassInput = z.infer<typeof ageClassSchema>;

/**
 * Writes the age classes of a season anew. Without children's limits (an older app version) the previous ones
 * of the class with the same code stay, otherwise everything is allowed.
 */
export async function writeAgeClasses(db: D1Database, seasonId: number, ageClasses: AgeClassInput[]): Promise<void> {
  const before = new Map((await all<AgeClassDbRow>(db, "SELECT * FROM age_classes WHERE season_id = ?", seasonId)).map((r) => [r.code, toLimits(r)]));
  await db.batch([
    stmt(db, "DELETE FROM age_classes WHERE season_id = ?", seasonId),
    ...ageClasses.map((a) => {
      const l = a.childLimits ?? before.get(a.code) ?? FULL_LIMITS;
      return stmt(
        db,
        `INSERT INTO age_classes (season_id, code, name, rank, is_youth, birth_year_min, birth_year_max, game_minutes, youth_referee,
                                  child_account, child_respond, child_chat, child_help)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        seasonId,
        a.code,
        a.name,
        a.rank,
        a.isYouth ? 1 : 0,
        a.birthYearMin,
        a.birthYearMax,
        a.gameMinutes,
        a.youthReferee ? 1 : 0,
        l.account ? 1 : 0,
        l.account && l.respond ? 1 : 0,
        l.account ? l.chat : "none",
        l.account && l.help ? 1 : 0,
      );
    }),
  ]);
}

adminRoutes.put("/age-classes", async (c) => {
  requireAdmin(requireActor(c));
  const { ageClasses } = parse(z.object({ ageClasses: z.array(ageClassSchema).max(40) }), await readJson(c.req.raw));
  const codes = new Set(ageClasses.map((a) => a.code));
  if (codes.size !== ageClasses.length) throw badRequest(t`Each code may appear only once.`);
  for (const a of ageClasses) {
    if (a.birthYearMin != null && a.birthYearMax != null && a.birthYearMin > a.birthYearMax) {
      const name = a.name;
      throw badRequest(t`${name}: The oldest birth year must come before the youngest.`);
    }
  }
  const season = await first<{ id: number }>(c.env.DB, "SELECT id FROM seasons WHERE is_current = 1");
  if (!season) throw conflict(t`There is no current season.`);
  await writeAgeClasses(c.env.DB, season.id, ageClasses);
  // Without children's access and without parents only the coach could respond there: a hint for the admin
  const withoutParents = await all<{ name: string }>(
    c.env.DB,
    `SELECT t.name FROM teams t JOIN age_classes ac ON ac.code = t.age_class_code AND ac.season_id = ?
      WHERE t.kind = 'team' AND ac.is_youth = 1 AND ac.child_account = 0 AND t.parents_enabled = 0 ORDER BY t.name`,
    season.id,
  );
  return c.json({ ok: true, teamsWithoutParents: withoutParents.map((t) => t.name) });
});

/** Age classes of a season from the club's sport profile (shared/sports.ts), names in the club language. */
export function ageClassesFromProfile(sport: SportId, startsOn: string, locale: Locale) {
  const startYear = Number(startsOn.slice(0, 4));
  return SPORTS[sport].ageClasses.map((a) => {
    const years = birthYears(a, startYear);
    return {
      code: a.code,
      name: a.name[locale],
      rank: a.rank,
      isYouth: a.youth,
      birthYearMin: years.min,
      birthYearMax: years.max,
      gameMinutes: a.gameMinutes,
      youthReferee: !!a.youthReferee,
      childLimits: a.youth ? completeLimits(a.child) : FULL_LIMITS,
    };
  });
}

/** Proposal for the current season from the sport profile; saving stays with PUT /age-classes. */
adminRoutes.get("/age-classes/from-profile", async (c) => {
  requireAdmin(requireActor(c));
  const season = await first<{ starts_on: string }>(c.env.DB, "SELECT starts_on FROM seasons WHERE is_current = 1");
  if (!season) throw conflict(t`There is no current season.`);
  const club = await loadClub(c.env.DB);
  return c.json({ sport: club.sport, ageClasses: ageClassesFromProfile(club.sport, season.starts_on, club.defaultLocale) });
});

/**
 * Administration → special events and games: upcoming, manually created events of all teams
 * (special events and games without handball4all), without those the admin sees under events anyway.
 */
adminRoutes.get("/admin/extra-events", async (c) => {
  const actor = requireActor(c);
  requireAdmin(actor);
  const db = c.env.DB;
  const events = await listExtraEvents(db, actor);
  // Own events (as in the event overview) are not in the list
  const own = await listVisibleEvents(db, actor, { from: nowLocal(), to: "9999-12-31T00:00" });
  const ownCtx = await loadEventContext(db, own);
  const now = Date.now();
  // Self-created events stay in the list so admins find them here again
  const created = new Set((await all<{ id: number }>(db, "SELECT id FROM events WHERE created_by = ?", actor.personId)).map((r) => r.id));
  const ownIds = new Set(own.map((e) => toSummary(e, ownCtx, actor, now)).filter(isRelevantEvent).map((e) => e.id).filter((id) => !created.has(id)));
  return c.json({ events: events.filter((e) => !ownIds.has(e.id)) });
});
