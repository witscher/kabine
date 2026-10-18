// Spieler in zwei Mannschaften einer Altersklasse (z. B. wC1 und wC2). Namen erfunden.
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { sendGameReminders } from "../worker/cron";
import type { PushJob } from "../worker/domain/notify";
import { api, eventIn, exec, freshDb, loginAs, member, person, rows, season, team } from "./helpers";

let wc1: number;
let wc2: number;
let wd: number;
let wb: number;
let coach1: number;
let coach2: number;
let lina: number; // wC2
let nora: number; // wD
let ruth: number; // wB, passt nicht
let coachCookie: string;

beforeEach(async () => {
  await freshDb();
  await season();
  wc1 = await team("wC1", "wC");
  wc2 = await team("wC2", "wC", { level: 2 });
  wd = await team("wD", "wD");
  wb = await team("wB", "wB");
  coach1 = await person("Tina");
  coach2 = await person("Uwe");
  lina = await person("Lina", { birthYear: 2013 });
  nora = await person("Nora", { birthYear: 2014 });
  ruth = await person("Ruth", { birthYear: 2011 });
  await member(coach1, wc1, "coach");
  await member(coach2, wc2, "coach");
  await member(lina, wc2);
  await member(nora, wd);
  await member(ruth, wb);
  coachCookie = await loginAs(coach1);
});

describe("Spieler aus einer anderen Mannschaft aufnehmen", () => {
  it("Kandidaten: gleiche Altersklasse jeder Stufe und die nächstjüngere, nicht ältere", async () => {
    const res = await api(`/teams/${wc1}/player-candidates`, { cookie: coachCookie });
    expect(res.status).toBe(200);
    expect(res.body.candidates.map((c: any) => [c.person.id, c.teams])).toEqual([
      [lina, "wC2"],
      [nora, "wD"],
    ]);
    // Fremde Trainer dürfen nicht
    expect((await api(`/teams/${wc1}/player-candidates`, { cookie: await loginAs(coach2) })).status).toBe(403);
  });

  it("Trainer nimmt eine Spielerin der 2. Mannschaft auf, sie spielt dann in beiden", async () => {
    expect((await api(`/teams/${wc1}/players/existing`, { cookie: coachCookie, body: { personId: ruth } })).status).toBe(400);
    expect((await api(`/teams/${wc1}/players/existing`, { cookie: coachCookie, body: { personId: lina } })).status).toBe(201);
    const teamsOf = (await rows<{ team_id: number }>("SELECT team_id FROM team_memberships WHERE person_id = ? AND role = 'player' ORDER BY team_id", lina)).map(
      (r) => r.team_id,
    );
    expect(teamsOf).toEqual([wc1, wc2]);
    // Sie sieht die Termine beider Mannschaften
    await eventIn(wc1, 2, { kind: "game" });
    await eventIn(wc2, 3, { kind: "game" });
    const events = (await api("/events", { cookie: await loginAs(lina) })).body.events.filter((e: any) => e.kind === "game");
    expect(events.length).toBe(2);
    // Danach ist sie kein Kandidat mehr
    expect((await api(`/teams/${wc1}/player-candidates`, { cookie: coachCookie })).body.candidates.map((c: any) => c.person.id)).toEqual([nora]);
  });

  it("eine dauerhafte Aushilfe wird zur Spielerin", async () => {
    await member(lina, wc1, "helper");
    expect((await api(`/teams/${wc1}/players/existing`, { cookie: coachCookie, body: { personId: lina } })).status).toBe(201);
    expect(await rows("SELECT role FROM team_memberships WHERE person_id = ? AND team_id = ?", lina, wc1)).toEqual([{ role: "player" }]);
  });

  it("Aushilfe-Kandidaten erscheinen einmal je Person mit allen Mannschaften", async () => {
    const wb1 = await team("wB1", "wB", { level: 1 });
    await member(lina, wc1);
    const coachB = await person("Vera");
    await member(coachB, wb1, "coach");
    const res = await api(`/teams/${wb1}/helper-candidates`, { cookie: await loginAs(coachB) });
    const linaRows = res.body.candidates.filter((c: any) => c.person.id === lina);
    expect(linaRows).toHaveLength(1);
    expect(linaRows[0].team.name).toBe("wC1 · wC2");
  });
});

describe("Zeitgleiche Spiele beider Mannschaften", () => {
  it("eine Kader-Erinnerung, der Überschneidungshinweis nennt die andere Mannschaft", async () => {
    await member(lina, wc1);
    const g1 = await eventIn(wc1, 2, { kind: "game", time: "11:00" });
    const g2 = await eventIn(wc2, 2, { kind: "game", time: "12:00" });
    await exec("INSERT INTO nominations (event_id, person_id) VALUES (?, ?), (?, ?)", g1, lina, g2, lina);
    await exec("UPDATE events SET squad_published_at = '2026-01-01T00:00:00Z' WHERE id IN (?, ?)", g1, g2);

    const squad = await api(`/events/${g1}/squad`, { cookie: coachCookie });
    expect(squad.body.candidates.find((c: any) => c.person.id === lina).conflict).toBe("Zur selben Zeit für wC2 (12:00 Uhr) nominiert");

    const linaCookie = await loginAs(lina);
    expect(linaCookie).toBeTruthy();
    await exec("INSERT INTO push_subscriptions (account_id, endpoint, p256dh, auth) SELECT id, 'https://push.example/' || id, 'k', 'a' FROM accounts");
    const pushes: PushJob[] = [];
    const testEnv = { ...env, PUSH_QUEUE: { sendBatch: async (jobs: { body: PushJob }[]) => void pushes.push(...jobs.map((j) => j.body)) } } as unknown as Env;
    await sendGameReminders(testEnv);
    const account = (await rows<{ id: number }>("SELECT id FROM accounts WHERE person_id = ?", lina))[0]!.id;
    const forLina = pushes.filter((p) => p.payload.title === "Du bist im Kader" && p.accountIds.includes(account));
    expect(forLina).toHaveLength(1);
    expect((await rows("SELECT id FROM events WHERE game_reminder_sent_at IS NOT NULL")).length).toBe(2);
  });
});
