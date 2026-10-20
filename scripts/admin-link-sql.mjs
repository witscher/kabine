// SQL for `npm run admin:link` (scripts/admin-link.mjs), kept separate so the test runs it against a real
// database (test/admin-link.test.ts). The link is an ordinary personal invitation: the server only checks
// the SHA-256 hash of its token, so no secret of the installation is needed.

/** Hours a rescue link stays valid: long enough to open it, short enough not to linger in a terminal history. */
export const ADMIN_LINK_HOURS = 24;

const NAME = /^[^\s].{0,49}$/u;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Checks the input; returns an error message or null. */
export function adminLinkProblem({ firstName, lastName, email }) {
  if (!firstName || !NAME.test(firstName.trim())) return "--first: first name (1–50 characters)";
  if (!lastName || !NAME.test(lastName.trim())) return "--last: last name (1–50 characters)";
  if (!email || !EMAIL.test(email.trim())) return "--email: a valid e-mail address (it becomes the admin's address)";
  return null;
}

const q = (v) => `'${String(v).replace(/'/g, "''")}'`;

/**
 * One batch: the admin person (created, or the existing one with this admin address made admin again), older
 * open personal links of that person withdrawn, the new link. Takes over an existing access (signs out its devices),
 * as every personal link does. created_by is the person itself: whoever can run this controls the Cloudflare
 * account anyway, and so the link also works for the owner of the installation (worker/auth/owner.ts).
 */
export function adminLinkSql({ firstName, lastName, email, nonce, tokenHash, now = new Date() }) {
  const at = now.toISOString();
  const expires = new Date(now.getTime() + ADMIN_LINK_HOURS * 3_600_000).toISOString();
  const mail = q(email.trim().toLowerCase());
  // Also a person who left: the address is unique, and an admin needed for rescue comes back
  const person = `SELECT id FROM persons WHERE lower(admin_email) = ${mail}`;
  return [
    `INSERT INTO persons (first_name, last_name, is_admin, admin_email, is_active)
       SELECT ${q(firstName.trim())}, ${q(lastName.trim())}, 1, ${mail}, 1
        WHERE NOT EXISTS (${person});`,
    `UPDATE persons SET is_admin = 1, is_active = 1, is_former = 0, left_at = NULL WHERE id IN (${person});`,
    `UPDATE invites SET revoked_at = ${q(at)}
      WHERE kind = 'personal' AND person_id IN (${person}) AND revoked_at IS NULL AND used_at IS NULL;`,
    `INSERT INTO invites (kind, nonce, token_hash, person_id, revoke_existing, created_by, created_at, expires_at)
       SELECT 'personal', ${q(nonce)}, ${q(tokenHash)}, p.id, EXISTS (SELECT 1 FROM accounts a WHERE a.person_id = p.id), p.id, ${q(at)}, ${q(expires)}
         FROM persons p WHERE p.id IN (${person}) ORDER BY p.id LIMIT 1;`,
  ].join("\n");
}
