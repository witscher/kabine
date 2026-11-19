import { t } from "@lingui/core/macro";
import { hmacB64url, randomToken, sha256Hex } from "../lib/crypto";
import { all, first, list, run } from "../lib/db";
import { badRequest, conflict } from "../lib/http";
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
  /** Personal link of an admin: using it also removes the e-mail address of the access */
  clear_email: number;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  used_at: string | null;
}

function secret(env: Env): string {
  if (!env.APP_SECRET || env.APP_SECRET.length < 16) {
    throw new Error("APP_SECRET is missing or too short (wrangler secret put APP_SECRET).");
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
  input: { kind: InviteRow["kind"]; teamId?: number; personId?: number; createdBy: number; revokeExisting?: boolean; clearEmail?: boolean },
  now = Date.now(),
): Promise<{ id: number; token: string; expiresAt: string }> {
  const nonce = randomToken(18);
  const token = await tokenForNonce(env, nonce);
  // A parent link for one child (person_id set) is a one-time link like a personal link
  const forOne = input.kind === "personal" || (input.kind === "parent" && input.personId != null);
  const days = forOne ? PERSONAL_INVITE_DAYS : TEAM_INVITE_DAYS;
  const expiresAt = utcIso(now + days * 86_400_000);
  // Per team there is only one valid link of each kind; for personal links,
  // one per person, and for parent links of one child, one per child and team.
  if (input.kind === "personal") {
    await run(
      env.DB,
      "UPDATE invites SET revoked_at = ? WHERE kind = 'personal' AND person_id = ? AND revoked_at IS NULL AND used_at IS NULL",
      utcIso(now),
      input.personId,
    );
  } else if (forOne) {
    await run(
      env.DB,
      "UPDATE invites SET revoked_at = ? WHERE kind = 'parent' AND team_id = ? AND person_id = ? AND revoked_at IS NULL AND used_at IS NULL",
      utcIso(now),
      input.teamId,
      input.personId,
    );
  } else {
    await run(
      env.DB,
      "UPDATE invites SET revoked_at = ? WHERE kind = ? AND team_id = ? AND person_id IS NULL AND revoked_at IS NULL",
      utcIso(now),
      input.kind,
      input.teamId,
    );
  }
  const row = await first<{ id: number }>(
    env.DB,
    `INSERT INTO invites (kind, nonce, token_hash, team_id, person_id, revoke_existing, clear_email, created_by, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    input.kind,
    nonce,
    await sha256Hex(token),
    input.teamId ?? null,
    input.personId ?? null,
    input.revokeExisting ? 1 : 0,
    input.clearEmail ? 1 : 0,
    input.createdBy,
    utcIso(now),
    expiresAt,
  );
  return { id: row!.id, token, expiresAt };
}

/** Finds a valid invitation. Throws with an understandable message if it is not (or no longer) valid. */
export async function findValidInvite(env: Env, token: string, now = Date.now()): Promise<InviteRow> {
  if (!/^[\w-]{20,100}$/.test(token)) throw badRequest(t`This invitation link is invalid.`, "invite_invalid");
  const row = await first<InviteRow>(env.DB, "SELECT * FROM invites WHERE token_hash = ?", await sha256Hex(token));
  if (!row) throw badRequest(t`This invitation link is invalid.`, "invite_invalid");
  if (row.kind === "parent") {
    const team = await first<{ parents_enabled: number }>(env.DB, "SELECT parents_enabled FROM teams WHERE id = ?", row.team_id);
    if (team?.parents_enabled !== 1) {
      throw badRequest(t`Parents are not involved in this team. The parent link is therefore not valid.`, "parents_disabled");
    }
  }
  if (row.revoked_at) throw badRequest(t`This invitation link has been withdrawn. Please ask for a new link.`, "invite_revoked");
  if (row.used_at) throw badRequest(t`This link has already been used. Please ask for a new link.`, "invite_used");
  if (Date.parse(row.expires_at) <= now) throw badRequest(t`This invitation link has expired. Please ask for a new link.`, "invite_expired");
  return row;
}

/** At most two parents per child via parent links (admins can link more). */
export const MAX_GUARDIANS = 2;

export async function assertGuardianCapacity(db: D1Database, childIds: number[], guardianId: number | null): Promise<void> {
  const full = await all<{ first_name: string }>(
    db,
    `SELECT p.first_name FROM persons p
      WHERE p.id IN (SELECT value FROM json_each(?1))
        AND (SELECT count(*) FROM guardianships g WHERE g.child_id = p.id AND g.guardian_id IS NOT ?2) >= ?3
        AND NOT EXISTS (SELECT 1 FROM guardianships g WHERE g.child_id = p.id AND g.guardian_id IS ?2)`,
    list(childIds),
    guardianId,
    MAX_GUARDIANS,
  );
  if (full.length) {
    const and = t`and`;
    const names = full.map((f) => f.first_name).join(` ${and} `);
    throw conflict(t`Two parents are already registered for ${names}. Please contact the coaches.`, "child_full");
  }
}
