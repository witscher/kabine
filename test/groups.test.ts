// Gruppen: nur Chat und Sondertermine, Jugendschiedsrichter-Gruppe folgt der Rolle. Namen erfunden.
import { addDays, todayLocal } from "../worker/lib/time";
import { beforeEach, describe, expect, it } from "vitest";
import { api, freshDb, loginAs, member, one, person, rows, season, team } from "./helpers";

let wd: number;
let admin: number;
let coach: number;
let alma: number;
let kira: number;
let adminCookie: string;

beforeEach(async () => {
  await freshDb();
  await season();
  wd = await team("wD", "wD");
  admin = await person("Ada", { admin: true });
  coach = await person("Coachy");
  alma = await person("Alma", { birthYear: 2014 });
  kira = await person("Kira", { birthYear: 2010 });
  await member(coach, wd, "coach");
  await member(alma, wd);
  adminCookie = await loginAs(admin);
});

async function createGroup(name: string, autoMembers: "referees" | null = null): Promise<number> {
  const res = await api("/groups", { cookie: adminCookie, body: { name, autoMembers } });
  expect(res.status).toBe(201);
  return res.body.id;
}

describe("Gruppen", () => {
  it("nur Admins legen Gruppen an; sie erscheinen als Gruppe in Liste, Sitzung und Chat", async () => {
    expect((await api("/groups", { cookie: await loginAs(coach), body: { name: "JT" } })).status).toBe(403);
    const jt = await createGroup("JT");
    expect((await api("/groups", { cookie: adminCookie, body: { name: "wD" } })).status).toBe(409);
    const list = await api("/teams", { cookie: adminCookie });
    expect(list.body.teams.find((t: any) => t.id === jt)).toMatchObject({ kind: "group", autoMembers: null });
    expect(list.body.teams.find((t: any) => t.id === wd)).toMatchObject({ kind: "team" });

    expect((await api(`/teams/${jt}/members`, { cookie: adminCookie, body: { personId: coach, role: "player" } })).status).toBe(201);
    const coachCookie = await loginAs(coach);
    const session = await api("/session", { cookie: coachCookie });
    expect(session.body.me.groupIds).toEqual([jt]);
    const rooms = await api("/chat/rooms", { cookie: coachCookie });
    expect(rooms.body.rooms.find((r: any) => r.teamId === jt)).toMatchObject({ isGroup: true, canWrite: true });
    expect(rooms.body.rooms.find((r: any) => r.teamId === wd)).toMatchObject({ isGroup: false });
  });

  it("Training, Spiele, Kader und Einladungen gibt es nicht für Gruppen", async () => {
    const jt = await createGroup("JT");
    const date = addDays(todayLocal(), 10);
    const plan = await api(`/teams/${jt}/plans`, {
      cookie: adminCookie,
      body: { name: "Plan", kind: "regular", validFrom: date, validTo: addDays(date, 30), rules: [] },
    });
    expect(plan.status).toBe(400);
    expect(plan.body.error?.code).toBe("group_not_supported");
    const game = await api(`/duties/teams/${jt}/games`, {
      cookie: adminCookie,
      body: { opponent: "SG Test", isHome: true, date, time: "11:00", locationId: null },
    });
    expect(game.status).toBe(400);
    expect((await api(`/teams/${jt}/invites`, { cookie: adminCookie, body: { kind: "player" } })).body.error?.code).toBe("group_not_supported");
    expect((await api(`/teams/${jt}/players`, { cookie: adminCookie, body: { firstName: "Neu" } })).body.error?.code).toBe("group_not_supported");
    expect((await api(`/teams/${jt}`, { method: "PATCH", cookie: adminCookie, body: { helperPlan: true } })).body.error?.code).toBe("group_not_supported");
    // Umbenennen und Rückmeldungen sichtbar gehen
    expect((await api(`/teams/${jt}`, { method: "PATCH", cookie: adminCookie, body: { name: "Trainerteam", showResponses: true } })).status).toBe(200);
    // Training anderer Mannschaften lässt sich nicht mit einer Gruppe teilen
    const plans = await api(`/teams/${wd}/plans`, { cookie: adminCookie });
    expect(plans.body.allTeams.map((t: any) => t.id)).not.toContain(jt);
  });

  it("Sondertermine der Gruppe sehen die Mitglieder und sagen zu oder ab", async () => {
    const jt = await createGroup("JT");
    await api(`/teams/${jt}/members`, { cookie: adminCookie, body: { personId: coach, role: "player" } });
    await api(`/teams/${jt}/members`, { cookie: adminCookie, body: { personId: admin, role: "coach" } });
    const startsAt = `${addDays(todayLocal(), 5)}T19:00`;
    const created = await api("/events", { cookie: adminCookie, body: { title: "Trainersitzung", startsAt, teamIds: [jt] } });
    expect(created.status).toBe(201);
    const coachCookie = await loginAs(coach);
    const events = await api("/events", { cookie: coachCookie });
    expect(events.body.events.some((e: any) => e.title === "Trainersitzung")).toBe(true);
    // Alma ist nicht in der Gruppe
    const almaEvents = await api("/events", { cookie: await loginAs(alma) });
    expect(almaEvents.body.events.some((e: any) => e.title === "Trainersitzung")).toBe(false);
    const res = await api(`/events/${created.body.id}/responses`, { cookie: coachCookie, body: { personId: coach, status: "yes" } });
    expect(res.status).toBe(200);
  });

  it("Löschen einer Gruppe nimmt die Zuordnungen mit, die Personen bleiben", async () => {
    const jt = await createGroup("JT");
    await api(`/teams/${jt}/members`, { cookie: adminCookie, body: { personId: coach, role: "player" } });
    expect((await api(`/teams/${jt}`, { method: "DELETE", cookie: adminCookie })).status).toBe(200);
    expect((await rows("SELECT * FROM teams WHERE id = ?", jt)).length).toBe(0);
    expect((await rows("SELECT * FROM persons WHERE id = ?", coach)).length).toBe(1);
    // Mannschaften mit Mitgliedern lassen sich weiter nicht löschen
    expect((await api(`/teams/${wd}`, { method: "DELETE", cookie: adminCookie })).status).toBe(409);
  });

  it("Jugendschiedsrichter-Gruppe folgt der Rolle, Admins sind Verantwortliche", async () => {
    await api(`/admin/referees/${kira}`, { method: "PUT", cookie: adminCookie });
    const g = await createGroup("Jugendschiedsrichter", "referees");
    const members = async () =>
      (await rows<{ person_id: number; role: string }>("SELECT person_id, role FROM team_memberships WHERE team_id = ? ORDER BY role, person_id", g)).map(
        (r) => `${r.role}:${r.person_id}`,
      );
    expect(await members()).toEqual([`coach:${admin}`, `player:${kira}`]);

    await api(`/admin/referees/${alma}`, { method: "PUT", cookie: adminCookie });
    expect(await members()).toEqual([`coach:${admin}`, `player:${alma}`, `player:${kira}`]);
    await api(`/admin/referees/${kira}`, { method: "DELETE", cookie: adminCookie });
    expect(await members()).toEqual([`coach:${admin}`, `player:${alma}`]);

    // Neuer Admin wird Verantwortlicher, entzogene Rechte nehmen ihn wieder heraus
    await api(`/admin/persons/${coach}`, { method: "PATCH", cookie: adminCookie, body: { isAdmin: true, adminEmail: "coachy@example.org" } });
    expect(await members()).toContain(`coach:${coach}`);
    await api(`/admin/persons/${coach}`, { method: "PATCH", cookie: adminCookie, body: { isAdmin: false } });
    expect(await members()).not.toContain(`coach:${coach}`);

    // Von Hand lässt sich nichts zuordnen
    const manual = await api(`/teams/${g}/members`, { cookie: adminCookie, body: { personId: coach, role: "player" } });
    expect(manual.body.error?.code).toBe("auto_members");
    // Chat: Admin moderiert als Verantwortlicher
    const rooms = await api("/chat/rooms", { cookie: adminCookie });
    expect(rooms.body.rooms.find((r: any) => r.teamId === g)).toMatchObject({ isGroup: true, isMod: true, adminOnly: false });
  });

  it("Saisonwechsel lässt Gruppen und ihre Mitglieder stehen und zeigt sie nicht in der Zuordnung", async () => {
    const jt = await createGroup("JT");
    await api(`/teams/${jt}/members`, { cookie: adminCookie, body: { personId: coach, role: "player" } });
    await api(`/teams/${jt}/members`, { cookie: adminCookie, body: { personId: admin, role: "coach" } });
    const created = await api("/seasons", { cookie: adminCookie, body: { name: "2027/28", startsOn: "2027-07-01", endsOn: "2028-06-30" } });
    const preview = await api(`/season-change/preview?seasonId=${created.body.id}`, { cookie: adminCookie });
    expect(preview.body.players.map((p: any) => p.person.id)).not.toContain(coach);
    expect(JSON.stringify(preview.body)).not.toContain('"JT"');
    const bad = await api("/season-change/execute", {
      cookie: adminCookie,
      body: { seasonId: created.body.id, confirmName: "2027/28", assignments: [{ personId: alma, teamIds: [jt], former: false }] },
    });
    expect(bad.status).toBe(400);
    const done = await api("/season-change/execute", {
      cookie: adminCookie,
      body: { seasonId: created.body.id, confirmName: "2027/28", assignments: [{ personId: alma, teamIds: [wd], former: false }] },
    });
    expect(done.body.ok).toBe(true);
    expect(await one<{ n: number }>("SELECT count(*) AS n FROM team_memberships WHERE team_id = ?", jt)).toEqual({ n: 2 });
    expect(await one<{ n: number }>("SELECT count(*) AS n FROM team_memberships WHERE team_id = ? AND role = 'coach'", wd)).toEqual({ n: 0 });
  });
});
