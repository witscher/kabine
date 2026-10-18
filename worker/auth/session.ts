import { t } from "@lingui/core/macro";
import { randomToken, sha256Hex } from "../lib/crypto";
import { first, run, stmt } from "../lib/db";
import { todayLocal, utcIso } from "../lib/time";

export const SESSION_COOKIE = "__Host-kabine_session";

const DAY = 86_400_000;
/** Without use, a session expires after 30 days. */
export const IDLE_MS = 30 * DAY;
/** Absolute limit from login, after that a new passkey login. */
export const ABSOLUTE_MS = 90 * DAY;
/** Extend at most once a day, which saves D1 writes. */
export const EXTEND_EVERY_MS = DAY;

export interface SessionRow {
  id: string;
  account_id: number;
  created_at: string;
  expires_at: string;
  extended_at: string;
}

export function readSessionToken(request: Request): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE) return rest.join("=") || null;
  }
  return null;
}

export function sessionCookie(token: string, expiresAt: number): string {
  const maxAge = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export function clearedSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

/** Short device label for the device list, without storing the full user agent. */
export function deviceLabel(userAgent: string | null): string {
  const ua = userAgent ?? "";
  const device = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Macintosh|Mac OS X/.test(ua)
          ? "Mac"
          : /Windows/.test(ua)
            ? "Windows"
            : /Linux/.test(ua)
              ? "Linux"
              : t`Device`;
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /SamsungBrowser/.test(ua)
      ? "Samsung Internet"
      : /Firefox|FxiOS/.test(ua)
        ? "Firefox"
        : /Chrome|CriOS/.test(ua)
          ? "Chrome"
          : /Safari/.test(ua)
            ? "Safari"
            : null;
  return browser ? `${device} · ${browser}` : device;
}

export async function createSession(
  db: D1Database,
  accountId: number,
  userAgent: string | null,
  now = Date.now(),
): Promise<{ token: string; expiresAt: number }> {
  const token = randomToken(32);
  const id = await sha256Hex(token);
  const expiresAt = Math.min(now + IDLE_MS, now + ABSOLUTE_MS);
  await db.batch([
    stmt(
      db,
      "INSERT INTO sessions (id, account_id, created_at, expires_at, extended_at, device_label) VALUES (?, ?, ?, ?, ?, ?)",
      id,
      accountId,
      utcIso(now),
      utcIso(expiresAt),
      utcIso(now),
      deviceLabel(userAgent),
    ),
    stmt(db, "UPDATE accounts SET last_seen_on = ? WHERE id = ?", todayLocal(now), accountId),
  ]);
  return { token, expiresAt };
}

/**
 * Extends a valid session on a sliding basis, at most once a day and never
 * beyond the absolute limit. Returns the new expiry if it was extended. In the
 * same step (so at most daily) the last activity is recorded on the account,
 * even when the limit has been reached.
 */
export async function extendSessionIfDue(db: D1Database, session: SessionRow, now = Date.now()): Promise<number | null> {
  if (now - Date.parse(session.extended_at) < EXTEND_EVERY_MS) return null;
  const expiresAt = Math.min(now + IDLE_MS, Date.parse(session.created_at) + ABSOLUTE_MS);
  const extend = expiresAt > Date.parse(session.expires_at);
  await db.batch([
    stmt(db, "UPDATE sessions SET expires_at = ?, extended_at = ? WHERE id = ?", extend ? utcIso(expiresAt) : session.expires_at, utcIso(now), session.id),
    stmt(db, "UPDATE accounts SET last_seen_on = ? WHERE id = ?", todayLocal(now), session.account_id),
  ]);
  return extend ? expiresAt : null;
}

export async function deleteSession(db: D1Database, token: string): Promise<void> {
  await run(db, "DELETE FROM sessions WHERE id = ?", await sha256Hex(token));
}

export async function findSession(db: D1Database, token: string, now = Date.now()): Promise<SessionRow | null> {
  return first<SessionRow>(
    db,
    "SELECT id, account_id, created_at, expires_at, extended_at FROM sessions WHERE id = ? AND expires_at > ?",
    await sha256Hex(token),
    utcIso(now),
  );
}
