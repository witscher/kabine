// Setup wizard: sport profile applied to a fresh installation. Invented names.
import { describe, expect, it } from "vitest";
import { seasonAround } from "../shared/sports";
import { api, freshDb, loginAs, person, rows } from "./helpers";

describe("Einrichtungsassistent", () => {
  it("Saison um heute aus dem Saisonbeginn der Sportart", () => {
    expect(seasonAround("2026-10-18", { month: 7, day: 1 })).toEqual({ name: "2026/27", startsOn: "2026-07-01", endsOn: "2027-06-30" });
    expect(seasonAround("2027-03-01", { month: 7, day: 1 })).toEqual({ name: "2026/27", startsOn: "2026-07-01", endsOn: "2027-06-30" });
    expect(seasonAround("2027-03-01", { month: 1, day: 1 })).toEqual({ name: "2027", startsOn: "2027-01-01", endsOn: "2027-12-31" });
  });

  it("frische Installation: Saison, Altersklassen und Dienste der Sportart in der Vereinssprache", async () => {
    await freshDb();
    const cookie = await loginAs(await person("Ada", { admin: true }));
    const before = await api("/admin/setup", { cookie });
    expect(before.body).toMatchObject({ setupDone: false, season: null, ageClasses: 0, teams: 0 });
    expect((await api("/admin/setup/sport", { cookie, body: { sport: "handball" } })).status).toBe(200);
    const after = await api("/admin/setup", { cookie });
    expect(after.body.season).not.toBeNull();
    expect(after.body.ageClasses).toBe(8);
    expect(await rows("SELECT code, name FROM duty_types WHERE event_id IS NULL ORDER BY sort")).toEqual([
      { code: "kiosk", name: "Kuchen & Theke" },
      { code: "timekeeper", name: "Zeitnehmer" },
      { code: "scorer", name: "Sekretär" },
      { code: "shirts", name: "Trikots waschen" },
      { code: "referee", name: "KiHaSL/JuHaSL" },
    ]);
    expect(await rows("SELECT name, default_for FROM duty_templates ORDER BY default_for")).toEqual([
      { name: "Auswärtsspiel", default_for: "away" },
      { name: "Heimspiel", default_for: "home" },
    ]);
    // Zweiter Lauf mit anderer Sportart: Saison und Altersklassen bleiben, Dienste werden ersetzt
    await api("/admin/setup/sport", { cookie, body: { sport: "football" } });
    expect((await api("/admin/setup", { cookie })).body.ageClasses).toBe(8);
    expect(await rows("SELECT code FROM duty_types WHERE event_id IS NULL ORDER BY sort")).toEqual([{ code: "kiosk" }, { code: "linesman" }, { code: "shirts" }]);
    expect((await api("/admin/setup/done", { cookie, body: {} })).status).toBe(200);
    expect((await api("/club")).body.setupDone).toBe(true);
  });
});
