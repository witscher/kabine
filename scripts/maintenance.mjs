// Switches maintenance mode on and off: only admins can use the app, cron runs pause.
// Usage: node scripts/maintenance.mjs on|off|status [--env <name>]
// The switch lives in the app's KV namespace (key "maintenance"), independent of the database.
// It takes effect within about 60 seconds (KV is cached at Cloudflare's locations).
import { execFileSync } from "node:child_process";

const [cmd] = process.argv.slice(2);
const envIdx = process.argv.indexOf("--env");
const env = envIdx > 0 ? process.argv[envIdx + 1] : null;
if (!["on", "off", "status"].includes(cmd) || (envIdx > 0 && !env)) {
  console.error("Usage: node scripts/maintenance.mjs on|off|status [--env <name>]");
  process.exit(1);
}
const target = [...(env ? ["--env", env] : []), "--config", "wrangler.jsonc", "--remote"];
const run = (args) => execFileSync("npx", ["wrangler", "kv", "key", ...args, "--binding", "KV", ...target], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const where = env ? ` (${env})` : "";

if (cmd === "on") {
  run(["put", "maintenance", JSON.stringify({ since: new Date().toISOString() })]);
  console.log(`Maintenance mode on${where}. Only admins can use the app, cron runs pause (takes effect within about 60 seconds).`);
} else if (cmd === "off") {
  try {
    run(["delete", "maintenance"]);
  } catch {
    // was not set
  }
  console.log(`Maintenance mode off${where} (takes effect within about 60 seconds).`);
} else {
  let value = null;
  try {
    value = run(["get", "maintenance"]).trim();
  } catch {
    value = null;
  }
  console.log(value && !/not found/i.test(value) ? `Maintenance mode on${where} since ${JSON.parse(value).since}` : `Maintenance mode off${where}`);
}
