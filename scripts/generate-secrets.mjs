// Creates the secrets of the app.
//   node scripts/generate-secrets.mjs --dev   -> writes .dev.vars for local development
//   node scripts/generate-secrets.mjs         -> writes .secrets.production.json, see
//                                                docs/operation.md, Secrets
// Both files are excluded by .gitignore. Existing files are only overwritten with --force.
// Optional for an installation: without these secrets the app creates its own keys on first start.
import { existsSync, writeFileSync } from "node:fs";
import { createSecrets } from "./secrets.mjs";

const secrets = await createSecrets();

if (process.argv.includes("--dev")) {
  if (existsSync(".dev.vars") && !process.argv.includes("--force")) {
    console.log(".dev.vars already exists (overwrite with --force).");
    process.exit(0);
  }
  const lines = Object.entries({ ...secrets, ADMIN_BOOTSTRAP_TOKEN: "lokaler-einrichtungs-token-1234" }).map(([k, v]) => `${k}=${v}`);
  writeFileSync(".dev.vars", `${lines.join("\n")}\n`);
  console.log("Local secrets written to .dev.vars.");
  console.log("Local admin setup: http://localhost:5173/einrichtung#lokaler-einrichtungs-token-1234");
} else {
  const file = ".secrets.production.json";
  if (existsSync(file) && !process.argv.includes("--force")) {
    console.log(`${file} already exists and stays unchanged.`);
    console.log("New keys unsubscribe all devices from push, and links already handed out stop working.");
    console.log("Really create new ones: npm run secrets:generate -- --force");
    process.exit(1);
  }
  writeFileSync(file, `${JSON.stringify(secrets, null, 2)}\n`, { mode: 0o600 });
  console.log(`Secrets written to ${file}.`);
  console.log("Upload them with the deployment:");
  console.log(`  npx wrangler secret bulk ${file}`);
  console.log("Then keep the file somewhere safe (e.g. a password manager) and delete it here.");
  console.log("Setup link for the first admin:");
  console.log(`  https://<address of the app>/einrichtung#${secrets.ADMIN_BOOTSTRAP_TOKEN}`);
}
