// Persönlicher Kalender (Profil → Meine Termine). Namen erfunden.
import { exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { api, eventIn, exec, freshDb, guardian, loginAs, member, one, person, season, team } from "./helpers";

let wd: number;
let coach: number;
let mia: number;
let ella: number;
let paula: number;
let training: number;
let home: number;
let away: number;

beforeEach(async () => {
  await freshDb();
  await season();
  wd = await team("wD", "wD");
  coach = await person("Tina");
  mia = await person("Mia", { birthYear: 2014 });
  ella = await person("Ella", { birthYear: 2014 });
  paula = await person("Paula");
  await member(coach, wd, "coach");
  await member(mia, wd);
  await member(ella, wd);
  await guardian(paula, mia);
  await guardian(paula, ella);

  training = await eventIn(wd, 2);
  home = await eventIn(wd, 3, { kind: "game", time: "18:00" });
  away = await eventIn(wd, 4, { kind: "game", time: "18:00" });
  await exec(
    "UPDATE events SET is_home = 1, home_team = 'SV Musterstadt', guest_team = 'TSV Testdorf', meeting_time = '17:15', meeting_point = 'Eingang Halle' WHERE id = ?",
    home,
  );
  await exec("UPDATE events SET is_home = 0, home_team = 'SG Beispielstadt', guest_team = 'SV Musterstadt', meeting_time = '16:30' WHERE id = ?", away);
  await exec("INSERT INTO nominations (event_id, person_id) VALUES (?, ?), (?, ?)", home, mia, home, ella);
  await exec("INSERT INTO responses (event_id, person_id, status, reason, responded_at) VALUES (?, ?, 'no', 'Zahnarzt', '2026-01-01T00:00:00Z')", training, mia);
});

async function feed(personId: number, prefs?: { training: boolean; games: boolean; duties: boolean }) {
  const cookie = await loginAs(personId);
  const { url } = (await api("/profile/calendar-token", { cookie, body: prefs ?? {} })).body;
  const res = await exports.default.fetch(new Request(`http://localhost:5173${new URL(url).pathname}`));
  expect(res.status).toBe(200);
  const ics = await res.text();
  return { ics, summaries: [...ics.matchAll(/^SUMMARY:(.*)$/gm)].map((m) => m[1]!.trim().replace(/\\,/g, ",")), cookie, url };
}

describe("Persönlicher Kalender", () => {
  it("Spielerin: Training, alle Spiele, nominiert und abgesagt im Titel, Treffpunkt nur bei Nominierung", async () => {
    const { ics, summaries } = await feed(mia);
    expect(summaries).toEqual([
      "Training wD · abgesagt",
      "Treffpunkt wD · Spiel gegen TSV Testdorf",
      "Spiel wD gegen TSV Testdorf · nominiert",
      "Spiel wD bei SG Beispielstadt",
    ]);
    expect(ics).toMatch(/DTSTART;TZID=Europe\/Berlin:\d{8}T171500/);
    expect(ics).toContain("LOCATION:Eingang Halle");
    // Keine Absagegründe und keine anderen Personen
    expect(ics).not.toContain("Zahnarzt");
    expect(ics).not.toContain("Ella");
  });

  it("Elternteil: Kinder mit Vornamen, Treffpunkt für nominierte Kinder", async () => {
    const { summaries } = await feed(paula);
    expect(summaries).toEqual([
      "Training wD · Ella dabei, Mia abgesagt",
      "Treffpunkt wD · Spiel gegen TSV Testdorf",
      "Spiel wD gegen TSV Testdorf · Ella und Mia nominiert",
      "Spiel wD bei SG Beispielstadt · Ella und Mia",
    ]);
  });

  it("Elternteil: unterschiedlicher Stand der Kinder bleibt eindeutig", async () => {
    await exec("DELETE FROM nominations WHERE event_id = ? AND person_id = ?", home, mia);
    const { summaries } = await feed(paula);
    expect(summaries).toContain("Spiel wD gegen TSV Testdorf · Ella nominiert, Mia nicht nominiert");
  });

  it("Trainer: Treffpunkt auch ohne Nominierung, vom Trainer abgesagter Termin", async () => {
    await exec("UPDATE events SET cancelled_at = '2026-01-01T00:00:00Z' WHERE id = ?", training);
    const { ics, summaries } = await feed(coach);
    expect(summaries).toEqual([
      "Abgesagt: Training wD",
      "Treffpunkt wD · Spiel gegen TSV Testdorf",
      "Spiel wD gegen TSV Testdorf",
      "Treffpunkt wD · Spiel bei SG Beispielstadt",
      "Spiel wD bei SG Beispielstadt",
    ]);
    expect(ics).toContain("STATUS:CANCELLED");
  });

  it("Häkchen filtern und lassen sich ändern", async () => {
    const { cookie, url } = await feed(mia, { training: true, games: false, duties: false });
    const path = new URL(url).pathname;
    const read = async () => [...(await (await exports.default.fetch(new Request(`http://localhost:5173${path}`))).text()).matchAll(/^SUMMARY:(.*)$/gm)].map((m) => m[1]!.trim());
    expect(await read()).toEqual(["Training wD · abgesagt"]);
    expect((await api("/profile/calendar", { method: "PUT", cookie, body: { training: false, games: true, duties: false } })).status).toBe(200);
    expect((await api("/profile/calendar", { cookie })).body).toEqual({ hasCalendar: true, training: false, games: true, duties: false });
    expect((await read()).every((s) => !s.startsWith("Training"))).toBe(true);
  });

  it("Helferdienst mit der Zeit seines Blocks", async () => {
    await exec("UPDATE teams SET helper_plan = 1 WHERE id = ?", wd);
    await exec("UPDATE events SET ends_at = substr(starts_at, 1, 11) || '19:30' WHERE id = ?", home);
    const block = await one<{ id: number }>(
      "INSERT INTO event_duties (event_id, duty_type_id, starts_at, ends_at, slots) SELECT id, 1, starts_at, strftime('%Y-%m-%dT%H:%M', starts_at, '+45 minutes'), 2 FROM events WHERE id = ? RETURNING id",
      home,
    );
    await exec("UPDATE events SET duties_generated = 3, duties_anchor = starts_at WHERE id = ?", home);
    await exec("INSERT INTO duties (event_id, event_duty_id, duty_type_id, person_id, child_id) VALUES (?, ?, 1, ?, ?)", home, block.id, paula, mia);
    const { ics } = await feed(paula);
    const blocks = ics.split("BEGIN:VEVENT").slice(1);
    const game = blocks.find((b) => b.includes(`UID:event-${home}@`))!;
    const duty = blocks.find((b) => b.includes("SUMMARY:Helferdienst"))!;
    expect(game).toContain("DURATION:PT90M");
    expect(duty).toContain("DURATION:PT45M");
    expect(duty).toContain("für Mia");
  });

  it("ohne Link: Standard alles an, Ändern geht erst mit Link", async () => {
    const cookie = await loginAs(mia);
    expect((await api("/profile/calendar", { cookie })).body).toEqual({ hasCalendar: false, training: true, games: true, duties: true });
    expect((await api("/profile/calendar", { method: "PUT", cookie, body: { training: true, games: true, duties: true } })).status).toBe(404);
  });

  it("Eltern ohne Eltern-Einbindung sehen die Termine des Kindes nicht", async () => {
    await exec("UPDATE teams SET parents_enabled = 0 WHERE id = ?", wd);
    const { summaries } = await feed(paula);
    expect(summaries).toEqual([]);
  });
});
