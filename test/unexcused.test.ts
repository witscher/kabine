// „Fehlt unentschuldigt“ über die alte Route, die für zwischengespeicherte App-Versionen bleibt (jetzt attendance_marks). Namen erfunden.
import { beforeEach, describe, expect, it } from "vitest";
import { api, eventIn, exec, freshDb, guardian, loginAs, member, person, rows, season, team } from "./helpers";

let wd: number;
let we: number;
let coach: number;
let otherCoach: number;
let mia: number;
let ella: number;
let parent: number;
let past: number;
let coachCookie: string;

beforeEach(async () => {
  await freshDb();
  await season();
  wd = await team("wD", "wD");
  we = await team("wE", "wE");
  await exec("UPDATE teams SET parents_enabled = 1 WHERE id = ?", wd);
  coach = await person("Tina");
  otherCoach = await person("Uwe");
  mia = await person("Mia", { birthYear: 2014 });
  ella = await person("Ella", { birthYear: 2014 });
  parent = await person("Paula");
  await member(coach, wd, "coach");
  await member(otherCoach, we, "coach");
  await member(mia, wd);
  await member(ella, wd);
  await guardian(parent, mia);
  // Trainer tragen bis zum Ende des Folgetags ein
  past = await eventIn(wd, -1);
  coachCookie = await loginAs(coach);
});

const mark = (event: number, personId: number, unexcused: boolean, cookie: string) =>
  api(`/events/${event}/unexcused/${personId}`, { method: "PUT", cookie, body: { unexcused } });

describe("fehlt unentschuldigt", () => {
  it("Trainer markiert und nimmt die Markierung zurück", async () => {
    expect((await mark(past, mia, true, coachCookie)).status).toBe(200);
    // Doppelt markieren schadet nicht
    expect((await mark(past, mia, true, coachCookie)).status).toBe(200);
    expect(await rows("SELECT person_id, status, marked_by FROM attendance_marks")).toEqual([{ person_id: mia, status: "unexcused", marked_by: coach }]);
    const detail = (await api(`/events/${past}`, { cookie: coachCookie })).body;
    expect(detail.participants.find((p: any) => p.person.id === mia).unexcused).toBe(true);
    expect(detail.participants.find((p: any) => p.person.id === ella).unexcused).toBe(false);
    expect((await mark(past, mia, false, coachCookie)).status).toBe(200);
    expect(await rows("SELECT * FROM attendance_marks")).toEqual([]);
  });

  it("nur Trainer der Mannschaft und Admins", async () => {
    expect((await mark(past, mia, true, await loginAs(mia))).status).toBe(403);
    expect((await mark(past, mia, true, await loginAs(parent))).status).toBe(403);
    // Trainer einer anderen Mannschaft
    expect((await mark(past, mia, true, await loginAs(otherCoach))).status).toBe(403);
    const admin = await person("Anna", { admin: true });
    expect((await mark(past, mia, true, await loginAs(admin))).status).toBe(200);
  });

  it("erst nach Beginn, nicht bei Absage, abgesagtem Termin oder Fremden", async () => {
    const future = await eventIn(wd, 2);
    expect((await mark(future, mia, true, coachCookie)).status).toBe(409);
    await exec("INSERT INTO responses (event_id, person_id, status, reason, responded_at) VALUES (?, ?, 'no', 'krank', '2026-01-01T00:00:00Z')", past, ella);
    expect((await mark(past, ella, true, coachCookie)).status).toBe(409);
    const stranger = await person("Zoe");
    expect((await mark(past, stranger, true, coachCookie)).status).toBe(404);
    const cancelled = await eventIn(wd, -1, { time: "10:00" });
    await exec("UPDATE events SET cancelled_at = '2026-01-01T00:00:00Z' WHERE id = ?", cancelled);
    expect((await mark(cancelled, mia, true, coachCookie)).status).toBe(409);
  });

  it("sichtbar für die Person und ihre Eltern, nicht für andere Spieler", async () => {
    await mark(past, mia, true, coachCookie);
    const own = (await api(`/events/${past}`, { cookie: await loginAs(mia) })).body;
    expect(own.mine.find((m: any) => m.person.id === mia).unexcused).toBe(true);
    expect(own.participants).toBeFalsy();
    const byParent = (await api(`/events/${past}`, { cookie: await loginAs(parent) })).body;
    expect(byParent.mine.find((m: any) => m.person.id === mia).unexcused).toBe(true);
    const other = (await api(`/events/${past}`, { cookie: await loginAs(ella) })).body;
    expect(JSON.stringify(other)).not.toContain('"unexcused":true');
  });

  it("vergangene Termine in der Übersicht und Zähler pro Spieler", async () => {
    const older = await eventIn(wd, -9);
    await eventIn(wd, 3);
    await eventIn(we, -1);
    await mark(past, mia, true, coachCookie);
    // Älter als der Folgetag: nur noch Admins
    expect((await mark(older, mia, true, coachCookie)).body.error.code).toBe("attendance_closed");
    const adminCookie = await loginAs(await person("Anna", { admin: true }));
    await mark(older, mia, true, adminCookie);
    await mark(older, ella, true, adminCookie);
    const res = await api("/events?past=1", { cookie: coachCookie });
    expect(res.status).toBe(200);
    // Neueste zuerst, nur Vergangenes, Zahl der Markierungen nur für Trainer
    expect(res.body.events.map((e: any) => [e.id, e.unexcusedCount])).toEqual([
      [past, 1],
      [older, 2],
    ]);
    const asPlayer = (await api("/events?past=1", { cookie: await loginAs(mia) })).body.events;
    expect(asPlayer.map((e: any) => [e.id, e.unexcusedCount, e.mine[0].unexcused])).toEqual([
      [past, 0, true],
      [older, 0, true],
    ]);
    const asElla = (await api("/events?past=1", { cookie: await loginAs(ella) })).body.events;
    expect(asElla.map((e: any) => e.unexcusedCount)).toEqual([0, 0]);
    expect((await api(`/events?past=1&teamId=${we}`, { cookie: coachCookie })).body.events).toEqual([]);
    const teamDetail = (await api(`/teams/${wd}`, { cookie: coachCookie })).body;
    expect(teamDetail.players.map((p: any) => [p.person.id, p.unexcused])).toEqual(
      expect.arrayContaining([
        [mia, 2],
        [ella, 1],
      ]),
    );
  });

  it("verschwindet mit dem Termin", async () => {
    await mark(past, mia, true, coachCookie);
    await exec("DELETE FROM events WHERE id = ?", past);
    expect(await rows("SELECT * FROM attendance_marks")).toEqual([]);
  });
});
