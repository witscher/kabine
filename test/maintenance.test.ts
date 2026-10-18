// Wartungsmodus: nur Admins in der API, Cron pausiert. Namen erfunden.
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleScheduled } from "../worker/cron";
import { MAINTENANCE_KEY } from "../worker/lib/maintenance";
import { api, exec, freshDb, loginAs, member, person, season, team } from "./helpers";

let adminCookie: string;
let coachCookie: string;
let playerCookie: string;
let wd: number;

beforeEach(async () => {
  await freshDb();
  await season();
  wd = await team("wD", "wD");
  const admin = await person("Ada", { admin: true });
  const coach = await person("Tara");
  const player = await person("Lina");
  await member(coach, wd, "coach");
  await member(player, wd);
  adminCookie = await loginAs(admin);
  coachCookie = await loginAs(coach);
  playerCookie = await loginAs(player);
  await env.KV.put(MAINTENANCE_KEY, JSON.stringify({ since: "2026-10-15T19:00:00Z" }));
});

afterEach(async () => {
  await env.KV.delete(MAINTENANCE_KEY);
});

describe("Wartungsmodus", () => {
  it("nur Admins kommen in die API, die anderen bekommen 503 maintenance", async () => {
    expect((await api("/health")).body).toMatchObject({ ok: true, maintenance: true });
    const blocked = await api("/events", { cookie: playerCookie });
    expect(blocked.status).toBe(503);
    expect(blocked.body.error.code).toBe("maintenance");
    expect((await api("/session", { cookie: coachCookie })).status).toBe(503);
    expect((await api("/events", { cookie: adminCookie })).status).toBe(200);
    expect((await api("/session", { cookie: adminCookie })).status).toBe(200);
  });

  it("Anmeldung bleibt erreichbar, damit Admins sich anmelden können", async () => {
    expect((await api("/session")).body).toMatchObject({ authenticated: false });
    expect((await api("/auth/login/options", { body: {} })).status).not.toBe(503);
    expect((await api("/events")).status).toBe(503);
  });

  it("Admins im Trainer-Modus kommen weiter rein", async () => {
    const admin2 = await person("Uwe", { admin: true });
    await member(admin2, wd, "coach");
    const cookie = await loginAs(admin2);
    await exec("UPDATE accounts SET coach_mode = 1 WHERE person_id = ?", admin2);
    expect((await api("/events", { cookie })).status).toBe(200);
  });

  it("der Cron-Lauf wird ausgelassen, nach dem Ausschalten ist alles wieder offen", async () => {
    const log = vi.spyOn(console, "log");
    await handleScheduled(env, Date.now());
    expect(log).toHaveBeenCalledWith("Wartungsmodus aktiv, Cron-Lauf ausgelassen");
    log.mockRestore();
    await env.KV.delete(MAINTENANCE_KEY);
    expect((await api("/events", { cookie: playerCookie })).status).toBe(200);
    expect((await api("/health")).body.maintenance).toBe(false);
  });
});
