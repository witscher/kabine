// Modules: switched off, their API paths do not exist and their data does not appear. Invented names.
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { moduleOn } from "../shared/club";
import { saveClub } from "../worker/domain/club";
import { moduleOfPath } from "../worker/lib/modules";
import { api, eventIn, exec, freshDb, loginAs, member, person, season, team } from "./helpers";

let wd: number;
let coachCookie: string;
let game: number;

beforeEach(async () => {
  await freshDb();
  await season();
  wd = await team("wD", "wD");
  await exec("UPDATE teams SET helper_plan = 1 WHERE id = ?", wd);
  const coach = await person("Tara");
  await member(coach, wd, "coach");
  coachCookie = await loginAs(coach);
  game = await eventIn(wd, 5, { kind: "game", time: "14:00" });
  await exec("UPDATE events SET is_home = 0, home_team = 'SG Gegner', guest_team = 'SV Musterstadt' WHERE id = ?", game);
});

describe("Module", () => {
  it("ordnet API-Pfade den Modulen zu", () => {
    expect(moduleOfPath("/api/duties/teams")).toBe("duties");
    expect(moduleOfPath("/api/duties/referee")).toBe("youthReferees");
    expect(moduleOfPath("/api/admin/referee-links")).toBe("youthReferees");
    expect(moduleOfPath("/api/events/12/carpool/offers/3")).toBe("carpools");
    expect(moduleOfPath("/api/teams/4/games/claim")).toBe("handball4all");
    expect(moduleOfPath("/api/events")).toBeNull();
    expect(moduleOfPath("/api/duties/teams/4/games")).toBeNull();
    expect(moduleOfPath("/api/duties/games/9")).toBeNull();
    expect(moduleOfPath("/api/admin/club-members/3")).toBeNull();
  });

  it("Jugendschiedsrichter brauchen Helferdienste", () => {
    const all = { duties: true, carpools: true, youthReferees: true, handball4all: true, sms: false };
    expect(moduleOn(all, "youthReferees")).toBe(true);
    expect(moduleOn({ ...all, duties: false }, "youthReferees")).toBe(false);
  });

  it("eingeschaltet: Helferplan und Fahrgemeinschaft da", async () => {
    expect((await api(`/duties?teamId=${wd}`, { cookie: coachCookie })).status).toBe(200);
    expect((await api("/session", { cookie: coachCookie })).body.me.helperTeams).toHaveLength(1);
  });

  it("ausgeschaltet: Pfade 404, keine Helfer- und Fahrgemeinschaftsdaten", async () => {
    await saveClub(env.DB, { modules: { duties: false, carpools: false, youthReferees: true, handball4all: false, sms: false } });
    const duties = await api(`/duties?teamId=${wd}`, { cookie: coachCookie });
    expect(duties.status).toBe(404);
    expect(duties.body.error.code).toBe("module_off");
    expect((await api("/duties/referee", { cookie: coachCookie })).status).toBe(404);
    expect((await api(`/events/${game}/carpool/offers/1`, { cookie: coachCookie, method: "PUT", body: { seats: 2 } })).status).toBe(404);
    expect((await api(`/teams/${wd}/games/claim`, { cookie: coachCookie, body: { manual: true } })).status).toBe(404);
    expect((await api("/session", { cookie: coachCookie })).body.me.helperTeams).toEqual([]);
    const detail = await api(`/events/${game}`, { cookie: coachCookie });
    expect(detail.body.carpool).toBeNull();
    expect(await env.DB.prepare("SELECT count(*) AS n FROM event_duties").first<{ n: number }>()).toEqual({ n: 0 });
  });

  it("nur Admins schalten Module", async () => {
    expect((await api("/admin/club", { method: "PUT", cookie: coachCookie, body: { modules: { carpools: false } } })).status).toBe(403);
    const admin = await loginAs(await person("Ada", { admin: true }));
    const res = await api("/admin/club", { method: "PUT", cookie: admin, body: { modules: { carpools: false } } });
    expect(res.body.modules).toMatchObject({ duties: true, carpools: false });
  });
});
