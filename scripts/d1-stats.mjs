// Read load of the database (read-only): queries, rows read and database time from D1 insights, and the queries
// that read the most rows. To compare before and after a change, and for clubs that want to check their load against
// the free plan (5 million rows read per day).
//   npm run d1:stats                       last 24 hours
//   npm run d1:stats -- 7d                 last 7 days
//   npm run d1:stats -- 7d --env demo      another environment of wrangler.jsonc
//   npm run d1:stats -- 7d --json          raw data
import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const period = args.find((a) => /^\d+[dh]$/.test(a)) ?? "1d";
const json = args.includes("--json");
const envIdx = args.indexOf("--env");
const env = envIdx >= 0 ? args[envIdx + 1] : null;
if (envIdx >= 0 && !env) {
  console.error("Usage: npm run d1:stats -- [1d|7d|24h] [--env <name>] [--json]");
  process.exit(1);
}

const out = execFileSync(
  "npx",
  ["wrangler", "d1", "insights", "DB", "--time-period", period, "--sort-by", "reads", "--limit", "1000", "--json", "--config", "wrangler.jsonc", ...(env ? ["--env", env] : [])],
  { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], maxBuffer: 64 * 1024 * 1024 },
);
const rows = JSON.parse(out.slice(out.indexOf("[")));
if (json) {
  console.log(JSON.stringify(rows, null, 2));
  process.exit(0);
}
const sum = (f) => rows.reduce((n, r) => n + (r[f] ?? 0), 0);
const days = period.endsWith("d") ? Number(period.slice(0, -1)) : Number(period.slice(0, -1)) / 24;
const fmt = (n) => Math.round(n).toLocaleString("en-GB");
const reads = sum("totalRowsRead");
console.log(`D1${env ? ` (${env})` : ""}, period ${period}`);
console.log(`  Queries:       ${fmt(sum("numberOfTimesRun"))} (${fmt(sum("numberOfTimesRun") / days)} per day)`);
console.log(`  Rows read:     ${fmt(reads)} (${fmt(reads / days)} per day; free plan 5,000,000 per day)`);
console.log(`  Rows written:  ${fmt(sum("totalRowsWritten"))}`);
console.log(`  Database time: ${(sum("totalDurationMs") / 1000).toFixed(1)} s`);
console.log("\nMost rows read:");
for (const r of rows.slice(0, 12)) {
  const q = r.query.replace(/\s+/g, " ").slice(0, 90);
  console.log(`  ${fmt(r.totalRowsRead).padStart(11)} rows ${String(r.numberOfTimesRun).padStart(7)}× ${((r.totalRowsRead / Math.max(1, reads)) * 100).toFixed(1).padStart(5)} %  ${q}`);
}
