// Break-glass: rescue when nobody (trustworthy) can get into Administration. Creates or reuses an admin and prints a
// personal link, valid for 24 hours, to set up a passkey with it. Runs against the club's database with Wrangler,
// so only someone with access to the club's Cloudflare account can use it. Every use is recorded and shown under
// Administration → Updates and maintenance. docs/operation.md, Break-glass.
//
//   npm run admin:link -- --first Alex --last Admin --email alex@club.example
//   --owner               the person also becomes the owner of the installation (to remove a previous owner)
//   --revoke-all-admins   compromised accesses: every other admin loses the role and is signed out (implies --owner;
//                         asks for confirmation unless --yes)
//   options: --env <name> (environment of wrangler.jsonc)  --config <file>  --local  --origin https://app.club.example
import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { ADMIN_LINK_HOURS, adminLinkProblem, adminLinkSql, adminsSql } from "./admin-link-sql.mjs";

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const input = { firstName: arg("first"), lastName: arg("last"), email: arg("email") };
const problem = adminLinkProblem(input);
if (problem) {
  console.error(`Usage: npm run admin:link -- --first <first name> --last <last name> --email <address>\nMissing or invalid: ${problem}`);
  process.exit(1);
}

const flag = (name) => process.argv.includes(`--${name}`);
const revokeOthers = flag("revoke-all-admins");
const owner = flag("owner") || revokeOthers;
const where = flag("local") ? ["--local"] : ["--remote"];
const extra = [...(arg("env") ? ["--env", arg("env")] : []), ...(arg("config") ? ["--config", arg("config")] : [])];
const d1 = (sql, json = false) =>
  execFileSync("npx", ["wrangler", "d1", "execute", "DB", ...where, ...extra, "--yes", ...(json ? ["--json"] : []), "--command", sql], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    env: { ...process.env, CI: process.env.CI ?? "1" },
  });

if (revokeOthers && !flag("yes")) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(
    `Break-glass: every admin except ${input.email.trim()} loses the admin role and is signed out on all devices.\nType REVOKE to continue: `,
  );
  rl.close();
  if (answer.trim() !== "REVOKE") {
    console.error("Cancelled, nothing changed.");
    process.exit(1);
  }
}

// A random token; the database only keeps its hash, like for every invitation link
const token = randomBytes(24).toString("base64url");
const tokenHash = createHash("sha256").update(token).digest("hex");
const nonce = randomBytes(18).toString("base64url");
d1(adminLinkSql({ ...input, nonce, tokenHash, owner, revokeOthers }));

const rows = JSON.parse(d1("SELECT (SELECT value FROM app_meta WHERE key = 'app_origin') AS origin, (SELECT count(*) FROM invites WHERE token_hash = '" + tokenHash + "') AS n", true));
const { origin: stored, n } = rows[0].results[0];
if (n !== 1) {
  console.error("The link was not stored. Check the output above.");
  process.exit(1);
}
const origin = (arg("origin") ?? stored ?? "").replace(/\/$/, "");
const url = `${origin || "https://<address of the app>"}/einladung#${token}`;
const admins = JSON.parse(d1(adminsSql(input.email), true))[0].results;
const others = admins.filter((a) => !a.rescued);
const name = (a) => `${a.first_name} ${a.last_name ?? ""}`.trim();
console.log(`
Break-glass admin link for ${input.firstName.trim()} ${input.lastName.trim()}, valid for ${ADMIN_LINK_HOURS} hours:

  ${url}

Open it on the device that should get access and set up a passkey. The link works once.
If this person already had an access, its devices are signed out.${owner ? "\nThis person is now the owner of the installation." : ""}${
  revokeOthers ? "\nAll other admins lost the admin role and were signed out." : ""
}${origin ? "" : "\nThe app's address is not known yet: pass it with --origin."}

${
  others.length
    ? `Other admins (check that each one still belongs there):\n${others
        .map((a) => `  - ${name(a)}${a.owner ? " (owner)" : ""}, last seen ${a.last_seen ?? "never"}`)
        .join("\n")}`
    : "No other admins."
}

Recorded under Administration → Updates and maintenance. Next steps: docs/operation.md, Break-glass.
`);
