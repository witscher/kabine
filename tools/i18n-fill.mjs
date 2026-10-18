// Fills German translations into locales/de.po from locales/de/*.json ({ "English msgid": "Deutsch" }).
// Files named *.ai.json hold machine translations: their entries get the comment "ai".
// and checks the catalog: every message translated, same placeholders and tags as the source.
// Entries translated by a machine carry the translator comment "ai" (see docs/translation.md).
// Usage: npx lingui extract && node tools/i18n-fill.mjs [--check]
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import PO from "pofile";

const check = process.argv.includes("--check");
const dir = new URL("../locales/de/", import.meta.url);
const mapping = new Map();
for (const f of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
  for (const [id, text] of Object.entries(JSON.parse(readFileSync(new URL(f, dir), "utf8")))) {
    if (mapping.has(id) && mapping.get(id).text !== text) console.warn(`Different translations for "${id}" in ${mapping.get(id).file} and ${f}`);
    mapping.set(id, { text, file: f, ai: f.endsWith(".ai.json") });
  }
}

const file = new URL("../locales/de.po", import.meta.url);
const po = PO.parse(readFileSync(file, "utf8"));
const tokens = (s) => [...s.matchAll(/\{[^{}]+\}|<\/?\d+\/?>/g)].map((m) => m[0].replace(/^\{(\w+)[^}]*\}$/, "{$1}")).sort().join(" ");
let filled = 0;
const problems = [];
for (const item of po.items) {
  const key = item.msgctxt ? `${item.msgid}  [context: ${item.msgctxt}]` : item.msgid;
  if (!item.msgstr[0] && mapping.has(key)) {
    item.msgstr = [mapping.get(key).text];
    // Machine translations are marked until a person has checked them
    if (mapping.get(key).ai && !item.comments.includes("ai")) item.comments.push("ai");
    filled++;
  }
  if (!item.msgstr[0]) problems.push(`missing: ${JSON.stringify(key)}`);
  else if (!item.msgid.includes("{0, plural") && !item.msgid.includes(", plural,") && tokens(item.msgid) !== tokens(item.msgstr[0])) {
    problems.push(`placeholders differ: ${JSON.stringify(item.msgid)} -> ${JSON.stringify(item.msgstr[0])}`);
  }
}
if (!check) writeFileSync(file, po.toString() + "\n");
console.log(`${filled} filled, ${po.items.length} messages, ${problems.length} problems`);
for (const p of problems.slice(0, 50)) console.log(`  ${p}`);
if (problems.length) process.exitCode = 1;
