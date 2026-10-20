// node scripts/update-notes.mjs <CHANGELOG.md> <installed version>: prints the release notes since that version.
import { readFileSync } from "node:fs";
import { notesSince } from "./update-notes-lib.mjs";

const [file, installed] = process.argv.slice(2);
process.stdout.write(`${notesSince(readFileSync(file, "utf8"), installed)}\n`);
