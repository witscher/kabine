import { hmacB64url, randomToken, sha256Hex } from "../lib/crypto";
import { first, run } from "../lib/db";
import { badRequest } from "../lib/http";
import { utcIso } from "../lib/time";

export const TEAM_INVITE_DAYS = 14;
export const PERSONAL_INVITE_DAYS = 7;

export interface InviteRow {
  id: number;
  kind: "player" | "parent" | "personal";
  nonce: string;
  team_id: number | null;
  person_id: number | null;
  revoke_existing: number;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  used_at: string | null;
}

function secret(env: Env): string {
  if (!env.APP_SECRET || env.APP_SECRET.length < 16) {
    throw new Error("APP_SECRET fehlt oder ist zu kurz (wrangler secret put APP_SECRET).");
  }
  return env.APP_SECRET;
}

export async function tokenForNonce(env: Env, nonce: string): Promise<string> {
  return hmacB64url(secret(env), `invite:${nonce}`);
}

export function inviteUrl(origin: string, token: string): string {
  return `${origin}/einladung#${token}`;
}

export async function createInvite(
  env: Env,
  input: { kind: InviteRow["kind"]; teamId?: number; personId?: number; createdBy: number; revokeExisting?: boolean },
  now = Date.now(),
): Promise<{ id: number; token: string; expiresAt: string }> {
  const nonce = randomToken(18);
  const token = await tokenForNonce(env, nonce);
  const days = input.kind === "personal" ? PERSONAL_INVITE_DAYS : TEAM_INVITE_DAYS;
  const expiresAt = utcIso(now + days * 86_400_000);
  // Pro Mannschaft gibt es je Art nur einen gültigen Link, bei persönlichen
  // Links einen pro Person.
  if (input.kind === "personal") {
    await run(
      env.DB,
      "UPDATE invites SET revoked_at = ? WHERE kind = 'personal' AND person_id = ? AND revoked_at IS NULL AND used_at IS NULL",
      utcIso(now),
      input.personId,
    );
  } else {
    await run(
      env.DB,
      "UPDATE invites SET revoked_at = ? WHERE kind = ? AND team_id = ? AND revoked_at IS NULL",
      utcIso(now),
      input.kind,
      input.teamId,
    );
  }
  const row = await first<{ id: number }>(
    env.DB,
    `INSERT INTO invites (kind, nonce, token_hash, team_id, person_id, revoke_existing, created_by, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    input.kind,
    nonce,
    await sha256Hex(token),
    input.teamId ?? null,
    input.personId ?? null,
    input.revokeExisting ? 1 : 0,
    input.createdBy,
    utcIso(now),
    expiresAt,
  );
  return { id: row!.id, token, expiresAt };
}

/** Sucht eine gültige Einladung. Wirft mit verständlicher Meldung, wenn sie nicht (mehr) gilt. */
export async function findValidInvite(env: Env, token: string, now = Date.now()): Promise<InviteRow> {
  if (!/^[\w-]{20,100}$/.test(token)) throw badRequest("Dieser Einladungslink ist ungültig.", "invite_invalid");
  const row = await first<InviteRow>(env.DB, "SELECT * FROM invites WHERE token_hash = ?", await sha256Hex(token));
  if (!row) throw badRequest("Dieser Einladungslink ist ungültig.", "invite_invalid");
  if (row.kind === "parent") {
    const team = await first<{ parents_enabled: number }>(env.DB, "SELECT parents_enabled FROM teams WHERE id = ?", row.team_id);
    if (team?.parents_enabled !== 1) {
      throw badRequest("In dieser Mannschaft sind keine Eltern eingebunden. Der Elternlink gilt deshalb nicht.", "parents_disabled");
    }
  }
  if (row.revoked_at) throw badRequest("Dieser Einladungslink wurde zurückgezogen. Bitte frag nach einem neuen Link.", "invite_revoked");
  if (row.used_at) throw badRequest("Dieser Link wurde bereits verwendet. Bitte frag nach einem neuen Link.", "invite_used");
  if (Date.parse(row.expires_at) <= now) throw badRequest("Dieser Einladungslink ist abgelaufen. Bitte frag nach einem neuen Link.", "invite_expired");
  return row;
}
