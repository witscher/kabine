// Setup wizard (first start of an installation, can be reopened): applies the sport profile (season,
// age classes, helper duty types) and marks the setup as done. Everything else uses the normal
// administration routes (club profile, modules, mail, teams).
import { t } from "@lingui/core/macro";
import { Hono } from "hono";
import { z } from "zod";
import { seasonAround, SPORT_IDS, SPORTS, type SportId } from "../../shared/sports";
import { type AppEnv, requireActor } from "../app";
import { requireAdmin } from "../auth/actor";
import { loadClub, saveClub } from "../domain/club";
import { importRegionHolidays } from "../domain/holidays";
import { loadMailSettings } from "../domain/mail";
import { all, first, run, stmt } from "../lib/db";
import { parse, readJson } from "../lib/http";
import { todayLocal } from "../lib/time";
import { ageClassesFromProfile, writeAgeClasses } from "./admin";

export const setupRoutes = new Hono<AppEnv>();

setupRoutes.get("/admin/setup", async (c) => {
  requireAdmin(requireActor(c));
  const db = c.env.DB;
  const [club, season, teams, ageClasses, mail] = await Promise.all([
    loadClub(db),
    first<{ id: number; name: string; starts_on: string; ends_on: string }>(db, "SELECT id, name, starts_on, ends_on FROM seasons WHERE is_current = 1"),
    first<{ n: number }>(db, "SELECT count(*) AS n FROM teams WHERE kind = 'team'"),
    first<{ n: number }>(db, "SELECT count(*) AS n FROM age_classes WHERE season_id = (SELECT id FROM seasons WHERE is_current = 1)"),
    loadMailSettings(c.env),
  ]);
  return c.json({
    setupDone: club.setupDone,
    sport: club.sport,
    season: season ? { name: season.name, startsOn: season.starts_on, endsOn: season.ends_on } : null,
    proposedSeason: seasonAround(todayLocal(), SPORTS[club.sport].seasonStart),
    ageClasses: ageClasses?.n ?? 0,
    teams: teams?.n ?? 0,
    mailMode: mail.mode,
  });
});

const sportSchema = z.object({
  sport: z.enum(SPORT_IDS),
  /** First day of the current season; default from the sport profile */
  season: z
    .object({ name: z.string().trim().min(1).max(20), startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })
    .refine((s) => s.startsOn < s.endsOn, { error: () => t`The end must be after the start.` })
    .optional(),
});

/**
 * Applies the sport: sets it in the club profile, creates the current season if there is none, the
 * age classes of the profile if the season has none yet, and the helper duty types of the profile as
 * long as no duty has been used (a fresh installation).
 */
setupRoutes.post("/admin/setup/sport", async (c) => {
  requireAdmin(requireActor(c));
  const db = c.env.DB;
  const { sport, season: wanted } = parse(sportSchema, await readJson(c.req.raw));
  const club = await saveClub(db, { sport });
  const locale = club.defaultLocale;
  let season = await first<{ id: number; starts_on: string }>(db, "SELECT id, starts_on FROM seasons WHERE is_current = 1");
  if (!season) {
    const s = wanted ?? seasonAround(todayLocal(), SPORTS[sport].seasonStart);
    season = await first<{ id: number; starts_on: string }>(
      db,
      "INSERT INTO seasons (name, starts_on, ends_on, is_current) VALUES (?, ?, ?, 1) RETURNING id, starts_on",
      s.name,
      s.startsOn,
      s.endsOn,
    );
    // Holidays otherwise only come with the season change: load them for this first season, if the region is known
    if (club.subdivision) {
      try {
        await importRegionHolidays(db, { country: club.country, subdivision: club.subdivision, language: locale }, s.startsOn, s.endsOn);
      } catch (err) {
        console.warn("holiday import at setup failed", err);
      }
    }
  }
  const hasClasses = await first(db, "SELECT 1 AS ok FROM age_classes WHERE season_id = ?", season!.id);
  if (!hasClasses) {
    await writeAgeClasses(db, season!.id, ageClassesFromProfile(sport as SportId, season!.starts_on, locale));
  }
  const dutiesUsed = await first(db, "SELECT 1 AS used FROM event_duties LIMIT 1");
  if (!dutiesUsed) await applyDutyProfile(db, sport as SportId, locale);
  return c.json({ ok: true });
});

/** Replaces the club's duty types and templates with those of the sport, in the club language. */
async function applyDutyProfile(db: D1Database, sport: SportId, locale: "en" | "de"): Promise<void> {
  const profile = SPORTS[sport];
  await db.batch([
    stmt(db, "DELETE FROM duty_template_items"),
    stmt(db, "DELETE FROM duty_templates"),
    stmt(db, "DELETE FROM skill_consents"),
    stmt(db, "DELETE FROM duty_types WHERE event_id IS NULL"),
  ]);
  for (const [i, d] of profile.dutyTypes.entries()) {
    await run(
      db,
      `INSERT INTO duty_types (code, name, mode, who_parents, who_referees, note_allowed, needs_skill, sort) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      d.code,
      d.name[locale],
      d.mode,
      d.whoParents ? 1 : 0,
      d.whoReferees ? 1 : 0,
      d.noteAllowed ? 1 : 0,
      d.needsSkill ? 1 : 0,
      i + 1,
    );
  }
  const ids = new Map((await all<{ id: number; code: string }>(db, "SELECT id, code FROM duty_types WHERE event_id IS NULL")).map((r) => [r.code, r.id]));
  const templates: ["home" | "away", string, SportProfileTemplate][] = [
    ["home", t`Home game`, profile.homeTemplate],
    ["away", t`Away game`, profile.awayTemplate],
  ];
  for (const [kind, name, items] of templates) {
    if (!items.length) continue;
    const tpl = await first<{ id: number }>(db, "INSERT INTO duty_templates (name, default_for) VALUES (?, ?) RETURNING id", name, kind);
    await db.batch(
      items.map((it, i) =>
        stmt(
          db,
          "INSERT INTO duty_template_items (template_id, duty_type_id, slots, before_min, after_min, task_when, sort) VALUES (?, ?, ?, ?, ?, 'after', ?)",
          tpl!.id,
          ids.get(it.duty)!,
          it.slots,
          it.before,
          it.after,
          i + 1,
        ),
      ),
    );
  }
}

type SportProfileTemplate = (typeof SPORTS)[SportId]["homeTemplate"];

setupRoutes.post("/admin/setup/done", async (c) => {
  requireAdmin(requireActor(c));
  await saveClub(c.env.DB, { setupDone: true });
  return c.json({ ok: true });
});
