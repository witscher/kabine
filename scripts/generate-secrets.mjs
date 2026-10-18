// Erzeugt die Secrets der App.
//   node scripts/generate-secrets.mjs --dev   -> schreibt .dev.vars für die lokale Entwicklung
//   node scripts/generate-secrets.mjs         -> schreibt .secrets.production.json, siehe
//                                                docs/deployment.md
// Beide Dateien sind per .gitignore ausgeschlossen. Vorhandene Dateien werden nur
// mit --force überschrieben.
import { existsSync, writeFileSync } from "node:fs";
import { createSecrets } from "./secrets.mjs";

const secrets = await createSecrets();

if (process.argv.includes("--dev")) {
  if (existsSync(".dev.vars") && !process.argv.includes("--force")) {
    console.log(".dev.vars existiert bereits (mit --force überschreiben).");
    process.exit(0);
  }
  const lines = Object.entries({ ...secrets, ADMIN_BOOTSTRAP_TOKEN: "lokaler-einrichtungs-token-1234" }).map(([k, v]) => `${k}=${v}`);
  writeFileSync(".dev.vars", `${lines.join("\n")}\n`);
  console.log("Lokale Secrets in .dev.vars geschrieben.");
  console.log("Admin-Einrichtung lokal: http://localhost:5173/einrichtung#lokaler-einrichtungs-token-1234");
} else {
  const file = ".secrets.production.json";
  if (existsSync(file) && !process.argv.includes("--force")) {
    console.log(`${file} existiert bereits und bleibt unverändert.`);
    console.log("Neue Schlüssel melden alle Geräte von Push ab, und angezeigte Einladungslinks passen nicht mehr.");
    console.log("Wirklich neu erzeugen: npm run secrets:generate -- --force");
    process.exit(1);
  }
  writeFileSync(file, `${JSON.stringify(secrets, null, 2)}\n`, { mode: 0o600 });
  console.log(`Secrets in ${file} geschrieben.`);
  console.log("Beim ersten Deployment mitgeben:");
  console.log(`  npm run deploy -- --secrets-file ${file}`);
  console.log("Die Datei danach sicher aufbewahren (z. B. im Passwortmanager) und hier löschen.");
  console.log("Einrichtungslink für den ersten Admin:");
  console.log(`  https://<adresse-der-app>/einrichtung#${secrets.ADMIN_BOOTSTRAP_TOKEN}`);
}
