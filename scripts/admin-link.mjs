// Rescue when nobody can get into Administration (all admins lost their devices, or nobody set up access):
// creates or reuses an admin and prints a personal link, valid for 24 hours, to set up a passkey with it.
// Runs against the database of the club's installation with Wrangler, so only someone with access to the
// club's Cloudflare account can use it.
//
//   npm run admin:link -- --first Alex --last Admin --email alex@club.example
//   options: --env <name> (environment of wrangler.jsonc)  --config <file>  --local  --origin https://app.club.example
import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { ADMIN_LINK_HOURS, adminLinkProblem, adminLinkSql } from "./admin-link-sql.mjs";

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

const where = process.argv.includes("--local") ? ["--local"] : ["--remote"];
const extra = [...(arg("env") ? ["--env", arg("env")] : []), ...(arg("config") ? ["--config", arg("config")] : [])];
const d1 = (sql, json = false) =>
  execFileSync("npx", ["wrangler", "d1", "execute", "DB", ...where, ...extra, "--yes", ...(json ? ["--json"] : []), "--command", sql], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    env: { ...process.env, CI: process.env.CI ?? "1" },
  });

// A random token; the database only keeps its hash, like for every invitation link
const token = randomBytes(24).toString("base64url");
const tokenHash = createHash("sha256").update(token).digest("hex");
const nonce = randomBytes(18).toString("base64url");
d1(adminLinkSql({ ...input, nonce, tokenHash }));

const rows = JSON.parse(d1("SELECT (SELECT value FROM app_meta WHERE key = 'app_origin') AS origin, (SELECT count(*) FROM invites WHERE token_hash = '" + tokenHash + "') AS n", true));
const { origin: stored, n } = rows[0].results[0];
if (n !== 1) {
  console.error("The link was not stored. Check the output above.");
  process.exit(1);
}
const origin = (arg("origin") ?? stored ?? "").replace(/\/$/, "");
const url = `${origin || "https://<address of the app>"}/einladung#${token}`;
console.log(`
Admin link for ${input.firstName.trim()} ${input.lastName.trim()}, valid for ${ADMIN_LINK_HOURS} hours:

  ${url}

Open it on the device that should get access and set up a passkey. The link works once.
If this person already had an access, its devices are signed out.${origin ? "" : "\nThe app's address is not known yet: pass it with --origin."}
`);
