// Modules: switched off, their API paths do not exist and their data does not appear. Invented names.
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { moduleOn } from "../shared/club";
import { DEFAULT_MODULES, moduleManifest, moduleOffered } from "../shared/modules";
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
    // Schedule routes are the core's; they answer 404 while no fixtures module is on (worker/routes/games.ts)
    expect(moduleOfPath("/api/teams/4/games/claim")).toBeNull();
    expect(moduleOfPath("/api/events")).toBeNull();
    expect(moduleOfPath("/api/duties/teams/4/games")).toBeNull();
    expect(moduleOfPath("/api/duties/games/9")).toBeNull();
    expect(moduleOfPath("/api/admin/club-members/3")).toBeNull();
  });

  it("Jugendschiedsrichter brauchen Helferdienste", () => {
    const all = { ...DEFAULT_MODULES, duties: true, youthReferees: true };
    expect(moduleOn({ modules: all, sport: "handball" }, "youthReferees")).toBe(true);
    expect(moduleOn({ modules: { ...all, duties: false }, sport: "handball" }, "youthReferees")).toBe(false);
  });

  it("Handball-Module sind bei anderen Sportarten aus, auch wenn sie gespeichert an sind", () => {
    const all = { ...DEFAULT_MODULES, duties: true, youthReferees: true, handball4all: true, carpools: true };
    expect(moduleOn({ modules: all, sport: "football" }, "youthReferees")).toBe(false);
    expect(moduleOn({ modules: all, sport: "football" }, "handball4all")).toBe(false);
    expect(moduleOn({ modules: all, sport: "football" }, "carpools")).toBe(true);
    expect(moduleOffered(moduleManifest("handball4all"), "football")).toBe(false);
    expect(moduleOffered(moduleManifest("carpools"), "football")).toBe(true);
  });

  it("Fußballverein: handball4all-Pfade antworten 404, obwohl das Modul gespeichert an ist", async () => {
    await saveClub(env.DB, { sport: "football", modules: { ...DEFAULT_MODULES, handball4all: true } });
    expect((await api(`/teams/${wd}/games/claim`, { cookie: coachCookie, body: { manual: true } })).status).toBe(404);
  });

  it("eingeschaltet: Helferplan und Fahrgemeinschaft da", async () => {
    expect((await api(`/duties?teamId=${wd}`, { cookie: coachCookie })).status).toBe(200);
    expect((await api("/session", { cookie: coachCookie })).body.me.helperTeams).toHaveLength(1);
  });

  it("ausgeschaltet: Pfade 404, keine Helfer- und Fahrgemeinschaftsdaten", async () => {
    await saveClub(env.DB, { modules: { ...DEFAULT_MODULES, duties: false, carpools: false, youthReferees: true, handball4all: false, sms: false } });
    const duties = await api(`/duties?teamId=${wd}`, { cookie: coachCookie });
    expect(duties.status).toBe(404);
    expect(duties.body.error.code).toBe("module_off");
    expect((await api("/duties/referee", { cookie: coachCookie })).status).toBe(404);
    expect((await api(`/events/${game}/carpool/offers/1`, { cookie: coachCookie, method: "PUT", body: { seats: 2 } })).status).toBe(404);
    expect((await api(`/teams/${wd}/games/claim`, { cookie: coachCookie, body: { manual: true } })).status).toBe(404);
    expect((await api("/session", { cookie: coachCookie })).body.me.helperTeams).toEqual([]);
    const detail = await api(`/events/${game}`, { cookie: coachCookie });
    expect(detail.body.modules.carpools).toBeUndefined();
    expect(await env.DB.prepare("SELECT count(*) AS n FROM event_duties").first<{ n: number }>()).toEqual({ n: 0 });
  });

  it("nur Admins schalten Module", async () => {
    expect((await api("/admin/club", { method: "PUT", cookie: coachCookie, body: { modules: { carpools: false } } })).status).toBe(403);
    const admin = await loginAs(await person("Ada", { admin: true }));
    const res = await api("/admin/club", { method: "PUT", cookie: admin, body: { modules: { carpools: false } } });
    expect(res.body.modules).toMatchObject({ duties: true, carpools: false });
  });
});
