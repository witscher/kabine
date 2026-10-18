// Automatischer Kader aus dem Stammkader und Erinnerung vor dem Spiel.
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { sendGameReminders } from "../worker/cron";
import { syncAutoSquads } from "../worker/domain/auto-squad";
import { api, eventIn, exec, freshDb, loginAs, member, one, person, rows, season, team } from "./helpers";

let wd: number;
let coach: number;
let alice: number;
let bea: number;
let cleo: number;
let coachCookie: string;

async function nominated(eventId: number): Promise<number[]> {
  return (await rows<{ person_id: number }>("SELECT person_id FROM nominations WHERE event_id = ? ORDER BY person_id", eventId)).map((r) => r.person_id);
}

beforeEach(async () => {
  await freshDb();
  await season();
  wd = await team("wD", "wD");
  coach = await person("Trainerin");
  alice = await person("Alice", { birthYear: 2014 });
  bea = await person("Bea", { birthYear: 2015 });
  cleo = await person("Cleo", { birthYear: 2015 });
  await member(coach, wd, "coach");
  for (const p of [alice, bea, cleo]) await member(p, wd);
  coachCookie = await loginAs(coach);
});

describe("Automatischer Kader", () => {
  it("nominiert den Stammkader für alle künftigen Spiele und folgt Änderungen", async () => {
    const game = await eventIn(wd, 6, { kind: "game" });
    const past = await eventIn(wd, -2, { kind: "game" });
    await api(`/teams/${wd}/core-squad`, { method: "PUT", cookie: coachCookie, body: { personIds: [alice, bea] } });
    // Ausgeschaltet: niemand nominiert
    expect(await nominated(game)).toEqual([]);

    expect((await api(`/teams/${wd}`, { method: "PATCH", cookie: coachCookie, body: { autoSquad: true } })).status).toBe(200);
    expect(await nominated(game)).toEqual([alice, bea]);
    expect(await nominated(past)).toEqual([]);
    // Alice sieht das Spiel als zugesagt, ohne dass der Trainer etwas veröffentlicht hat
    expect((await api(`/events/${game}`, { cookie: await loginAs(alice) })).body.mine[0]).toMatchObject({ nominated: true, status: "yes" });

    // Bea sagt ab und fällt dann aus dem Stammkader, Cleo kommt dazu
    await api(`/events/${game}/responses`, { cookie: await loginAs(bea), body: { personId: bea, status: "no", reason: "Schule" } });
    await api(`/teams/${wd}/core-squad`, { method: "PUT", cookie: coachCookie, body: { personIds: [alice, cleo] } });
    expect(await nominated(game)).toEqual([alice, cleo]);
    expect(await rows("SELECT * FROM responses WHERE event_id = ? AND person_id = ?", game, bea)).toEqual([]);

    // Neue Spiele (z. B. aus dem Import) bekommen den Stammkader beim nächsten Abgleich
    const later = await eventIn(wd, 13, { kind: "game" });
    await syncAutoSquads(env.DB, null);
    expect(await nominated(later)).toEqual([alice, cleo]);
  });

  it("dauerhafte Aushilfen gehören zum Stammkader und werden automatisch nominiert", async () => {
    const we = await team("wE", "wE");
    const ella = await person("Ella", { birthYear: 2016 });
    await member(ella, we);
    await member(ella, wd, "helper");
    const game = await eventIn(wd, 6, { kind: "game" });
    expect((await api(`/teams/${wd}/core-squad`, { method: "PUT", cookie: coachCookie, body: { personIds: [alice, ella] } })).status).toBe(200);
    const detail = (await api(`/teams/${wd}`, { cookie: coachCookie })).body;
    expect(detail.helpers.find((h: any) => h.person.id === ella).isCore).toBe(true);
    await api(`/teams/${wd}`, { method: "PATCH", cookie: coachCookie, body: { autoSquad: true } });
    expect(await nominated(game)).toEqual([alice, ella]);
    // Als Aushilfe entfernt: auch aus dem Stammkader und dem automatischen Kader
    await api(`/teams/${wd}/members/${ella}?role=helper`, { method: "DELETE", cookie: coachCookie });
    expect(await rows("SELECT person_id FROM core_squad WHERE team_id = ?", wd)).toEqual([{ person_id: alice }]);
    expect(await nominated(game)).toEqual([alice]);
  });

  it("Inaktive fallen heraus und kommen nach Reaktivierung zurück", async () => {
    const game = await eventIn(wd, 6, { kind: "game" });
    await api(`/teams/${wd}/core-squad`, { method: "PUT", cookie: coachCookie, body: { personIds: [alice, bea] } });
    await api(`/teams/${wd}`, { method: "PATCH", cookie: coachCookie, body: { autoSquad: true } });
    await api(`/persons/${bea}/active`, { cookie: coachCookie, body: { active: false } });
    expect(await nominated(game)).toEqual([alice]);
    await api(`/persons/${bea}/active`, { cookie: coachCookie, body: { active: true } });
    expect(await nominated(game)).toEqual([alice, bea]);
  });

  it("ein von Hand bearbeiteter Kader bleibt, bis der Trainer zur Automatik zurückkehrt", async () => {
    const game = await eventIn(wd, 6, { kind: "game" });
    await api(`/teams/${wd}/core-squad`, { method: "PUT", cookie: coachCookie, body: { personIds: [alice, bea] } });
    await api(`/teams/${wd}`, { method: "PATCH", cookie: coachCookie, body: { autoSquad: true } });
    expect((await api(`/events/${game}/squad`, { cookie: coachCookie })).body).toMatchObject({ automatic: true });

    await api(`/events/${game}/squad`, { method: "PUT", cookie: coachCookie, body: { personIds: [alice, bea, cleo] } });
    await api(`/teams/${wd}/core-squad`, { method: "PUT", cookie: coachCookie, body: { personIds: [alice] } });
    expect(await nominated(game)).toEqual([alice, bea, cleo]);
    expect((await api(`/events/${game}/squad`, { cookie: coachCookie })).body).toMatchObject({ automatic: false });

    expect((await api(`/events/${game}/squad/auto`, { cookie: coachCookie, body: {} })).status).toBe(200);
    expect(await nominated(game)).toEqual([alice]);
  });

  it("Kadergröße: neuer Standard 20", async () => {
    const created = await api("/teams", { cookie: await loginAs(await person("Ada", { admin: true })), body: { name: "mA", ageClassCode: "wD", level: 1 } });
    expect(await one<{ max_squad: number }>("SELECT max_squad FROM teams WHERE id = ?", created.body.id)).toEqual({ max_squad: 20 });
  });
});

describe("Erinnerung vor dem Spiel", () => {
  it("einmal, wenn das Spiel in den nächsten drei Tagen liegt und der Kader steht", async () => {
    const soon = await eventIn(wd, 2, { kind: "game" });
    const later = await eventIn(wd, 6, { kind: "game" });
    const noSquad = await eventIn(wd, 1, { kind: "game" });
    await exec("UPDATE events SET squad_published_at = '2026-01-01T00:00:00Z' WHERE id IN (?, ?)", soon, later);
    await sendGameReminders(env);
    const marked = (await rows<{ id: number }>("SELECT id FROM events WHERE game_reminder_sent_at IS NOT NULL")).map((r) => r.id);
    expect(marked).toEqual([soon]);
    expect(marked).not.toContain(noSquad);
  });

  it("wartet bei einem gerade von Hand veröffentlichten Kader 24 Stunden", async () => {
    const soon = await eventIn(wd, 2, { kind: "game" });
    await api(`/events/${soon}/squad`, { method: "PUT", cookie: coachCookie, body: { personIds: [alice] } });
    await sendGameReminders(env);
    expect(await rows("SELECT id FROM events WHERE game_reminder_sent_at IS NOT NULL")).toEqual([]);
    await sendGameReminders(env, Date.now() + 25 * 3_600_000);
    expect((await rows("SELECT id FROM events WHERE game_reminder_sent_at IS NOT NULL")).length).toBe(1);
  });
});
