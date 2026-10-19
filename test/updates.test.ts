// Controlled updates (scripts/deploy.mjs): while the update mark is set nobody gets into the API, admins
// neither, and the cron run pauses. Administration → Updates and maintenance. Names invented.
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleScheduled } from "../worker/cron";
import { MAINTENANCE_KEY } from "../worker/lib/maintenance";
import { api, exec, freshDb, loginAs, member, person, season, team } from "./helpers";

let adminCookie: string;
let coachCookie: string;

async function markUpdate(minutes = 15) {
  const now = Date.now();
  const mark = { since: new Date(now).toISOString(), until: new Date(now + minutes * 60_000).toISOString(), version: "0.2.0" };
  await exec("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('update_in_progress', ?)", JSON.stringify(mark));
}

beforeEach(async () => {
  await freshDb();
  await season();
  const wd = await team("wD", "wD");
  const admin = await person("Ada", { admin: true });
  const coach = await person("Tara");
  await member(coach, wd, "coach");
  adminCookie = await loginAs(admin);
  coachCookie = await loginAs(coach);
});

afterEach(async () => {
  await env.KV.delete(MAINTENANCE_KEY);
});

describe("update in progress", () => {
  it("everyone gets 503 updating, admins too; health and sign-in stay reachable", async () => {
    await markUpdate();
    for (const cookie of [adminCookie, coachCookie]) {
      const res = await api("/events", { cookie });
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe("updating");
    }
    expect((await api("/health")).body).toMatchObject({ ok: true, maintenance: true, updating: true });
    expect((await api("/auth/login/options", { body: {} })).status).not.toBe(503);
  });

  it("an expired mark no longer blocks", async () => {
    await markUpdate(-1);
    expect((await api("/events", { cookie: coachCookie })).status).toBe(200);
    expect((await api("/health")).body).toMatchObject({ maintenance: false, updating: false });
  });

  it("the cron run is skipped and the app is open again once the mark is gone", async () => {
    await markUpdate();
    const log = vi.spyOn(console, "log");
    await handleScheduled(env, Date.now());
    expect(log).toHaveBeenCalledWith("Update in progress, cron run skipped");
    log.mockRestore();
    await exec("DELETE FROM app_meta WHERE key = 'update_in_progress'");
    expect((await api("/events", { cookie: coachCookie })).status).toBe(200);
  });
});

describe("Administration → Updates and maintenance", () => {
  it("shows version, last update and maintenance state to admins only", async () => {
    const last = { at: "2026-10-19T03:00:00Z", version: "0.2.0", migrations: ["202610190300_core_example.sql"], bookmark: "00000085-0000024c-00004c6d-8e61117bf38d7adb71b934ebbf891683" };
    await exec("INSERT INTO app_meta (key, value) VALUES ('last_update', ?)", JSON.stringify(last));
    expect((await api("/admin/updates", { cookie: coachCookie })).status).toBe(403);
    const res = await api("/admin/updates", { cookie: adminCookie });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ lastUpdate: last, maintenance: null, updating: null });
    expect(res.body.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("admins switch maintenance mode on and off", async () => {
    expect((await api("/admin/maintenance", { method: "PUT", body: { on: true }, cookie: coachCookie })).status).toBe(403);
    expect((await api("/admin/maintenance", { method: "PUT", body: { on: true }, cookie: adminCookie })).body).toEqual({ maintenance: true });
    expect(await env.KV.get(MAINTENANCE_KEY)).toBeTruthy();
    expect((await api("/admin/updates", { cookie: adminCookie })).body.maintenance).toMatchObject({ since: expect.any(String) });
    expect((await api("/events", { cookie: coachCookie })).body.error.code).toBe("maintenance");
    expect((await api("/admin/maintenance", { method: "PUT", body: { on: false }, cookie: adminCookie })).body).toEqual({ maintenance: false });
    expect(await env.KV.get(MAINTENANCE_KEY)).toBeNull();
  });
});
