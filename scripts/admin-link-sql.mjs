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
 *
 * owner: the person becomes the owner of the installation, so they can remove a previous owner who is gone or
 * compromised (other admins cannot, worker/auth/owner.ts). revokeOthers (compromised accesses): every other admin
 * loses the role and is signed out on all devices, their open personal links are withdrawn; implies owner.
 * They keep their other roles (coach, parent); the new admin decides about the rest in the app.
 */
export function adminLinkSql({ firstName, lastName, email, nonce, tokenHash, now = new Date(), owner = false, revokeOthers = false }) {
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
    // Break-glass record, before the changes so it can name the admins who lose the role: shown under
    // Administration → Updates and maintenance, the last 20 uses
    `INSERT INTO app_meta (key, value) VALUES ('break_glass', '[]') ON CONFLICT(key) DO NOTHING;`,
    `UPDATE app_meta SET value = (
       SELECT json_group_array(json(e)) FROM (
         SELECT json_set(${q(JSON.stringify({ at, email: email.trim().toLowerCase(), owner: owner || revokeOthers }))}, '$.revoked',
                  ${revokeOthers ? `(SELECT json_group_array(n) FROM (SELECT trim(first_name || ' ' || coalesce(last_name, '')) AS n FROM persons WHERE is_admin = 1 AND id NOT IN (${person}) ORDER BY n))` : "json('[]')"}) AS e, -1 AS o
         UNION ALL SELECT value, key FROM json_each((SELECT value FROM app_meta WHERE key = 'break_glass'))
         ORDER BY o LIMIT 20))
     WHERE key = 'break_glass';`,
    ...(revokeOthers ? revokeOthersSql(person, at) : []),
    ...(owner || revokeOthers
      ? [`UPDATE app_meta SET value = json_set(value, '$.ownerPersonId', (${person} ORDER BY id LIMIT 1)) WHERE key = 'club';`]
      : []),
  ].join("\n");
}

/** Every other admin: signed out, open personal links withdrawn, admin mode off, role and admin address removed. */
function revokeOthersSql(person, at) {
  const others = `SELECT id FROM persons WHERE is_admin = 1 AND id NOT IN (${person})`;
  return [
    `DELETE FROM sessions WHERE account_id IN (SELECT id FROM accounts WHERE person_id IN (${others}));`,
    `UPDATE invites SET revoked_at = ${q(at)}
      WHERE kind = 'personal' AND person_id IN (${others}) AND revoked_at IS NULL AND used_at IS NULL;`,
    `UPDATE accounts SET coach_mode = 0 WHERE person_id IN (${others});`,
    `UPDATE persons SET is_admin = 0, admin_email = NULL WHERE id IN (${others});`,
  ];
}

/** The admins after the command, for its output: who else can get into the administration. */
export function adminsSql(email) {
  return `SELECT p.first_name, p.last_name, p.admin_email, lower(p.admin_email) = ${q(email.trim().toLowerCase())} AS rescued,
                 json_extract((SELECT value FROM app_meta WHERE key = 'club'), '$.ownerPersonId') = p.id AS owner,
                 (SELECT max(a.last_seen_on) FROM accounts a WHERE a.person_id = p.id) AS last_seen
            FROM persons p WHERE p.is_admin = 1 ORDER BY rescued DESC, p.first_name, p.last_name`;
}
