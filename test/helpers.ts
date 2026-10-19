// Testhilfen. Alle Namen sind erfunden (keine Seed-Daten in Tests).
import { applyD1Migrations, reset } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { createSession, SESSION_COOKIE } from "../worker/auth/session";
import { setClubDefaultLocale } from "../worker/i18n";
import { addDays, todayLocal } from "../worker/lib/time";

export async function freshDb() {
  await reset();
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  await germanClub();
}

/**
 * Upgrade test (migrations/README.md): a database on the schema just before `migration`, with all older
 * migrations applied. Insert the data a club already has, then call migrateRest().
 */
export async function upgradeFrom(migration: string) {
  const all = env.TEST_MIGRATIONS;
  if (!all.some((m) => m.name === migration)) throw new Error(`Unknown migration ${migration}`);
  await reset();
  await applyD1Migrations(env.DB, all.filter((m) => m.name < migration));
  await germanClub();
}

/** Applies the migrations not yet applied, as the deploy of an update does. */
export async function migrateRest() {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
}

/** Club default language German, as the assertions expect German texts. */
export async function germanClub() {
  await env.DB.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('club', ?)").bind(JSON.stringify({ defaultLocale: "de" })).run();
  setClubDefaultLocale("de");
}

export async function exec(sql: string, ...params: unknown[]) {
  return env.DB.prepare(sql)
    .bind(...params)
    .run();
}

export async function one<T>(sql: string, ...params: unknown[]): Promise<T> {
  return (await env.DB.prepare(sql)
    .bind(...params)
    .first<T>())!;
}

export async function rows<T>(sql: string, ...params: unknown[]): Promise<T[]> {
  return (
    await env.DB.prepare(sql)
      .bind(...params)
      .all<T>()
  ).results;
}

let personSeq = 100;

export async function person(firstName: string, opts: { lastName?: string; birthYear?: number; admin?: boolean; active?: boolean } = {}) {
  const id = ++personSeq;
  await exec(
    "INSERT INTO persons (id, first_name, last_name, birth_year, is_admin, admin_email, is_active) VALUES (?, ?, ?, ?, ?, ?, ?)",
    id,
    firstName,
    opts.lastName ?? "Muster",
    opts.birthYear ?? null,
    opts.admin ? 1 : 0,
    opts.admin ? `${firstName.toLowerCase()}@example.org` : null,
    opts.active === false ? 0 : 1,
  );
  return id;
}

/** Gender of a test team from the old-style code: "wD" female, "mC" male, otherwise mixed ("F" = women). */
function genderOf(code: string): "f" | "m" | "x" {
  if (code === "F" || code.startsWith("w")) return "f";
  if (code === "M" || code.startsWith("m")) return "m";
  return "x";
}

export async function team(name: string, ageClassCode: string, opts: { level?: number; declineTraining?: number; declineGame?: number; maxSquad?: number; gender?: "f" | "m" | "x" } = {}) {
  const row = await one<{ id: number }>(
    "INSERT INTO teams (name, age_class_code, gender, level, decline_hours_training, decline_hours_game, max_squad) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id",
    name,
    ageClassCode,
    opts.gender ?? genderOf(ageClassCode),
    opts.level ?? 1,
    opts.declineTraining ?? 6,
    opts.declineGame ?? 6,
    opts.maxSquad ?? 14,
  );
  return row.id;
}

export async function member(personId: number, teamId: number, role: "player" | "coach" | "helper" = "player") {
  await exec("INSERT INTO team_memberships (person_id, team_id, role) VALUES (?, ?, ?)", personId, teamId, role);
}

export async function guardian(parentId: number, childId: number) {
  await exec("INSERT INTO guardianships (guardian_id, child_id) VALUES (?, ?)", parentId, childId);
}

export async function season() {
  await exec("INSERT INTO seasons (id, name, starts_on, ends_on, is_current) VALUES (1, '2026/27', '2026-07-01', '2027-06-30', 1)");
  // Test codes keep the gender letter of the old app ("wD"); the class itself has no gender
  const classes: [string, string, number, number, number | null, number | null, number, number][] = [
    ["wE", "weibliche E-Jugend", 1, 1, 2016, 2017, 75, 1],
    ["wD", "weibliche D-Jugend", 2, 1, 2014, 2015, 90, 1],
    ["wC", "weibliche C-Jugend", 3, 1, 2012, 2013, 90, 1],
    ["wB", "weibliche B-Jugend", 4, 1, 2010, 2011, 90, 0],
    ["wA", "weibliche A-Jugend", 5, 1, 2008, 2009, 120, 0],
    ["F", "Frauen", 6, 0, null, 2007, 120, 0],
  ];
  for (const [code, name, rank, youth, min, max, minutes, referee] of classes) {
    await exec(
      "INSERT INTO age_classes (season_id, code, name, rank, is_youth, birth_year_min, birth_year_max, game_minutes, youth_referee) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)",
      code,
      name,
      rank,
      youth,
      min,
      max,
      minutes,
      referee,
    );
  }
}

export async function hall(name = "Testhalle") {
  return (await one<{ id: number }>("INSERT INTO locations (name, kind) VALUES (?, 'hall') RETURNING id", name)).id;
}

/** Legt einen Account mit Session an und gibt den Cookie-Header zurück. */
export async function loginAs(personId: number): Promise<string> {
  let account = await env.DB.prepare("SELECT id FROM accounts WHERE person_id = ?").bind(personId).first<{ id: number }>();
  if (!account) {
    account = await one<{ id: number }>("INSERT INTO accounts (person_id, webauthn_user_id) VALUES (?, ?) RETURNING id", personId, `uid-${personId}`);
  }
  const { token } = await createSession(env.DB, account.id, "Mozilla/5.0 (iPhone)");
  return `${SESSION_COOKIE}=${token}`;
}

export interface ApiResult<T = any> {
  status: number;
  body: T;
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; cookie?: string } = {}): Promise<ApiResult<T>> {
  const headers: Record<string, string> = {};
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  const res = await exports.default.fetch(
    new Request(`http://localhost:5173/api${path}`, {
      method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    }),
  );
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

/** Ein Termin in n Tagen um hh:mm für die Mannschaft. */
export async function eventIn(
  teamId: number,
  days: number,
  opts: { time?: string; kind?: "training" | "game" | "special"; locationId?: number; title?: string } = {},
) {
  const date = addDays(todayLocal(), days);
  const startsAt = `${date}T${opts.time ?? "18:00"}`;
  const row = await one<{ id: number }>(
    "INSERT INTO events (kind, title, starts_at, ends_at, location_id) VALUES (?, ?, ?, ?, ?) RETURNING id",
    opts.kind ?? "training",
    opts.title ?? null,
    startsAt,
    `${date}T20:00`,
    opts.locationId ?? null,
  );
  await exec("INSERT INTO event_teams (event_id, team_id) VALUES (?, ?)", row.id, teamId);
  return row.id;
}
