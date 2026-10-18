// Club profile: name, colours, logo, privacy notice and owner. Stored in the database (app_meta)
// and edited in the setup wizard, never in code. One installation serves exactly one club.
import type { ClubProfile } from "../../shared/club";
import { clubAbbr, DEFAULT_CLUB } from "../../shared/club";
import { first, run } from "../lib/db";
import { randomToken } from "../lib/crypto";

export interface ClubSettings extends ClubProfile {
  /** Person who set up the installation; other admins cannot take their access (worker/auth/owner.ts). */
  ownerPersonId: number | null;
}

const KEY = "club";

/** Club profile with defaults for missing fields (fresh installation, older data). */
export async function loadClub(db: D1Database): Promise<ClubSettings> {
  const row = await first<{ value: string }>(db, "SELECT value FROM app_meta WHERE key = ?", KEY);
  const stored = row ? (JSON.parse(row.value) as Partial<ClubSettings>) : {};
  return { ...DEFAULT_CLUB, ownerPersonId: null, ...stored, colors: { ...DEFAULT_CLUB.colors, ...stored.colors } };
}

export async function saveClub(db: D1Database, patch: Partial<ClubSettings>): Promise<ClubSettings> {
  const next = { ...(await loadClub(db)), ...patch };
  await run(
    db,
    "INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    KEY,
    JSON.stringify(next),
  );
  ownAbbr = clubAbbr(next);
  ownShortName = next.shortName;
  return next;
}

/** Stable random ID of this installation (calendar UIDs, push subject); created on first use. */
export async function installId(db: D1Database): Promise<string> {
  const row = await first<{ value: string }>(db, "SELECT value FROM app_meta WHERE key = 'install_id'");
  if (row) return row.value;
  const id = randomToken(9).toLowerCase().replace(/[^a-z0-9]/g, "x");
  await run(db, "INSERT OR IGNORE INTO app_meta (key, value) VALUES ('install_id', ?)", id);
  return (await first<{ value: string }>(db, "SELECT value FROM app_meta WHERE key = 'install_id'"))!.value;
}

/** Address of the app for links in e-mails and push messages sent by the cron job. */
export async function appOrigin(env: { DB: D1Database; ORIGIN?: string }): Promise<string> {
  if (env.ORIGIN) return env.ORIGIN;
  return (await first<{ value: string }>(env.DB, "SELECT value FROM app_meta WHERE key = 'app_origin'"))?.value ?? "";
}

/** Remembers the address the app is reached at (admins and push subscriptions record it). */
export async function rememberOrigin(db: D1Database, origin: string): Promise<void> {
  await run(db, "INSERT INTO app_meta (key, value) VALUES ('app_origin', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", origin);
}

// One installation serves one club, so the abbreviation for game titles can live in the isolate.
// Set at the start of every request and cron run (enterClubContext), read by eventTitle and the
// helper notifications, which have no database at hand.
let ownAbbr = clubAbbr(DEFAULT_CLUB);
let ownShortName = DEFAULT_CLUB.shortName;

export function ownClubAbbr(): string {
  return ownAbbr;
}

export function ownClubShortName(): string {
  return ownShortName;
}

export async function enterClubContext(db: D1Database): Promise<ClubSettings> {
  const club = await loadClub(db);
  ownAbbr = clubAbbr(club);
  ownShortName = club.shortName;
  return club;
}
