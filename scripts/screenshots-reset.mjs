// Fresh local data for the README screenshots: migrations, the invented demo club (seed/demo.sql)
// and sign-ins for the demo people, so the scenes need no passkeys. Only for the local
// screenshot build, never for a real installation.
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { DEPLOY_REDIRECT, DEPLOY_REDIRECT_BACKUP, isE2eRedirect } from "../e2e/deploy-redirect.mjs";

const STATE = ".wrangler/shots-state";
const locale = process.env.KABINE_SHOTS_LOCALE === "en" ? "en" : "de";

rmSync(STATE, { recursive: true, force: true });
mkdirSync(STATE, { recursive: true });

// Same guard as the e2e build: the screenshot build must never become the deployed one
const current = existsSync(DEPLOY_REDIRECT) ? readFileSync(DEPLOY_REDIRECT, "utf8") : null;
const previous = current && !isE2eRedirect(current) ? current : null;
writeFileSync(DEPLOY_REDIRECT_BACKUP, JSON.stringify({ previous }));

/** Token of the demo session of a person; the scenes compute the same value. */
export const shotToken = (personId) => `shots-${personId}-0123456789abcdef0123456789abcdef`;
const hash = (s) => createHash("sha256").update(s).digest("hex");

const people = [100, 101, 102, 103, 201, 202, 203, 204, 205, 206, 207, 208, 301, 302, 401, 501, 502];
const now = new Date();
const later = new Date(now.getTime() + 30 * 86_400_000);
const sql = [
  "INSERT INTO persons (id, first_name, last_name, is_admin) VALUES (100, 'Alex', 'Admin', 1);",
  `UPDATE app_meta SET value = json_set(value, '$.defaultLocale', '${locale}', '$.ownerPersonId', 100) WHERE key = 'club';`,
  "UPDATE teams SET helper_plan = 1 WHERE id IN (1, 2);",
  ...people.map((id) => `INSERT INTO accounts (id, person_id, webauthn_user_id, locale) VALUES (${id}, ${id}, 'shots-${id}', '${locale}');`),
  ...people.map(
    (id) =>
      `INSERT INTO sessions (id, account_id, created_at, expires_at, extended_at, device_label) VALUES ('${hash(shotToken(id))}', ${id}, '${now.toISOString()}', '${later.toISOString()}', '${now.toISOString()}', 'Screenshots');`,
  ),
];
if (locale === "en") {
  // The demo club is German; in the English pictures the age groups and halls read in English
  const names = { E: "E youth", D: "D youth", C: "C youth", B: "B youth", A: "A youth", Adults: "Adults" };
  for (const [code, name] of Object.entries(names)) sql.push(`UPDATE age_classes SET name = '${name}' WHERE code = '${code}';`);
  sql.push("UPDATE locations SET name = 'Musterstadt sports hall', address = '1 Hall Road, Musterstadt' WHERE id = 1;");
  sql.push("UPDATE locations SET name = 'Park school gym', address = '5 Park Street, Musterstadt' WHERE id = 2;");
  sql.push("UPDATE training_plans SET name = 'Training plan 2026/27';");
}
writeFileSync(`${STATE}/shots.sql`, sql.join("\n"));

const run = (cmd) => execSync(cmd, { stdio: "pipe", env: { ...process.env, CI: "1" } });
run(`npx wrangler d1 migrations apply DB --local --persist-to ${STATE}`);
run(`npx wrangler d1 execute DB --local --persist-to ${STATE} --file seed/demo.sql`);
run(`npx wrangler d1 execute DB --local --persist-to ${STATE} --file ${STATE}/shots.sql`);
console.log(`Screenshot data ready (${locale}).`);
