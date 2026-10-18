// Team staff (physio, manager): see everything of the team, take no part. Invented names.
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { staffOf } from "../worker/domain/notify";
import { api, eventIn, exec, freshDb, loginAs, member, person, season, team } from "./helpers";

let wd: number;
let coach: number;
let kim: number;
let coachCookie: string;

beforeEach(async () => {
  await freshDb();
  await season();
  wd = await team("wD", "wD");
  coach = await person("Theo");
  kim = await person("Kim", { lastName: "Muster" });
  await member(coach, wd, "coach");
  await member(kim, wd);
  coachCookie = await loginAs(coach);
});

async function addStaff(): Promise<number> {
  const res = await api(`/teams/${wd}/staff`, { cookie: coachCookie, body: { firstName: "Pia", lastName: "Physio" } });
  expect(res.status).toBe(201);
  return res.body.id;
}

describe("Betreuer", () => {
  it("Trainer legt an, Mannschaft zeigt sie getrennt vom Kader, nur Trainer dürfen", async () => {
    expect((await api(`/teams/${wd}/staff`, { cookie: await loginAs(kim), body: { firstName: "X" } })).status).toBe(403);
    const pia = await addStaff();
    const detail = (await api(`/teams/${wd}`, { cookie: coachCookie })).body;
    expect(detail.staff).toEqual([{ person: { id: pia, firstName: "Pia", lastName: "Physio" }, hasAccount: false, hasPush: false }]);
    expect(detail.players.map((p: { person: { id: number } }) => p.person.id)).toEqual([kim]);
    expect((await api(`/teams/${wd}/members/${pia}?role=staff`, { method: "DELETE", cookie: coachCookie })).status).toBe(200);
    expect((await api(`/teams/${wd}`, { cookie: coachCookie })).body.staff).toEqual([]);
  });

  it("sehen Termine mit Namen und Status, ohne Gründe, und sagen nicht selbst zu", async () => {
    const pia = await addStaff();
    const ev = await eventIn(wd, 3);
    await api(`/events/${ev}/responses`, { cookie: await loginAs(kim), body: { personId: kim, status: "no", reason: "Zahnarzt" } });
    const cookie = await loginAs(pia);

    const list = await api("/events", { cookie });
    const row = list.body.events.find((e: { id: number }) => e.id === ev);
    expect(row).toMatchObject({ staff: true, canManage: false, mine: [] });

    const detail = (await api(`/events/${ev}`, { cookie })).body;
    expect(detail.participants).toBeNull();
    expect(detail.roster).toEqual([{ personId: kim, name: "Kim M.", status: "no" }]);
    expect(JSON.stringify(detail)).not.toContain("Zahnarzt");

    expect((await api(`/events/${ev}/responses`, { cookie, body: { personId: pia, status: "yes" } })).status).toBeGreaterThanOrEqual(400);
    // Nicht unter den Teilnehmern beim Trainer
    const forCoach = (await api(`/events/${ev}`, { cookie: coachCookie })).body;
    expect(forCoach.participants.map((p: { person: { id: number } }) => p.person.id)).toEqual([kim]);
  });

  it("Spiele erst mit veröffentlichtem Kader namentlich", async () => {
    const pia = await addStaff();
    const game = await eventIn(wd, 4, { kind: "game", title: "Spiel" });
    await exec("INSERT INTO nominations (event_id, person_id) VALUES (?, ?)", game, kim);
    const cookie = await loginAs(pia);
    expect((await api(`/events/${game}`, { cookie })).body.roster).toBeNull();
    await exec("UPDATE events SET squad_published_at = '2026-01-01T00:00:00Z' WHERE id = ?", game);
    expect((await api(`/events/${game}`, { cookie })).body.roster).toEqual([{ personId: kim, name: "Kim M.", status: "yes" }]);
  });

  it("im Mannschaftschat mit eigener Rolle, bekommen Änderungen der Mannschaft", async () => {
    const pia = await addStaff();
    const rooms = (await api("/chat/rooms", { cookie: await loginAs(pia) })).body.rooms;
    expect(rooms).toEqual([expect.objectContaining({ teamId: wd, canRead: true, canWrite: true, role: "staff" })]);
    expect(await staffOf(env.DB, [wd])).toEqual([pia]);
  });
});
