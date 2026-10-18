// Wartungsmodus ein- und ausschalten: nur Admins kommen in die App, Cron-Läufe pausieren.
// Aufruf: node scripts/maintenance.mjs on|off|status [--env staging]
// Der Schalter liegt im KV-Namespace der App (Schlüssel "maintenance"), unabhängig von der Datenbank.
// Er wirkt nach spätestens etwa 60 Sekunden (Cache von KV an den Standorten).
import { execFileSync } from "node:child_process";

const [cmd] = process.argv.slice(2);
const envIdx = process.argv.indexOf("--env");
const env = envIdx > 0 ? process.argv[envIdx + 1] : null;
if (!["on", "off", "status"].includes(cmd) || (env && env !== "staging")) {
  console.error("Aufruf: node scripts/maintenance.mjs on|off|status [--env staging]");
  process.exit(1);
}
const target = [...(env ? ["--env", env] : []), "--config", "wrangler.jsonc", "--remote"];
const run = (args) => execFileSync("npx", ["wrangler", "kv", "key", ...args, "--binding", "KV", ...target], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const where = env ? "Staging" : "Live";

if (cmd === "on") {
  run(["put", "maintenance", JSON.stringify({ since: new Date().toISOString() })]);
  console.log(`Wartungsmodus ${where} eingeschaltet. Nur Admins kommen in die App, Cron-Läufe pausieren (wirkt nach spätestens etwa 60 Sekunden).`);
} else if (cmd === "off") {
  try {
    run(["delete", "maintenance"]);
  } catch {
    // war nicht gesetzt
  }
  console.log(`Wartungsmodus ${where} ausgeschaltet (wirkt nach spätestens etwa 60 Sekunden).`);
} else {
  let value = null;
  try {
    value = run(["get", "maintenance"]).trim();
  } catch {
    value = null;
  }
  console.log(value && !/not found/i.test(value) ? `Wartungsmodus ${where} aktiv seit ${JSON.parse(value).since}` : `Wartungsmodus ${where} aus`);
}
