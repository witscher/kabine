// npm run deploy: build, database migrations, upload, in a controlled order. Workers Builds runs it when a
// club merges an update pull request; it works the same by hand.
//   node scripts/deploy.mjs              a club installation (wrangler.jsonc)
//   node scripts/deploy.mjs --env demo   the public demo (environment "demo")
//
// Without pending migrations it just deploys. With pending migrations:
//   1. note a restore point (D1 Time Travel bookmark) and print it,
//   2. mark the update in the database: the app answers "being updated" to everyone (worker/domain/club.ts),
//   3. apply the migrations, upload the new version,
//   4. remove the mark again, also when something failed, and record the update for Administration → Updates.
// The mark expires after 15 minutes on its own, should this script be cut off. Migrations must keep the previous
// release working (migrations/README.md), so a failed upload after the migrations leaves a usable app.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const envIdx = process.argv.indexOf("--env");
const env = envIdx > 0 ? process.argv[envIdx + 1] : null;
const envArgs = env ? ["--env", env] : [];
const version = JSON.parse(readFileSync("package.json", "utf8")).version;

const wrangler = (args, inherit = false) =>
  execFileSync("npx", ["wrangler", ...args], {
    encoding: "utf8",
    stdio: inherit ? "inherit" : ["ignore", "pipe", "pipe"],
    env: { ...process.env, CI: process.env.CI ?? "1" },
  });
/** The Cloudflare API fails now and then for a moment: repeat steps that are safe to repeat. */
const retry = (step, attempts = 3) => {
  for (let i = 1; ; i++) {
    try {
      return step();
    } catch (err) {
      if (i >= attempts) throw err;
      console.warn(`Cloudflare API failed, trying again (${i}/${attempts - 1}): ${String(err?.stderr || err?.message || err).split("\n").find((l) => l.trim()) ?? ""}`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5000 * i);
    }
  }
};
const sql = (command) => retry(() => wrangler(["d1", "execute", "DB", "--remote", "--yes", ...envArgs, "--command", command]));
const quote = (value) => `'${JSON.stringify(value).replace(/'/g, "''")}'`;
const setMeta = (key, value) =>
  sql(`INSERT INTO app_meta (key, value) VALUES ('${key}', ${quote(value)}) ON CONFLICT(key) DO UPDATE SET value = excluded.value`);

// 1. Build (the Vite plugin writes the config wrangler deploy uses)
execFileSync("npx", ["vite", "build"], { stdio: "inherit", env: { ...process.env, ...(env ? { CLOUDFLARE_ENV: env } : {}) } });

// 2. Which migrations are pending?
const listing = retry(() => wrangler(["d1", "migrations", "list", "DB", "--remote", ...envArgs]));
const pending = [...new Set(listing.match(/[\w.-]+\.sql/g) ?? [])].sort();
const fresh = pending.includes("0001_init.sql");
console.log(pending.length ? `Pending migrations: ${pending.join(", ")}` : "No pending migrations.");

let bookmark = null;
let marked = false;
const now = new Date();
try {
  if (pending.length && !fresh) {
    // Restore point before anything changes
    try {
      const info = retry(() => wrangler(["d1", "time-travel", "info", "DB", "--json", ...envArgs]));
      bookmark = JSON.parse(info.slice(info.indexOf("{"))).bookmark ?? null;
      console.log(`Restore point (D1 Time Travel bookmark): ${bookmark}`);
    } catch (err) {
      console.warn(`No restore point: ${err instanceof Error ? err.message.split("\n")[0] : err}`);
    }
    setMeta("update_in_progress", { since: now.toISOString(), until: new Date(now.getTime() + 15 * 60_000).toISOString(), version });
    marked = true;
    console.log("Update mark set: the app says 'being updated' until the upload is done.");
  }
  if (pending.length) wrangler(["d1", "migrations", "apply", "DB", "--remote", ...envArgs], true);
  wrangler(["deploy"], true);
} catch (err) {
  console.error("\nDeploy failed.");
  if (bookmark) {
    console.error(`To go back: roll back the Worker in the dashboard (Deployments), then`);
    console.error(`  npx wrangler d1 time-travel restore DB --bookmark=${bookmark}${env ? ` --env ${env}` : ""}`);
  }
  process.exitCode = 1;
} finally {
  if (marked) {
    try {
      sql("DELETE FROM app_meta WHERE key = 'update_in_progress'");
      console.log("Update mark removed.");
    } catch (err) {
      console.error(`Could not remove the update mark (it expires within 15 minutes): ${err instanceof Error ? err.message : err}`);
      process.exitCode = 1;
    }
  }
}

/**
 * The club's copy on GitHub ("owner/name"), from the checkout Workers Builds deploys, so "Install update" in the
 * app can open its update pull request. Only owner and name are kept, never the rest of the remote address (it may
 * carry a token); null outside Workers Builds or when the remote is not on GitHub.
 */
function githubCopy() {
  if (!process.env.WORKERS_CI) return null;
  try {
    const remote = execFileSync("git", ["remote", "get-url", "origin"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    const url = new URL(remote.replace(/^git@github\.com:/, "https://github.com/"));
    const m = /^\/([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100}?)(?:\.git)?\/?$/.exec(url.pathname);
    if (url.hostname.toLowerCase() !== "github.com" || !m || `${m[1]}/${m[2]}`.toLowerCase() === "witscher/kabine") return null;
    return `${m[1]}/${m[2]}`;
  } catch {
    return null;
  }
}

if (!process.exitCode) {
  // For Administration → Updates: when, which version, which migrations, the restore point, the club's copy
  const repo = env ? null : githubCopy();
  console.log(repo ? `GitHub copy: ${repo} ("Install update" in the app opens its update pull requests)` : "GitHub copy not found; \"Install update\" in the app opens the guide on kabine.dev.");
  try {
    setMeta("last_update", { at: new Date().toISOString(), version, migrations: fresh ? [] : pending, bookmark, repo });
  } catch (err) {
    console.warn(`Update not recorded: ${err instanceof Error ? err.message.split("\n")[0] : err}`);
  }
  if (!env) await import("./after-deploy.mjs");
}
