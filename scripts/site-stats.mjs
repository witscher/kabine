// How many Kabine installations checked for updates per day (site/stats.mjs): counts only, no domains.
//   npm run site:stats            last 30 days
//   npm run site:stats -- 90      last 90 days
// The token comes from .secrets.site.json ({"STATS_TOKEN": "…"}, gitignored), set on the site Worker once with
//   npx wrangler secret put STATS_TOKEN --config site/wrangler.jsonc
import { readFileSync } from "node:fs";

const days = Number(process.argv[2]) || 30;
let token;
try {
  token = JSON.parse(readFileSync(".secrets.site.json", "utf8")).STATS_TOKEN;
} catch {
  // handled below
}
if (!token) {
  console.error("Missing STATS_TOKEN in .secrets.site.json");
  process.exit(1);
}
const res = await fetch(`https://kabine.dev/api/stats/installs?days=${days}`, { headers: { Authorization: `Bearer ${token}` } });
if (!res.ok) {
  console.error(`kabine.dev answered ${res.status}`);
  process.exit(1);
}
const { days: rows } = await res.json();
if (!rows.length) {
  console.log("No update checks counted yet.");
  process.exit(0);
}
console.log("Day          Installations  Checks  Versions");
for (const r of rows) {
  const versions = Object.entries(r.versions)
    .sort((a, b) => b[1] - a[1])
    .map(([v, n]) => `${v}: ${n}`)
    .join(", ");
  console.log(`${r.day}   ${String(r.installs).padStart(13)}  ${String(r.checks).padStart(6)}  ${versions}`);
}
