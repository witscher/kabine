// Builds the project website (kabine.dev) into site/dist: pages, styles, the demo screenshots and
// the self-hosted fonts. The legal notice needs the publisher's details from site/legal.json (not in
// the repository, see site/legal.example.json); `--preview` builds with placeholders for local viewing.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const preview = process.argv.includes("--preview");
const out = "site/dist";
const read = (f) => readFileSync(f, "utf8");

let legal;
if (existsSync("site/legal.json")) {
  legal = JSON.parse(read("site/legal.json"));
} else if (preview) {
  legal = { name: "[name]", street: "[street]", city: "[postcode city]", email: "[e-mail]" };
} else {
  console.error("site/legal.json is missing (name, street, city, email of the publisher). Copy site/legal.example.json, or use --preview.");
  process.exit(1);
}
for (const key of ["name", "street", "city", "email"]) {
  if (!legal[key]) throw new Error(`site/legal.json: "${key}" is empty`);
}
const escape = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const fill = (html) =>
  html
    .replace("{{LEGAL_NAME}}", escape(legal.name))
    .replace("{{LEGAL_STREET}}", escape(legal.street))
    .replace("{{LEGAL_CITY}}", escape(legal.city))
    .replace("{{LEGAL_EMAIL}}", escape(legal.email));

rmSync(out, { recursive: true, force: true });
for (const dir of ["en/legal", "impressum", "fonts", "shots"]) mkdirSync(`${out}/${dir}`, { recursive: true });

writeFileSync(`${out}/index.html`, read("site/src/index.de.html"));
writeFileSync(`${out}/en/index.html`, read("site/src/index.en.html"));
writeFileSync(`${out}/impressum/index.html`, fill(read("site/src/legal.de.html")));
writeFileSync(`${out}/en/legal/index.html`, fill(read("site/src/legal.en.html")));
for (const f of ["style.css", "lang.js", "icon.svg", "_headers"]) cpSync(`site/src/${f}`, `${out}/${f}`);

// Screenshots of the demo club (npm run screenshots writes them to docs/screenshots)
for (const locale of ["de", "en"]) cpSync(`docs/screenshots/${locale}`, `${out}/shots/${locale}`, { recursive: true });

// Fonts of the app, self-hosted
for (const [pkg, file] of [
  ["barlow", "barlow-latin-400-normal.woff2"],
  ["barlow", "barlow-latin-600-normal.woff2"],
  ["barlow", "barlow-latin-700-normal.woff2"],
  ["barlow-condensed", "barlow-condensed-latin-700-normal.woff2"],
  ["barlow-condensed", "barlow-condensed-latin-800-normal.woff2"],
]) {
  cpSync(`node_modules/@fontsource/${pkg}/files/${file}`, `${out}/fonts/${file}`);
}
console.log(`Website built in ${out}${preview ? " (preview, legal notice has placeholders)" : ""}.`);
