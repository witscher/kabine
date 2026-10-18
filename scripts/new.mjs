// Creates a new module or fixture connector from templates/ and registers it.
//   npm run new -- module <name> --label "Polls" [--label-de "Umfragen"]
//   npm run new -- connector <name> --vendor "nuLiga" --domain nuliga.example [--sport handball]
// <name> is the folder (kebab-case, e.g. "match-reports"); the module id is its camelCase form.
// Afterwards: npm run i18n && npm run check, then fill in README.md and the TODOs. Guide: docs/modules.md.
import { cpSync, existsSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [kind, folder, ...rest] = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 && rest[i + 1] ? rest[i + 1] : fallback;
};
const required = (name, hint) => opt(name) ?? fail(`--${name} ${hint} is required`);
const fail = (msg) => {
  console.error(msg);
  process.exit(1);
};

if (!["module", "connector"].includes(kind) || !folder) {
  fail('Usage: npm run new -- module <name> --label "Name" [--label-de "Name"]\n       npm run new -- connector <name> --vendor "Vendor" --domain example.org [--sport handball]');
}
if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(folder)) fail(`"${folder}": use kebab-case, e.g. match-reports`);
const id = folder.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
const target = join("modules", folder);
if (existsSync(target)) fail(`${target} exists already.`);
const index = readFileSync("modules/index.ts", "utf8");
if (new RegExp(`\\b${id}\\b`).test(index)) fail(`A module "${id}" exists already.`);

const values =
  kind === "module"
    ? { __ID__: id, __FOLDER__: folder, __NAME__: required("label", '"Name"'), __NAME_DE__: null }
    : {
        __ID__: id,
        __FOLDER__: folder,
        __VENDOR__: required("vendor", '"Name"'),
        __DOMAIN__: required("domain", "(e.g. nuliga.example)"),
        __SPORT__: opt("sport", "handball"),
      };
if (kind === "module") values.__NAME_DE__ = opt("label-de", values.__NAME__);
for (const [k, v] of Object.entries(values)) if (/[`"\\$]/.test(v)) fail(`${k}: no quotes, backslashes or $ please.`);

const fill = (s) => Object.entries(values).reduce((acc, [k, v]) => acc.replaceAll(k, v), s);

// Copy the template and fill in the placeholders (also in file names)
cpSync(join("templates", kind), target, { recursive: true });
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else writeFileSync(path, fill(readFileSync(path, "utf8")));
    if (name.includes("__")) renameSync(path, join(dir, fill(name)));
  }
};
walk(target);

// German translations of the template texts (machine-made: the file name ends in .ai.json)
renameSync(join(target, "de.json"), join("locales", "de", `${folder}.ai.json`));

// Register the manifest
const varName = id;
const withImport = index.replace(/(import [^\n]+ from "\.\/[^"]+\/module";\n)(?![\s\S]*import [^\n]+ from "\.\/[^"]+\/module";)/, `$1import ${varName} from "./${folder}/module";\n`);
const withEntry = withImport.replace("  // new modules: above this line", `  ${varName},\n  // new modules: above this line`);
if (withEntry === index || !withEntry.includes(`./${folder}/module`)) fail("Could not update modules/index.ts.");
writeFileSync("modules/index.ts", withEntry);

// A row in docs/modules.md (the contract test looks for it)
const docs = readFileSync("docs/modules.md", "utf8");
const label = kind === "module" ? values.__NAME__ : `Game schedule from ${values.__VENDOR__}`;
const row = `| \`${id}\` | ${label} | off (beta) | \`modules/${folder}/\` |\n`;
const table = docs.indexOf("| Id | Switch | Default | Code |");
const end = docs.indexOf("\n\n", table);
if (table < 0 || end < 0) fail("Could not find the module table in docs/modules.md.");
writeFileSync("docs/modules.md", `${docs.slice(0, end + 1)}${row}${docs.slice(end + 1)}`);

console.log(`Created ${target}/ (module id "${id}", beta, off by default).`);
console.log("Next: npm run i18n && npm run check, then fill in README.md and the module's code.");
if (kind === "connector") console.log("Connector: replace the invented format in worker/connector.ts and record real samples (docs/connectors.md).");
