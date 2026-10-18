// Spiele ohne handball4all anlegen, Sondertermine bearbeiten, Admin-Liste. Namen erfunden.
import { beforeEach, describe, expect, it } from "vitest";
import { addDays, todayLocal } from "../worker/lib/time";
import { api, eventIn, exec, freshDb, loginAs, member, person, rows, season, team } from "./helpers";

let wd: number;
let mb: number;
let coach: number;
let admin: number;

beforeEach(async () => {
  await freshDb();
  await season();
  wd = await team("wD", "wD");
  mb = await team("mB", "mB");
  coach = await person("Tina");
  admin = await person("Ada", { admin: true });
  await member(coach, wd, "coach");
  await member(admin, mb, "coach");
});

describe("Spiel ohne handball4all", () => {
  it("bekommt ein Ende 90 Minuten nach Anwurf, nur in der Zukunft", async () => {
    const cookie = await loginAs(coach);
    const date = addDays(todayLocal(), 5);
    const res = await api(`/duties/teams/${wd}/games`, { cookie, body: { opponent: "HSG Musterstadt", isHome: false, date, time: "11:00" } });
    expect(res.status).toBe(201);
    expect(await rows("SELECT kind, starts_at, ends_at, home_team, is_home, h4a_game_id FROM events WHERE id = ?", res.body.id)).toEqual([
      { kind: "game", starts_at: `${date}T11:00`, ends_at: `${date}T12:30`, home_team: "HSG Musterstadt", is_home: 0, h4a_game_id: null },
    ]);
    const past = await api(`/duties/teams/${wd}/games`, { cookie, body: { opponent: "HSG Musterstadt", isHome: true, date: addDays(todayLocal(), -1), time: "11:00" } });
    expect(past.status).toBe(400);
  });
});

describe("Sondertermin bearbeiten", () => {
  it("Titel und Infos ändern sich, Datum bleibt", async () => {
    const id = await eventIn(wd, 4, { kind: "special", title: "Fotoshooting" });
    const res = await api(`/events/${id}`, { method: "PATCH", cookie: await loginAs(coach), body: { title: "Mannschaftsfoto", notes: "Trikot mitbringen" } });
    expect(res.status).toBe(200);
    expect(await rows("SELECT title, notes, is_detached FROM events WHERE id = ?", id)).toEqual([{ title: "Mannschaftsfoto", notes: "Trikot mitbringen", is_detached: 0 }]);
  });
});

describe("Team → Termine", () => {
  it("Trainer sieht kommende Sondertermine und eigene Spiele seiner Mannschaft", async () => {
    const special = await eventIn(wd, 3, { kind: "special", title: "Fotoshooting" });
    await eventIn(mb, 3, { kind: "special", title: "Andere Mannschaft" });
    const res = await api(`/teams/${wd}/extra-events`, { cookie: await loginAs(coach) });
    expect(res.body.events.map((e: { id: number }) => e.id)).toEqual([special]);
    expect((await api(`/teams/${mb}/extra-events`, { cookie: await loginAs(coach) })).status).toBe(403);
  });

  it("Uhrzeit eines Sondertermins lässt sich ändern", async () => {
    const id = await eventIn(wd, 4, { kind: "special", title: "Fotoshooting" });
    const starts_at = (await rows<{ starts_at: string }>("SELECT starts_at FROM events WHERE id = ?", id))[0]!.starts_at;
    const moved = `${starts_at.slice(0, 10)}T15:30`;
    expect((await api(`/events/${id}`, { method: "PATCH", cookie: await loginAs(coach), body: { startsAt: moved, endsAt: null, locationId: null } })).status).toBe(200);
    expect(await rows("SELECT starts_at FROM events WHERE id = ?", id)).toEqual([{ starts_at: moved }]);
  });
});

describe("Verwaltung → Sondertermine und Spiele", () => {
  it("zeigt kommende Sondertermine und Spiele ohne handball4all anderer Mannschaften", async () => {
    const special = await eventIn(wd, 3, { kind: "special", title: "Fotoshooting" });
    const manual = await eventIn(wd, 6, { kind: "game" });
    await exec("UPDATE events SET is_home = 1, home_team = 'SV Musterstadt', guest_team = 'HSG Musterstadt' WHERE id = ?", manual);
    const h4a = await eventIn(wd, 7, { kind: "game" });
    await exec("UPDATE events SET h4a_game_id = '123' WHERE id = ?", h4a);
    await eventIn(wd, -2, { kind: "special", title: "Vorbei" });
    await eventIn(wd, 2); // Training
    const own = await eventIn(mb, 5, { kind: "special", title: "Eigene Feier" });

    const res = await api("/admin/extra-events", { cookie: await loginAs(admin) });
    expect(res.status).toBe(200);
    const ids = res.body.events.map((e: { id: number }) => e.id);
    expect(ids).toEqual([special, manual]);
    expect(ids).not.toContain(own);
    expect(res.body.events[0]).toMatchObject({ kind: "special", title: "Fotoshooting", teams: [{ id: wd, name: "wD" }] });

    expect((await api("/admin/extra-events", { cookie: await loginAs(coach) })).status).toBe(403);
  });
});
