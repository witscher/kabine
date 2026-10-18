// Ferienzeiträume: frei bearbeitbar, Ferienpläne ziehen mit, Import im Saisonwechsel. Erfundene Daten.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { holidaySource } from "../worker/domain/holidays";
import { addDays, todayLocal } from "../worker/lib/time";
import { api, freshDb, hall, loginAs, member, one, person, rows, season, team } from "./helpers";

let wd: number;
let adminCookie: string;
let coachCookie: string;
let halle: number;
const today = todayLocal();
const from = addDays(today, 10);
const to = addDays(today, 16);

beforeEach(async () => {
  await freshDb();
  await season();
  wd = await team("wD", "wD");
  halle = await hall();
  const admin = await person("Ada", { admin: true });
  const coach = await person("Tina");
  await member(coach, wd, "coach");
  adminCookie = await loginAs(admin);
  coachCookie = await loginAs(coach);
});

afterEach(() => vi.restoreAllMocks());

async function trainingsBetween(a: string, b: string) {
  return (await rows<{ starts_at: string }>("SELECT starts_at FROM events WHERE kind = 'training' AND starts_at >= ? AND starts_at <= ? ORDER BY starts_at", a, `${b}T23:59`)).length;
}

describe("Ferienzeiträume", () => {
  it("Admins legen an, ändern und löschen; Trainer nicht", async () => {
    expect((await api("/holidays", { cookie: coachCookie, body: { name: "Herbstferien", startsOn: from, endsOn: to } })).status).toBe(403);
    expect((await api("/holidays", { cookie: adminCookie, body: { name: "Herbstferien", startsOn: to, endsOn: from } })).status).toBe(400);
    const created = await api("/holidays", { cookie: adminCookie, body: { name: "Herbstferien", startsOn: from, endsOn: to } });
    expect(created.status).toBe(201);
    const id = created.body.id;
    expect((await api(`/holidays/${id}`, { method: "PATCH", cookie: adminCookie, body: { name: "Fastnachtsferien", startsOn: from, endsOn: addDays(to, 1) } })).status).toBe(
      200,
    );
    const list = (await api("/holidays", { cookie: adminCookie })).body.periods;
    expect(list).toMatchObject([{ id, name: "Fastnachtsferien", startsOn: from, endsOn: addDays(to, 1), plans: 0 }]);
    expect((await api(`/holidays/${id}`, { method: "DELETE", cookie: adminCookie })).status).toBe(200);
    expect((await api("/holidays", { cookie: adminCookie })).body.periods).toEqual([]);
  });

  it("verknüpfter Ferienplan zieht bei Änderungen mit, Trainings werden neu berechnet", async () => {
    const { id: periodId } = (await api("/holidays", { cookie: adminCookie, body: { name: "Herbstferien", startsOn: from, endsOn: to } })).body;
    // Regulärer Plan mit täglichem Training, Ferienplan ohne Regeln = Pause
    const rules = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, startsAt: "17:00", endsAt: "18:00", locationId: halle }));
    expect((await api(`/teams/${wd}/plans`, { cookie: coachCookie, body: { name: "Regulär", kind: "regular", validFrom: today, validTo: addDays(today, 60), rules } })).status).toBe(201);
    const pause = await api(`/teams/${wd}/plans`, {
      cookie: coachCookie,
      body: { name: "Pause Herbstferien", kind: "holiday", validFrom: "2000-01-01", validTo: "2000-01-02", holidayPeriodId: periodId, rules: [] },
    });
    expect(pause.status).toBe(201);
    // Daten kommen aus dem Zeitraum, nicht aus der Anfrage
    expect(await one("SELECT valid_from, valid_to, holiday_period_id FROM training_plans WHERE id = ?", pause.body.id)).toEqual({
      valid_from: from,
      valid_to: to,
      holiday_period_id: periodId,
    });
    expect(await trainingsBetween(from, to)).toBe(0);

    // Ferien um zwei Tage verschoben: Plan und Trainings folgen
    const newFrom = addDays(from, 2);
    const newTo = addDays(to, 2);
    const res = await api(`/holidays/${periodId}`, { method: "PATCH", cookie: adminCookie, body: { name: "Herbstferien", startsOn: newFrom, endsOn: newTo } });
    expect(res.body).toMatchObject({ ok: true, plans: 1 });
    expect(await one("SELECT valid_from, valid_to FROM training_plans WHERE id = ?", pause.body.id)).toEqual({ valid_from: newFrom, valid_to: newTo });
    expect(await trainingsBetween(newFrom, newTo)).toBe(0);
    expect(await trainingsBetween(from, addDays(from, 1))).toBe(2);
    expect((await api("/holidays", { cookie: adminCookie })).body.periods[0].plans).toBe(1);

    // Löschen: Plan bleibt mit seinen Daten, ohne Verknüpfung
    await api(`/holidays/${periodId}`, { method: "DELETE", cookie: adminCookie });
    expect(await one("SELECT valid_from, valid_to, holiday_period_id FROM training_plans WHERE id = ?", pause.body.id)).toEqual({
      valid_from: newFrom,
      valid_to: newTo,
      holiday_period_id: null,
    });
  });

  it("Trainingspläne der Mannschaft sehen alle kommenden Ferien, auch in über einem Jahr", async () => {
    const far = addDays(today, 430);
    await api("/holidays", { cookie: adminCookie, body: { name: "Sommerferien", startsOn: far, endsOn: addDays(far, 40) } });
    await api("/holidays", { cookie: adminCookie, body: { name: "Vergangen", startsOn: addDays(today, -20), endsOn: addDays(today, -10) } });
    const names = (await api(`/teams/${wd}/plans`, { cookie: coachCookie })).body.holidays.map((h: any) => h.name);
    expect(names).toEqual(["Sommerferien"]);
  });

  it("eigene Daten im Ferienplan lösen die Verknüpfung", async () => {
    const { id: periodId } = (await api("/holidays", { cookie: adminCookie, body: { name: "Herbstferien", startsOn: from, endsOn: to } })).body;
    const plan = await api(`/teams/${wd}/plans`, {
      cookie: coachCookie,
      body: { name: "Ferienplan", kind: "holiday", validFrom: from, validTo: to, holidayPeriodId: periodId, rules: [] },
    });
    await api(`/plans/${plan.body.id}`, { method: "PATCH", cookie: coachCookie, body: { validFrom: from, validTo: addDays(to, 3), holidayPeriodId: null } });
    expect(await one("SELECT valid_to, holiday_period_id FROM training_plans WHERE id = ?", plan.body.id)).toEqual({ valid_to: addDays(to, 3), holiday_period_id: null });
    // Ändern der Ferien wirkt nicht mehr
    await api(`/holidays/${periodId}`, { method: "PATCH", cookie: adminCookie, body: { name: "Herbstferien", startsOn: from, endsOn: addDays(to, 1) } });
    expect(await one("SELECT valid_to FROM training_plans WHERE id = ?", plan.body.id)).toEqual({ valid_to: addDays(to, 3) });
  });
});

describe("Ferien im Saisonwechsel", () => {
  async function change(holidays: unknown) {
    const created = await api("/seasons", { cookie: adminCookie, body: { name: "2027/28", startsOn: "2027-07-01", endsOn: "2028-06-30" } });
    const preview = await api(`/season-change/preview?seasonId=${created.body.id}`, { cookie: adminCookie });
    expect(preview.status).toBe(200);
    const done = await api("/season-change/execute", {
      cookie: adminCookie,
      body: { seasonId: created.body.id, confirmName: "2027/28", assignments: [], holidays: holidays ?? preview.body.holidays },
    });
    expect(done.status).toBe(200);
    return preview.body;
  }

  it("übernimmt die BW-Ferien der neuen Saison und ersetzt die bisherigen", async () => {
    await api("/holidays", { cookie: adminCookie, body: { name: "Alte Ferien", startsOn: from, endsOn: to } });
    const spy = vi.spyOn(holidaySource, "bw").mockResolvedValue([
      { name: "Herbstferien", startsOn: "2027-11-02", endsOn: "2027-11-06" },
      { name: "Weihnachtsferien", startsOn: "2027-12-23", endsOn: "2028-01-08" },
    ]);
    const preview = await change(null);
    expect(spy).toHaveBeenCalledWith("2027-07-01", "2028-06-30");
    expect(preview.holidaysError).toBeNull();
    expect(await rows("SELECT name, starts_on, imported FROM holiday_periods ORDER BY starts_on")).toEqual([
      { name: "Herbstferien", starts_on: "2027-11-02", imported: 1 },
      { name: "Weihnachtsferien", starts_on: "2027-12-23", imported: 1 },
    ]);
  });

  it("ohne erreichbare Quelle bleiben die bisherigen Ferien", async () => {
    await api("/holidays", { cookie: adminCookie, body: { name: "Alte Ferien", startsOn: from, endsOn: to } });
    vi.spyOn(holidaySource, "bw").mockRejectedValue(new Error("offline"));
    const preview = await change(null);
    expect(preview.holidaysError).toContain("nicht laden");
    expect(await rows("SELECT name FROM holiday_periods")).toEqual([{ name: "Alte Ferien" }]);
  });
});
