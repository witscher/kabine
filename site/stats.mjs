// How many Kabine installations are in use, roughly: each installation fetches /releases.json once a day for its
// update check (worker/domain/releases.ts, User-Agent "Kabine/<version>"), and Cloudflare adds the header
// CF-Worker with the installation's domain to every request a Worker makes. Per UTC day this keeps only counts:
// update checks, distinct installations and installations per version. An installation is told apart by a
// SHA-256 of its domain with a random salt of that day; salt and hashes are deleted when the day is over, so
// nothing links one day to the next and no domain or IP address is ever stored. Requests without the Kabine
// User-Agent (browsers, bots) are not counted. Read with `npm run site:stats` (scripts/site-stats.mjs).
import { DurableObject } from "cloudflare:workers";

/** Days of counts kept. */
export const KEEP_DAYS = 400;
const VERSION = /^Kabine\/(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\b/;

/** The installation's version from the User-Agent, or null when the request is not a Kabine update check. */
export function kabineVersion(userAgent) {
  return VERSION.exec(userAgent ?? "")?.[1] ?? null;
}

/** Counts one update check (`key` is the CF-Worker domain, may be null) on a Durable Object storage. */
export async function recordCheck(storage, { key, version, now = Date.now() }) {
  const day = new Date(now).toISOString().slice(0, 10);
  let today = await storage.get("today");
  if (!today || today.day !== day) {
    // A new day: the old salt and hashes go, only the counts stay
    today = { day, salt: randomHex(16), seen: [] };
    await pruneDays(storage, day);
  }
  const counts = (await storage.get(`day:${day}`)) ?? { checks: 0, installs: 0, versions: {} };
  counts.checks++;
  if (key) {
    const hash = await sha256Hex(`${today.salt}:${key.toLowerCase()}`);
    if (!today.seen.includes(hash)) {
      today.seen.push(hash);
      counts.installs++;
      counts.versions[version] = (counts.versions[version] ?? 0) + 1;
    }
  }
  await storage.put({ today, [`day:${day}`]: counts });
}

/** The counts of the last `days` days, newest first. */
export async function readCounts(storage, days = 30) {
  const all = await storage.list({ prefix: "day:", reverse: true, limit: Math.min(Math.max(days, 1), KEEP_DAYS) });
  return [...all].map(([k, v]) => ({ day: k.slice(4), ...v }));
}

async function pruneDays(storage, day) {
  const cutoff = new Date(Date.parse(`${day}T00:00:00Z`) - KEEP_DAYS * 86_400_000).toISOString().slice(0, 10);
  const old = await storage.list({ prefix: "day:", end: `day:${cutoff}` });
  if (old.size) await storage.delete([...old.keys()]);
}

function randomHex(bytes) {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(text) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

export class KabineInstallStats extends DurableObject {
  record(check) {
    return recordCheck(this.ctx.storage, check);
  }
  counts(days) {
    return readCounts(this.ctx.storage, days);
  }
}

/** GET /releases.json: the file, and a Kabine update check is counted in the background. */
export function handleReleases(request, env, ctx) {
  const version = request.method === "GET" ? kabineVersion(request.headers.get("User-Agent")) : null;
  if (version && env.INSTALL_STATS) {
    const stats = env.INSTALL_STATS.get(env.INSTALL_STATS.idFromName("installs"));
    ctx.waitUntil(stats.record({ key: request.headers.get("CF-Worker"), version }).catch(() => {}));
  }
  return env.ASSETS.fetch(request);
}

/** GET /api/stats/installs?days=30 with "Authorization: Bearer <STATS_TOKEN>": the daily counts as JSON. */
export async function handleStats(request, env) {
  const token = env.STATS_TOKEN;
  const given = (request.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token || !given || !(await sameText(given, token))) return new Response("Not found", { status: 404 });
  const days = Number(new URL(request.url).searchParams.get("days")) || 30;
  const stats = env.INSTALL_STATS.get(env.INSTALL_STATS.idFromName("installs"));
  return Response.json({ days: await stats.counts(days) }, { headers: { "Cache-Control": "no-store" } });
}

/** Compares two strings in constant time (by their hashes). */
async function sameText(a, b) {
  const [x, y] = await Promise.all([sha256Hex(a), sha256Hex(b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}
