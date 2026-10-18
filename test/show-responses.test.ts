// Schalter „Zu- und Absagen für alle sichtbar“ pro Mannschaft. Namen erfunden.
import { beforeEach, describe, expect, it } from "vitest";
import { api, eventIn, exec, freshDb, guardian, loginAs, member, person, season, team } from "./helpers";

let damen: number;
let wd: number;
let coach: number;
let anna: number;
let berta: number;
let carla: number;
let training: number;

beforeEach(async () => {
  await freshDb();
  await season();
  damen = await team("Frauen", "F");
  wd = await team("wD", "wD");
  coach = await person("Tina");
  anna = await person("Anna", { lastName: "Muster" });
  berta = await person("Berta", { lastName: "Beispiel" });
  carla = await person("Carla", { lastName: "Probe" });
  await member(coach, damen, "coach");
  await member(anna, damen);
  await member(berta, damen);
  await member(carla, wd);
  training = await eventIn(damen, 2);
  await exec("INSERT INTO responses (event_id, person_id, status, reason, responded_at) VALUES (?, ?, 'no', 'Zahnarzt', '2026-01-01T00:00:00Z')", training, berta);
});

describe("Zu- und Absagen für alle sichtbar", () => {
  it("standardmäßig aus: Spieler sehen keine Namen", async () => {
    const res = await api(`/events/${training}`, { cookie: await loginAs(anna) });
    expect(res.body.roster).toBeNull();
    expect(res.body.participants).toBeNull();
  });

  it("eingeschaltet: Namen und Status ohne Gründe, nur für Beteiligte und nicht bei Spielen", async () => {
    const coachCookie = await loginAs(coach);
    expect((await api(`/teams/${damen}`, { method: "PATCH", cookie: coachCookie, body: { showResponses: true } })).status).toBe(200);
    expect((await api(`/teams/${damen}`, { cookie: coachCookie })).body.showResponses).toBe(true);

    const res = await api(`/events/${training}`, { cookie: await loginAs(anna) });
    expect(res.body.roster).toEqual([
      { personId: anna, name: "Anna M.", status: "yes" },
      { personId: berta, name: "Berta B.", status: "no" },
    ]);
    expect(JSON.stringify(res.body)).not.toContain("Zahnarzt");

    // Spiel: weiterhin keine Liste
    const game = await eventIn(damen, 3, { kind: "game" });
    await exec("INSERT INTO nominations (event_id, person_id) VALUES (?, ?)", game, anna);
    expect((await api(`/events/${game}`, { cookie: await loginAs(anna) })).body.roster).toBeNull();
    // Trainer bekommen weiter die volle Teilnehmerliste
    expect((await api(`/events/${training}`, { cookie: coachCookie })).body.roster).toBeNull();
  });

  it("Eltern eingebundener Kinder sehen die Liste, Spieler nicht ohne Trainerrecht umschalten", async () => {
    await exec("UPDATE teams SET show_responses = 1 WHERE id = ?", wd);
    const t = await eventIn(wd, 2);
    const mum = await person("Mama");
    await guardian(mum, carla);
    expect((await api(`/events/${t}`, { cookie: await loginAs(mum) })).body.roster).toEqual([{ personId: carla, name: "Carla P.", status: "yes" }]);
    expect((await api(`/teams/${damen}`, { method: "PATCH", cookie: await loginAs(anna), body: { showResponses: true } })).status).toBe(403);
  });
});
