import { Hono } from "hono";
import { z } from "zod";
import type { PersonRef, TeamRef } from "../../shared/types";
import { type AppEnv, intParam, requireActor } from "../app";
import { requireAdmin } from "../auth/actor";
import { assertNotProtected, assertNotStaffUnlessAdmin } from "../auth/owner";
import { recordAttendance, seasonStatsStatements } from "../domain/attendance";
import { chatStub, clearChats, markFormerInChats } from "../domain/chat";
import { HOLIDAY_SOURCE, type HolidayInput, holidaySource } from "../domain/holidays";
import { all, first, list, run, stmt } from "../lib/db";
import { badRequest, conflict, forbidden, notFound, parse, readJson } from "../lib/http";
import { isDate, nowLocal, utcIso } from "../lib/time";
import { ageClassSchema } from "./admin";
import { canManagePerson } from "./persons";
import { syncAutoGroups } from "../domain/groups";

export const seasonRoutes = new Hono<AppEnv>();

interface SeasonRow {
  id: number;
  name: string;
  starts_on: string;
  ends_on: string;
  is_current: number;
}

interface AgeClassRow {
  code: string;
  name: string;
  gender: "w" | "m" | "x";
  rank: number;
  is_youth: number;
  birth_year_min: number | null;
  birth_year_max: number | null;
}

seasonRoutes.get("/seasons", async (c) => {
  requireAdmin(requireActor(c));
  const rows = await all<SeasonRow>(c.env.DB, "SELECT * FROM seasons ORDER BY starts_on DESC");
  return c.json({
    seasons: rows.map((s) => ({ id: s.id, name: s.name, startsOn: s.starts_on, endsOn: s.ends_on, isCurrent: s.is_current === 1 })),
  });
});

const newSeasonSchema = z.object({
  name: z.string().trim().regex(/^\d{4}\/\d{2}$/, "Format z. B. 2027/28"),
  startsOn: z.string().refine(isDate),
  endsOn: z.string().refine(isDate),
});

/** Daten einer kommenden Saison prüfen: Ende nach Beginn, Beginn nach dem der laufenden Saison. */
function checkSeasonDates(input: { startsOn: string; endsOn: string }, current: SeasonRow | null) {
  if (input.startsOn >= input.endsOn) throw badRequest("Das Ende muss nach dem Beginn liegen.");
  if (current && input.startsOn <= current.starts_on) {
    throw badRequest(`Die neue Saison muss nach dem Beginn der laufenden Saison ${current.name} anfangen.`);
  }
}

/** Die kommende Saison (noch nicht gestartet). Nur sie lässt sich ändern oder verwerfen. */
async function upcomingSeason(db: D1Database, id: number) {
  const [season, current] = await Promise.all([
    first<SeasonRow>(db, "SELECT * FROM seasons WHERE id = ?", id),
    first<SeasonRow>(db, "SELECT * FROM seasons WHERE is_current = 1"),
  ]);
  if (!season) throw notFound("Diese Saison gibt es nicht.");
  if (season.is_current === 1 || (current && season.starts_on <= current.starts_on)) {
    throw conflict("Nur die kommende, noch nicht gestartete Saison lässt sich ändern oder verwerfen.");
  }
  return { season, current };
}

/** Legt die kommende Saison an und übernimmt die Altersklassen um ein Jahr verschoben. */
seasonRoutes.post("/seasons", async (c) => {
  requireAdmin(requireActor(c));
  const input = parse(newSeasonSchema, await readJson(c.req.raw));
  const current = await first<SeasonRow>(c.env.DB, "SELECT * FROM seasons WHERE is_current = 1");
  checkSeasonDates(input, current);
  const upcoming = await first(c.env.DB, "SELECT 1 AS ok FROM seasons WHERE is_current = 0 AND starts_on > ?", current?.starts_on ?? "");
  if (upcoming) throw conflict("Es gibt bereits eine kommende Saison.");
  let season: { id: number } | null;
  try {
    season = await first<{ id: number }>(
      c.env.DB,
      "INSERT INTO seasons (name, starts_on, ends_on, is_current) VALUES (?, ?, ?, 0) RETURNING id",
      input.name,
      input.startsOn,
      input.endsOn,
    );
  } catch (err) {
    if (err instanceof Error && /UNIQUE/.test(err.message)) throw conflict("Diese Saison gibt es schon.");
    throw err;
  }
  if (current) {
    await run(
      c.env.DB,
      `INSERT INTO age_classes (season_id, code, name, gender, rank, is_youth, birth_year_min, birth_year_max)
       SELECT ?, code, name, gender, rank, is_youth, birth_year_min + 1, birth_year_max + 1 FROM age_classes WHERE season_id = ?`,
      season!.id,
      current.id,
    );
  }
  return c.json({ id: season!.id }, 201);
});

/** Name oder Zeitraum der kommenden Saison korrigieren. Die Altersklassen bleiben. */
seasonRoutes.patch("/seasons/:id", async (c) => {
  requireAdmin(requireActor(c));
  const { season, current } = await upcomingSeason(c.env.DB, intParam(c, "id"));
  const input = parse(newSeasonSchema, await readJson(c.req.raw));
  checkSeasonDates(input, current);
  try {
    await run(c.env.DB, "UPDATE seasons SET name = ?, starts_on = ?, ends_on = ? WHERE id = ?", input.name, input.startsOn, input.endsOn, season.id);
  } catch (err) {
    if (err instanceof Error && /UNIQUE/.test(err.message)) throw conflict("Diese Saison gibt es schon.");
    throw err;
  }
  return c.json({ ok: true });
});

/** Begonnenen Saisonwechsel verwerfen: kommende Saison samt ihren Altersklassen löschen. Sonst ändert sich nichts. */
seasonRoutes.delete("/seasons/:id", async (c) => {
  requireAdmin(requireActor(c));
  const { season } = await upcomingSeason(c.env.DB, intParam(c, "id"));
  await c.env.DB.batch([
    stmt(c.env.DB, "DELETE FROM age_classes WHERE season_id = ?", season.id),
    stmt(c.env.DB, "DELETE FROM seasons WHERE id = ?", season.id),
  ]);
  return c.json({ ok: true });
});

seasonRoutes.get("/seasons/:id/age-classes", async (c) => {
  requireAdmin(requireActor(c));
  const rows = await all<AgeClassRow>(c.env.DB, "SELECT * FROM age_classes WHERE season_id = ? ORDER BY rank, gender, code", intParam(c, "id"));
  return c.json({
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

seasonRoutes.put("/seasons/:id/age-classes", async (c) => {
  requireAdmin(requireActor(c));
  const seasonId = intParam(c, "id");
  const { ageClasses } = parse(z.object({ ageClasses: z.array(ageClassSchema).max(40) }), await readJson(c.req.raw));
  if (new Set(ageClasses.map((a) => a.code)).size !== ageClasses.length) throw badRequest("Jedes Kürzel darf nur einmal vorkommen.");
  const season = await first(c.env.DB, "SELECT 1 AS ok FROM seasons WHERE id = ?", seasonId);
  if (!season) throw notFound();
  await c.env.DB.batch([
    stmt(c.env.DB, "DELETE FROM age_classes WHERE season_id = ?", seasonId),
    ...ageClasses.map((a) =>
      stmt(
        c.env.DB,
        "INSERT INTO age_classes (season_id, code, name, gender, rank, is_youth, birth_year_min, birth_year_max) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        seasonId,
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

// Vorschau des Saisonwechsels ---------------------------------------------------

type Category = "auto" | "choose" | "no_team" | "outgrown" | "missing_birth_year" | "adult" | "ambiguous";

interface PreviewPlayer {
  person: PersonRef;
  birthYear: number | null;
  currentTeams: TeamRef[];
  newAgeClass: { code: string; name: string } | null;
  category: Category;
  options: TeamRef[];
  /** Vorschlag: Jugend nach Jahrgang in die 1. Mannschaft, Erwachsenen-Teams bleiben alle (z. B. Herren 1 und Herren 2). */
  suggestedTeamIds: number[];
}

async function buildPreview(db: D1Database, seasonId: number) {
  const [current, next] = await Promise.all([
    first<SeasonRow>(db, "SELECT * FROM seasons WHERE is_current = 1"),
    first<SeasonRow>(db, "SELECT * FROM seasons WHERE id = ?", seasonId),
  ]);
  if (!next) throw notFound("Diese Saison gibt es nicht.");
  if (next.is_current === 1) throw conflict("Diese Saison läuft bereits.");
  const [currentClasses, nextClasses, teams, players, formers, coaches] = await Promise.all([
    all<AgeClassRow>(db, "SELECT * FROM age_classes WHERE season_id = ?", current?.id ?? 0),
    all<AgeClassRow>(db, "SELECT * FROM age_classes WHERE season_id = ? ORDER BY rank", seasonId),
    all<{ id: number; name: string; age_class_code: string; level: number }>(db, "SELECT id, name, age_class_code, level FROM teams WHERE kind = 'team' ORDER BY name"),
    all<{ id: number; first_name: string; last_name: string | null; birth_year: number | null; team_ids: string }>(
      db,
      `SELECT p.id, p.first_name, p.last_name, p.birth_year, group_concat(tm.team_id) AS team_ids
         FROM persons p JOIN team_memberships tm ON tm.person_id = p.id AND tm.role = 'player'
          JOIN teams t ON t.id = tm.team_id AND t.kind = 'team'
        WHERE p.is_former = 0 GROUP BY p.id ORDER BY p.first_name, p.last_name`,
    ),
    all<{ id: number; first_name: string; last_name: string | null }>(db, "SELECT id, first_name, last_name FROM persons WHERE is_former = 1"),
    all<{ person_id: number; first_name: string; last_name: string | null; team_name: string }>(
      db,
      `SELECT tm.person_id, p.first_name, p.last_name, t.name AS team_name FROM team_memberships tm
         JOIN persons p ON p.id = tm.person_id JOIN teams t ON t.id = tm.team_id AND t.kind = 'team' WHERE tm.role = 'coach' ORDER BY t.name`,
    ),
  ]);
  const ref = (t: { id: number; name: string }): TeamRef => ({ id: t.id, name: t.name });
  const classOf = (code: string) => currentClasses.find((a) => a.code === code);
  const youthNext = nextClasses.filter((a) => a.is_youth === 1);
  const oldestYouth = Math.min(...youthNext.map((a) => a.birth_year_min ?? 9999));

  const out: PreviewPlayer[] = players.map((p) => {
    const ids = p.team_ids.split(",").map(Number);
    const allCurrent = teams.filter((t) => ids.includes(t.id));
    // Erwachsenen-Teams sind vom Saisonwechsel nicht betroffen und bleiben, auch neben einer Jugendmannschaft
    const adultIds = allCurrent.filter((t) => classOf(t.age_class_code)?.is_youth === 0).map((t) => t.id);
    const withAdult = (suggested: number[]) => [...new Set([...suggested, ...adultIds])];
    const currentTeams = allCurrent.filter((t) => !adultIds.includes(t.id));
    const base = { person: { id: p.id, firstName: p.first_name, lastName: p.last_name }, birthYear: p.birth_year, currentTeams: allCurrent.map(ref) };
    const allTeams = teams.map(ref);
    if (!currentTeams.length) return { ...base, newAgeClass: null, category: "adult" as const, options: allTeams, suggestedTeamIds: adultIds };
    if (p.birth_year == null) {
      return { ...base, newAgeClass: null, category: "missing_birth_year" as const, options: allTeams, suggestedTeamIds: withAdult(currentTeams.map((t) => t.id)) };
    }
    const gender = classOf(currentTeams[0]?.age_class_code ?? "")?.gender ?? "x";
    const fits = youthNext.filter(
      (a) =>
        (a.birth_year_min == null || a.birth_year_min <= p.birth_year!) &&
        (a.birth_year_max == null || p.birth_year! <= a.birth_year_max) &&
        (gender === "x" || a.gender === gender || a.gender === "x"),
    );
    if (!fits.length) {
      if (p.birth_year < oldestYouth) {
        const adultTeams = teams.filter((t) => {
          const ac = nextClasses.find((a) => a.code === t.age_class_code);
          return ac && ac.is_youth === 0 && (gender === "x" || ac.gender === gender);
        });
        return { ...base, newAgeClass: null, category: "outgrown" as const, options: (adultTeams.length ? adultTeams : teams).map(ref), suggestedTeamIds: adultIds };
      }
      return { ...base, newAgeClass: null, category: "no_team" as const, options: allTeams, suggestedTeamIds: adultIds };
    }
    const exact = fits.filter((a) => a.gender === gender);
    const chosenClasses = exact.length === 1 ? exact : fits;
    const candidateTeams = teams.filter((t) => chosenClasses.some((a) => a.code === t.age_class_code));
    const newAgeClass = chosenClasses.length === 1 ? { code: chosenClasses[0]!.code, name: chosenClasses[0]!.name } : null;
    if (chosenClasses.length > 1) {
      return { ...base, newAgeClass, category: "ambiguous" as const, options: candidateTeams.length ? candidateTeams.map(ref) : allTeams, suggestedTeamIds: adultIds };
    }
    if (!candidateTeams.length) return { ...base, newAgeClass, category: "no_team" as const, options: allTeams, suggestedTeamIds: adultIds };
    if (candidateTeams.length === 1) return { ...base, newAgeClass, category: "auto" as const, options: candidateTeams.map(ref), suggestedTeamIds: withAdult([candidateTeams[0]!.id]) };
    // Jugend wird nach Jahrgang neu gebildet: Vorschlag ist die 1. Mannschaft, eine 2. legt der Admin bei Bedarf an
    const first1 = candidateTeams.find((t) => t.level === 1) ?? candidateTeams[0]!;
    return { ...base, newAgeClass, category: "choose" as const, options: candidateTeams.map(ref), suggestedTeamIds: withAdult([first1.id]) };
  });

  return {
    current: current ? { id: current.id, name: current.name } : null,
    next: { id: next.id, name: next.name, startsOn: next.starts_on, endsOn: next.ends_on },
    ageClassesDefined: nextClasses.length > 0,
    players: out,
    formerPersons: formers.map((f) => ({ id: f.id, firstName: f.first_name, lastName: f.last_name })),
    coaches: coaches.map((c) => ({ person: { id: c.person_id, firstName: c.first_name, lastName: c.last_name }, team: c.team_name })),
  };
}

seasonRoutes.get("/season-change/preview", async (c) => {
  requireAdmin(requireActor(c));
  const seasonId = Number(c.req.query("seasonId"));
  if (!Number.isInteger(seasonId) || seasonId <= 0) throw badRequest("Bitte wähle die neue Saison.");
  const preview = await buildPreview(c.env.DB, seasonId);
  // Schulferien BW der neuen Saison: einmalig hier, danach frei bearbeitbar unter Verwaltung → Ferien
  let holidays: HolidayInput[] = [];
  let holidaysError: string | null = null;
  try {
    holidays = await holidaySource.bw(preview.next.startsOn, preview.next.endsOn);
  } catch (err) {
    console.error("Ferienimport fehlgeschlagen", err);
    holidaysError = "Die Schulferien ließen sich gerade nicht laden. Du kannst sie nach dem Wechsel unter Verwaltung → Ferien eintragen oder es später erneut versuchen.";
  }
  return c.json({ ...preview, holidays, holidaysError, holidaySource: HOLIDAY_SOURCE });
});

const executeSchema = z.object({
  seasonId: z.number().int().positive(),
  confirmName: z.string(),
  assignments: z
    .array(z.object({ personId: z.number().int().positive(), teamIds: z.array(z.number().int().positive()).max(3), former: z.boolean() }))
    .max(2000),
  /** Ferien der neuen Saison aus der Vorschau; ersetzen alle bisherigen Zeiträume */
  holidays: z
    .array(
      z
        .object({ name: z.string().trim().min(1).max(60), startsOn: z.string().refine(isDate), endsOn: z.string().refine(isDate) })
        .refine((h) => h.startsOn <= h.endsOn),
    )
    .max(60)
    .default([]),
});

seasonRoutes.post("/season-change/execute", async (c) => {
  const actor = requireActor(c);
  requireAdmin(actor);
  const input = parse(executeSchema, await readJson(c.req.raw));
  const db = c.env.DB;
  const next = await first<SeasonRow>(db, "SELECT * FROM seasons WHERE id = ?", input.seasonId);
  if (!next || next.is_current === 1) throw badRequest("Ungültige Saison.");
  if (input.confirmName.trim() !== next.name) throw badRequest(`Zur Bestätigung bitte genau „${next.name}“ eingeben.`);
  const teamIds = new Set((await all<{ id: number }>(db, "SELECT id FROM teams WHERE kind = 'team'")).map((t) => t.id));
  for (const a of input.assignments) if (a.teamIds.some((t) => !teamIds.has(t))) throw badRequest("Unbekannte Mannschaft in der Zuordnung.");

  const formerIds = input.assignments.filter((a) => a.former).map((a) => a.personId);
  if (formerIds.includes(actor.personId)) throw badRequest("Du kannst dich nicht selbst als ehemalig markieren.");
  await assertNotProtected(db, actor, formerIds);
  const memberships = input.assignments.filter((a) => !a.former).flatMap((a) => [...new Set(a.teamIds)].map((t) => ({ p: a.personId, t })));

  // Eltern, deren Kinder alle gehen und die selbst keine Rolle haben, werden gelöscht.
  const orphanParents = await all<{ id: number }>(
    db,
    `SELECT DISTINCT g.guardian_id AS id FROM guardianships g JOIN persons gp ON gp.id = g.guardian_id
      WHERE gp.is_admin = 0
        AND NOT EXISTS (SELECT 1 FROM team_memberships tm WHERE tm.person_id = g.guardian_id)
        AND NOT EXISTS (
          SELECT 1 FROM guardianships g2 JOIN persons cp ON cp.id = g2.child_id
           WHERE g2.guardian_id = g.guardian_id AND cp.is_former = 0 AND cp.id NOT IN (SELECT value FROM json_each(?))
        )`,
    list(formerIds),
  );
  // Auch die Chats der Gruppen werden geleert, ihre Mitglieder bleiben
  const allTeamIds = (await all<{ id: number }>(db, "SELECT id FROM teams")).map((t) => t.id);

  // Statistik der ablaufenden Saison: erst alle begonnenen Termine festschreiben, dann verdichten
  const ending = await first<SeasonRow>(db, "SELECT * FROM seasons WHERE is_current = 1");
  while (await recordAttendance(db)) {
    // in Portionen, bis alles festgeschrieben ist
  }

  await db.batch([
    ...(ending ? seasonStatsStatements(db, ending.id) : []),
    stmt(db, "DELETE FROM events"),
    stmt(db, "DELETE FROM training_plans"),
    // Ohne geladene Ferien (Import fehlgeschlagen) bleiben die bisherigen Zeiträume stehen
    ...(input.holidays.length ? [stmt(db, "DELETE FROM holiday_periods")] : []),
    ...input.holidays.map((h) =>
      stmt(db, "INSERT INTO holiday_periods (name, starts_on, ends_on, imported) VALUES (?, ?, ?, 1)", h.name, h.startsOn, h.endsOn),
    ),
    stmt(db, "DELETE FROM core_squad"),
    stmt(db, "DELETE FROM team_memberships WHERE team_id IN (SELECT id FROM teams WHERE kind = 'team')"),
    stmt(
      db,
      `INSERT OR IGNORE INTO team_memberships (person_id, team_id, role)
       SELECT json_extract(value, '$.p'), json_extract(value, '$.t'), 'player' FROM json_each(?)`,
      JSON.stringify(memberships),
    ),
    stmt(db, "DELETE FROM persons WHERE id IN (SELECT value FROM json_each(?))", list(orphanParents.map((p) => p.id))),
    stmt(db, "DELETE FROM persons WHERE is_former = 1 OR id IN (SELECT value FROM json_each(?))", list(formerIds)),
    stmt(db, "UPDATE seasons SET is_current = 0 WHERE is_current = 1"),
    stmt(db, "UPDATE seasons SET is_current = 1 WHERE id = ?", next.id),
    stmt(db, "UPDATE teams SET h4a_league_id = NULL, h4a_team_id = NULL, h4a_imported_at = NULL, h4a_import_error = NULL, h4a_claimed_at = NULL"),
    stmt(db, "DELETE FROM chat_state"),
    stmt(db, "DELETE FROM chat_reads"),
    stmt(db, "DELETE FROM chat_mutes"),
    stmt(db, "UPDATE invites SET revoked_at = ? WHERE revoked_at IS NULL AND kind IN ('player', 'parent')", utcIso()),
    stmt(db, "DELETE FROM app_meta WHERE key = 'generated_on'"),
  ]);
  await syncAutoGroups(db);
  c.executionCtx.waitUntil(clearChats(c.env, allTeamIds));
  return c.json({
    ok: true,
    assigned: new Set(memberships.map((m) => m.p)).size,
    deletedPersons: formerIds.length,
    deletedParents: orphanParents.length,
  });
});

// Export: Datensicherung einmal pro Saison und vor dem Reset ----------------------

/** Tabellen mit Vereinsdaten, vollständig exportiert. */
export const EXPORT_TABLES = [
  "app_meta",
  "seasons",
  "age_classes",
  "persons",
  "guardianships",
  "child_permissions",
  "child_permission_log",
  "teams",
  "team_memberships",
  "core_squad",
  "locations",
  "holiday_periods",
  "training_plans",
  "training_rules",
  "rule_teams",
  "events",
  "event_teams",
  "responses",
  "nominations",
  "help_requests",
  "standing_absences",
  "unexcused_absences",
  "attendance",
  "season_stats",
  "notification_settings",
  "notification_channels",
  "chat_optouts",
  "chat_mutes",
  "chat_state",
  "chat_reads",
  "chat_mentions",
  "duty_types",
  "duty_templates",
  "duty_template_items",
  "event_duties",
  "event_organizers",
  "club_members",
  "duties",
  "skill_consents",
  "duty_notifications",
  "referees",
  "carpool_offers",
  "carpool_requests",
];

/**
 * Bewusst nicht oder nur teilweise im Export: Zugangsdaten, die nach einer
 * Wiederherstellung neu entstehen und in einer abgelegten Datei nur schaden.
 * accounts und avatars kommen gesondert (ohne Geheimnisse bzw. als Base64).
 * Ein Test prüft, dass jede Tabelle in einer der beiden Listen steht.
 */
export const EXPORT_EXCLUDED = [
  "accounts",
  "avatars",
  "passkeys",
  "sessions",
  "email_codes",
  "invites",
  "push_subscriptions",
  "calendar_tokens",
  "referee_links",
  "d1_migrations",
];

function base64(bytes: ArrayBuffer | Uint8Array | number[]): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes as ArrayBuffer);
  let bin = "";
  for (let i = 0; i < arr.length; i += 0x8000) bin += String.fromCharCode(...arr.subarray(i, i + 0x8000));
  return btoa(bin);
}

seasonRoutes.get("/admin/export", async (c) => {
  const actor = requireActor(c);
  requireAdmin(actor);
  // Protokoll für die Rechenschaft des Vereins: wer wann exportiert hat (nur IDs, in den Worker-Logs)
  console.info(JSON.stringify({ event: "admin_export", personId: actor.personId, accountId: actor.accountId, viewAs: actor.viewAs ?? null, at: utcIso() }));
  const db = c.env.DB;
  const data: Record<string, unknown> = {};
  for (const table of EXPORT_TABLES) data[table] = await all(db, `SELECT * FROM ${table}`);
  // Zugänge ohne Passkey-Handle; die E-Mail ist für Eltern mit E-Mail-Anmeldung der einzige Kontakt
  data.accounts = await all(db, "SELECT id, person_id, email, email_verified_at, created_at, disabled_at FROM accounts");
  const avatars = await all<{ person_id: number; status: string; mime: string; image: ArrayBuffer; version: number; created_at: string }>(
    db,
    "SELECT person_id, status, mime, image, version, created_at FROM avatars",
  );
  data.avatars = avatars.map((a) => ({ ...a, image: base64(a.image) }));
  const teams = await all<{ id: number; name: string }>(db, "SELECT id, name FROM teams");
  const chats: Record<string, unknown> = {};
  for (const t of teams) {
    try {
      const res = await chatStub(c.env, t.id).fetch("https://chat.internal/export", { method: "POST", headers: { "x-team-id": String(t.id) } });
      if (res.ok) chats[t.name] = await res.json();
    } catch {
      chats[t.name] = null;
    }
  }
  data.chats = chats;
  const stamp = nowLocal().replace(/[:T]/g, "-");
  return new Response(JSON.stringify({ exportedAt: utcIso(), app: "Kabine", data }, null, 1), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="kabine-export-${stamp}.json"`,
      "cache-control": "no-store",
    },
  });
});

// Vereinsaustritt -----------------------------------------------------------------

async function retirePerson(db: D1Database, personId: number, now: number): Promise<D1PreparedStatement[]> {
  const nowL = nowLocal(now);
  return [
    stmt(db, "UPDATE persons SET is_former = 1, left_at = ?, is_admin = 0, admin_email = NULL WHERE id = ?", utcIso(now), personId),
    stmt(db, "UPDATE accounts SET disabled_at = ?, email = NULL, email_verified_at = NULL WHERE person_id = ? AND disabled_at IS NULL", utcIso(now), personId),
    stmt(db, "DELETE FROM passkeys WHERE account_id IN (SELECT id FROM accounts WHERE person_id = ?)", personId),
    stmt(db, "DELETE FROM sessions WHERE account_id IN (SELECT id FROM accounts WHERE person_id = ?)", personId),
    stmt(db, "DELETE FROM push_subscriptions WHERE account_id IN (SELECT id FROM accounts WHERE person_id = ?)", personId),
    stmt(db, "DELETE FROM avatars WHERE person_id = ?", personId),
    stmt(db, "DELETE FROM team_memberships WHERE person_id = ?", personId),
    stmt(db, "DELETE FROM core_squad WHERE person_id = ?", personId),
    stmt(db, "DELETE FROM standing_absences WHERE person_id = ?", personId),
    stmt(db, "DELETE FROM nominations WHERE person_id = ? AND event_id IN (SELECT id FROM events WHERE starts_at > ?)", personId, nowL),
    stmt(db, "DELETE FROM responses WHERE person_id = ? AND event_id IN (SELECT id FROM events WHERE starts_at > ?)", personId, nowL),
    stmt(db, "DELETE FROM carpool_requests WHERE player_id = ? AND event_id IN (SELECT id FROM events WHERE starts_at > ?)", personId, nowL),
    stmt(db, "DELETE FROM carpool_offers WHERE person_id = ? AND event_id IN (SELECT id FROM events WHERE starts_at > ?)", personId, nowL),
    stmt(db, "UPDATE help_requests SET status = 'withdrawn' WHERE person_id = ? AND status = 'open'", personId),
  ];
}

seasonRoutes.post("/persons/:id/leave", async (c) => {
  const actor = requireActor(c);
  const personId = intParam(c, "id");
  if (personId === actor.personId) throw badRequest("Den eigenen Austritt trägt ein Admin ein.");
  await assertNotProtected(c.env.DB, actor, personId);
  if (!(await canManagePerson(c.env.DB, actor, personId))) throw forbidden("Diese Person verwaltest du nicht.");
  await assertNotStaffUnlessAdmin(c.env.DB, actor, personId);
  const person = await first<{ id: number; is_admin: number }>(c.env.DB, "SELECT id, is_admin FROM persons WHERE id = ? AND is_former = 0", personId);
  if (!person) throw notFound("Diese Person gibt es nicht.");
  if (person.is_admin && !actor.isAdmin) throw forbidden();
  const now = Date.now();
  const teams = (await all<{ team_id: number }>(c.env.DB, "SELECT DISTINCT team_id FROM team_memberships WHERE person_id = ?", personId)).map((t) => t.team_id);
  // Eltern, deren letztes Kind austritt und die selbst keine Rolle haben
  const parents = await all<{ id: number }>(
    c.env.DB,
    `SELECT g.guardian_id AS id FROM guardianships g JOIN persons gp ON gp.id = g.guardian_id
      WHERE g.child_id = ?1 AND gp.is_former = 0 AND gp.is_admin = 0
        AND NOT EXISTS (SELECT 1 FROM team_memberships tm WHERE tm.person_id = g.guardian_id)
        AND NOT EXISTS (SELECT 1 FROM guardianships g2 JOIN persons cp ON cp.id = g2.child_id
                         WHERE g2.guardian_id = g.guardian_id AND g2.child_id <> ?1 AND cp.is_former = 0)`,
    personId,
  );
  const statements = await retirePerson(c.env.DB, personId, now);
  for (const p of parents) statements.push(...(await retirePerson(c.env.DB, p.id, now)));
  await c.env.DB.batch(statements);
  c.executionCtx.waitUntil(
    (async () => {
      await markFormerInChats(c.env, teams, personId);
      for (const p of parents) await markFormerInChats(c.env, teams, p.id);
    })(),
  );
  return c.json({ ok: true, parentsDeactivated: parents.length });
});
