// Counting installations on kabine.dev (site/stats.mjs): only Kabine update checks count, one installation once a
// day, per version; no domain is stored and nothing links one day to the next; the counts need the token.
import { describe, expect, it } from "vitest";
import { handleReleases, handleStats, kabineVersion, readCounts, recordCheck } from "../site/stats.mjs";

/** A Durable Object storage in memory, enough for site/stats.mjs. */
function memoryStorage() {
  const m = new Map<string, unknown>();
  return {
    map: m,
    async get(k: string) {
      return structuredClone(m.get(k));
    },
    async put(k: string | Record<string, unknown>, v?: unknown) {
      if (typeof k === "string") m.set(k, structuredClone(v));
      else for (const [kk, vv] of Object.entries(k)) m.set(kk, structuredClone(vv));
    },
    async delete(keys: string[]) {
      for (const k of keys) m.delete(k);
    },
    async list({ prefix, end, reverse, limit }: { prefix: string; end?: string; reverse?: boolean; limit?: number }) {
      let keys = [...m.keys()].filter((k) => k.startsWith(prefix) && (!end || k < end)).sort();
      if (reverse) keys.reverse();
      if (limit) keys = keys.slice(0, limit);
      return new Map(keys.map((k) => [k, structuredClone(m.get(k))]));
    },
  };
}

const DAY1 = Date.parse("2026-12-01T10:00:00Z");
const DAY2 = Date.parse("2026-12-02T10:00:00Z");

describe("installations on kabine.dev", () => {
  it("reads the version only from the User-Agent of a Kabine update check", () => {
    expect(kabineVersion("Kabine/1.0.0")).toBe("1.0.0");
    expect(kabineVersion("Kabine/1.1.0-rc.2 (update check)")).toBe("1.1.0-rc.2");
    expect(kabineVersion("Mozilla/5.0 (iPhone)")).toBeNull();
    expect(kabineVersion(null)).toBeNull();
  });

  it("counts each installation once a day, per version, and stores no domain", async () => {
    const s = memoryStorage();
    await recordCheck(s, { key: "app.sv-musterstadt.example", version: "1.0.0", now: DAY1 });
    await recordCheck(s, { key: "APP.sv-musterstadt.example", version: "1.0.0", now: DAY1 + 3600_000 });
    await recordCheck(s, { key: "kabine.tus-beispiel.example", version: "0.9.0", now: DAY1 });
    await recordCheck(s, { key: null, version: "1.0.0", now: DAY1 });
    const [day] = await readCounts(s, 30);
    expect(day).toEqual({ day: "2026-12-01", checks: 4, installs: 2, versions: { "1.0.0": 1, "0.9.0": 1 } });
    expect(JSON.stringify([...s.map.entries()])).not.toContain("musterstadt");
  });

  it("forgets salt and hashes when the day is over, the counts stay", async () => {
    const s = memoryStorage();
    await recordCheck(s, { key: "app.sv-musterstadt.example", version: "1.0.0", now: DAY1 });
    const salt1 = ((await s.get("today")) as { salt: string }).salt;
    await recordCheck(s, { key: "app.sv-musterstadt.example", version: "1.0.0", now: DAY2 });
    const today = (await s.get("today")) as { day: string; salt: string; seen: string[] };
    expect(today.day).toBe("2026-12-02");
    expect(today.salt).not.toBe(salt1);
    expect(today.seen).toHaveLength(1);
    expect((await readCounts(s, 30)).map((d) => [d.day, d.installs])).toEqual([
      ["2026-12-02", 1],
      ["2026-12-01", 1],
    ]);
  });

  it("counts only update checks and always serves the file", async () => {
    const recorded: unknown[] = [];
    const waits: Promise<unknown>[] = [];
    const env = {
      ASSETS: { fetch: async () => new Response("{}", { headers: { "content-type": "application/json" } }) },
      INSTALL_STATS: { idFromName: () => "id", get: () => ({ record: async (c: unknown) => void recorded.push(c) }) },
    };
    const ctx = { waitUntil: (p: Promise<unknown>) => void waits.push(p) };
    const get = (headers: Record<string, string>) => handleReleases(new Request("https://kabine.dev/releases.json", { headers }), env, ctx);
    expect((await get({ "User-Agent": "Mozilla/5.0" })).status).toBe(200);
    expect((await get({ "User-Agent": "Kabine/1.0.0", "CF-Worker": "app.sv-musterstadt.example" })).status).toBe(200);
    await Promise.all(waits);
    expect(recorded).toEqual([{ key: "app.sv-musterstadt.example", version: "1.0.0" }]);
  });

  it("shows the counts only with the token", async () => {
    const env = { STATS_TOKEN: "test-stats-token", INSTALL_STATS: { idFromName: () => "id", get: () => ({ counts: async () => [{ day: "2026-12-01" }] }) } };
    const ask = (auth?: string) => handleStats(new Request("https://kabine.dev/api/stats/installs", { headers: auth ? { Authorization: auth } : {} }), env);
    expect((await ask()).status).toBe(404);
    expect((await ask("Bearer wrong")).status).toBe(404);
    const ok = await ask("Bearer test-stats-token");
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ days: [{ day: "2026-12-01" }] });
  });
});
