// Club profile: public read, admin edit, logo, manifest, abbreviation in game titles. Invented names.
import { env, exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { holidaySource } from "../worker/domain/holidays";
import { DEFAULT_CLUB, clubAbbr } from "../shared/club";
import { loadClub, saveClub } from "../worker/domain/club";
import { eventTitle } from "../worker/domain/events";
import { api, freshDb, loginAs, person, season } from "./helpers";

let adminCookie: string;
let playerCookie: string;

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

async function upload(body: BodyInit, type: string, cookie = adminCookie) {
  const res = await exports.default.fetch(
    new Request("http://localhost:5173/api/admin/club/logo", { method: "PUT", headers: { cookie, "content-type": type }, body }),
  );
  return res.status;
}

beforeEach(async () => {
  await freshDb();
  await season();
  const admin = await person("Ada", { admin: true });
  await saveClub(env.DB, { ownerPersonId: admin });
  adminCookie = await loginAs(admin);
  playerCookie = await loginAs(await person("Pia"));
});

describe("Vereinsprofil", () => {
  it("liefert ohne Anmeldung die Vorgaben, ohne Eigentümer", async () => {
    const res = await api("/club");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ...DEFAULT_CLUB, defaultLocale: "de" });
    expect(res.body.ownerPersonId).toBeUndefined();
  });

  it("nur Admins dürfen es ändern, Farben und Link werden geprüft", async () => {
    const patch = { name: "SV Musterstadt 1900", shortName: "SVM Handball", abbr: "SVM", colors: { primary: "#002244", accent: "#ffcc00" } };
    expect((await api("/admin/club", { method: "PUT", cookie: playerCookie, body: patch })).status).toBe(403);
    expect((await api("/admin/club", { method: "PUT", body: patch })).status).toBe(401);
    expect((await api("/admin/club", { method: "PUT", cookie: adminCookie, body: { colors: { primary: "red", accent: "#ffcc00" } } })).status).toBe(400);
    expect((await api("/admin/club", { method: "PUT", cookie: adminCookie, body: { privacyUrl: "http://example.org" } })).status).toBe(400);
    const res = await api("/admin/club", { method: "PUT", cookie: adminCookie, body: { ...patch, privacyUrl: "https://example.org/datenschutz" } });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ...patch, privacyUrl: "https://example.org/datenschutz" });
    expect(res.body.ownerPersonId).toBeUndefined();
    // Der Eigentümer bleibt beim Speichern erhalten
    expect((await loadClub(env.DB)).ownerPersonId).not.toBeNull();
    expect((await api("/club")).body.name).toBe("SV Musterstadt 1900");
  });

  it("Logo: Hochladen, Ausliefern mit Version, Entfernen", async () => {
    expect(await upload(PNG, "image/png", playerCookie)).toBe(403);
    expect(await upload("<html></html>", "text/html")).toBe(400);
    expect(await upload(new Uint8Array(256 * 1024 + 1), "image/png")).toBe(400);
    expect(await upload(PNG, "image/png")).toBe(200);
    const club = (await api("/club")).body;
    expect(club.logoVersion).toBe(1);
    const logo = await exports.default.fetch(new Request(`http://localhost:5173/api/club/logo?v=${club.logoVersion}`));
    expect(logo.status).toBe(200);
    expect(logo.headers.get("content-type")).toBe("image/png");
    // SVG-Logos dürfen kein Skript ausführen
    expect(logo.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(new Uint8Array(await logo.arrayBuffer())).toEqual(PNG);
    expect((await api("/admin/club/logo", { method: "DELETE", cookie: adminCookie })).status).toBe(200);
    expect((await api("/club")).body.logoVersion).toBeNull();
    expect((await exports.default.fetch(new Request("http://localhost:5173/api/club/logo"))).status).toBe(404);
  });

  it("Manifest mit Name und Farbe des Vereins", async () => {
    await saveClub(env.DB, { name: "SV Musterstadt 1900", shortName: "SVM", colors: { primary: "#002244", accent: "#ffcc00" } });
    const res = await exports.default.fetch(new Request("http://localhost:5173/api/manifest"));
    expect(res.headers.get("content-type")).toBe("application/manifest+json");
    expect(await res.json()).toMatchObject({ name: "SV Musterstadt 1900", short_name: "SVM", theme_color: "#002244" });
  });

  it("Kürzel in Spieltiteln: eingestellt oder aus dem Kurznamen", async () => {
    expect(clubAbbr({ abbr: "", shortName: "SVM Handball" })).toBe("SVM");
    expect(clubAbbr({ abbr: "", shortName: "Sportverein Musterstadt" })).toBe("SM");
    expect(clubAbbr({ abbr: " TuS ", shortName: "Egal" })).toBe("TuS");
    await saveClub(env.DB, { abbr: "SVM" });
    const game = { kind: "game", is_home: 1, home_team: "SV Musterstadt", guest_team: "HSG Gegner", title: null } as any;
    expect(eventTitle(game, [{ id: 1, name: "wD" }])).toBe("SVM wD – HSG Gegner");
  });

  it("Eigentümer übergeben nur an Admins", async () => {
    const plain = await person("Ole");
    expect((await api("/admin/club/owner", { method: "PUT", cookie: adminCookie, body: { personId: plain } })).status).toBe(400);
  });
});

describe("Region und Sportart", () => {
  it("speichert Land, Bundesland, Zeitzone und prüft sie", async () => {
    const ok = await api("/admin/club", { method: "PUT", cookie: adminCookie, body: { country: "AT", subdivision: "AT-9", timeZone: "Europe/Vienna" } });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ country: "AT", subdivision: "AT-9", timeZone: "Europe/Vienna" });
    expect((await api("/admin/club", { method: "PUT", cookie: adminCookie, body: { timeZone: "Mars/Olympus" } })).status).toBe(400);
    expect((await api("/admin/club", { method: "PUT", cookie: adminCookie, body: { country: "deu" } })).status).toBe(400);
  });

  it("Länder und Regionen über den Server, ohne Quelle eine leere Liste", async () => {
    const spy = vi.spyOn(holidaySource, "regions").mockResolvedValue({ countries: [{ code: "DE", name: "Deutschland" }], subdivisions: [{ code: "DE-BW", name: "Baden-Württemberg" }] });
    expect((await api("/admin/regions?country=DE", { cookie: playerCookie })).status).toBe(403);
    const res = await api("/admin/regions?country=DE", { cookie: adminCookie });
    expect(res.body.subdivisions).toEqual([{ code: "DE-BW", name: "Baden-Württemberg" }]);
    expect(spy).toHaveBeenCalledWith("DE", "de");
    spy.mockRejectedValue(new Error("offline"));
    expect((await api("/admin/regions?country=DE", { cookie: adminCookie })).body).toEqual({ countries: [], subdivisions: [] });
    vi.restoreAllMocks();
  });

  it("Altersklassen aus dem Sportprofil für die laufende Saison", async () => {
    const res = await api("/age-classes/from-profile", { cookie: adminCookie });
    expect(res.body.sport).toBe("handball");
    expect(res.body.ageClasses.find((a: any) => a.code === "D")).toEqual({
      code: "D",
      name: "D-Jugend",
      rank: 3,
      isYouth: true,
      birthYearMin: 2014,
      birthYearMax: 2015,
      gameMinutes: 90,
      youthReferee: true,
    });
    expect((await api("/age-classes", { method: "PUT", cookie: adminCookie, body: { ageClasses: res.body.ageClasses } })).status).toBe(200);
  });
});
