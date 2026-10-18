// Eltern pro Mannschaft: In Mannschaften ohne Eltern handeln die Spieler selbst.
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { chatPushRecipients } from "../worker/chat/room";
import { api, eventIn, exec, freshDb, guardian, loginAs, member, one, person, season, team } from "./helpers";

let wd: number; // mit Eltern
let wb: number; // ohne Eltern
let admin: number;
let coach: number;
let older: number; // spielt in der wB
let younger: number; // spielt in der wD
let mum: number;

beforeEach(async () => {
  await freshDb();
  await season();
  wd = await team("wD", "wD");
  wb = await team("wB", "wB");
  await exec("UPDATE teams SET parents_enabled = 0 WHERE id = ?", wb);
  admin = await person("Ada", { admin: true });
  coach = await person("Trainerin");
  older = await person("Olga", { birthYear: 2010 });
  younger = await person("Yara", { birthYear: 2014 });
  mum = await person("Mara");
  await member(coach, wd, "coach");
  await member(coach, wb, "coach");
  await member(older, wb);
  await member(younger, wd);
  await guardian(mum, older);
  await guardian(mum, younger);
});

describe("Mannschaften ohne Eltern", () => {
  it("Eltern sehen nur Termine aus Mannschaften mit Eltern", async () => {
    const inWd = await eventIn(wd, 2);
    const inWb = await eventIn(wb, 3);
    const cookie = await loginAs(mum);
    const list = await api("/events", { cookie });
    expect(list.body.events.map((e: any) => e.id)).toEqual([inWd]);
    expect(list.body.events[0].mine.map((m: any) => m.person.id)).toEqual([younger]);
    expect((await api(`/events/${inWb}`, { cookie })).status).toBe(404);
  });

  it("Eltern können dort nicht für ihr Kind antworten", async () => {
    // Gemeinsames Training beider Mannschaften: sichtbar über das jüngere Kind
    const joint = await eventIn(wd, 2);
    await exec("INSERT INTO event_teams (event_id, team_id) VALUES (?, ?)", joint, wb);
    const cookie = await loginAs(mum);
    const detail = await api(`/events/${joint}`, { cookie });
    expect(detail.body.mine.map((m: any) => m.person.id)).toEqual([younger]);

    const forOlder = await api(`/events/${joint}/responses`, { cookie, body: { personId: older, status: "yes" } });
    expect(forOlder.status).toBe(403);
    expect(forOlder.body.error.message).toBe("In dieser Mannschaft sind keine Eltern eingebunden.");
    const forYounger = await api(`/events/${joint}/responses`, { cookie, body: { personId: younger, status: "yes" } });
    expect(forYounger.status).toBe(200);
  });

  it("Freigaben der Eltern gelten nur in Mannschaften mit Eltern", async () => {
    await exec("INSERT INTO child_permissions (child_id, may_decline, may_read_chat) VALUES (?, 0, 0)", older);
    const cookie = await loginAs(older);
    const first = await eventIn(wb, 2);
    const res = await api(`/events/${first}/responses`, { cookie, body: { personId: older, status: "no", reason: "Schule" } });
    expect(res.status).toBe(200);
    const rooms = await api("/chat/rooms", { cookie });
    expect(rooms.body.rooms.find((r: any) => r.teamId === wb)).toMatchObject({ canRead: true, canWrite: true });
    const session = await api("/session", { cookie });
    expect(session.body.me).toMatchObject({ hasGuardians: true, parentsInCharge: false });

    await exec("UPDATE teams SET parents_enabled = 1 WHERE id = ?", wb);
    const second = await eventIn(wb, 3);
    const blocked = await api(`/events/${second}/responses`, { cookie, body: { personId: older, status: "no", reason: "Schule" } });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.message).toBe("Deine Eltern kümmern sich darum.");
    expect((await api("/chat/rooms", { cookie })).body.rooms.find((r: any) => r.teamId === wb).canRead).toBe(false);
  });

  it("Eltern sind nur in Chats von Mannschaften mit Eltern", async () => {
    const cookie = await loginAs(mum);
    const rooms = await api("/chat/rooms", { cookie });
    expect(rooms.body.rooms.map((r: any) => r.teamId)).toEqual([wd]);
    await loginAs(older);
    await loginAs(younger);
    const mumAccount = (await one<{ id: number }>("SELECT id FROM accounts WHERE person_id = ?", mum)).id;
    expect((await chatPushRecipients(env.DB, wb, 1)).map((r) => r.account_id)).not.toContain(mumAccount);
    expect((await chatPushRecipients(env.DB, wd, 1)).map((r) => r.account_id)).toContain(mumAccount);
  });

  it("Freigaben und Benachrichtigungen gibt es nur für Kinder in Mannschaften mit Eltern", async () => {
    const cookie = await loginAs(mum);
    const session = await api("/session", { cookie });
    expect(session.body.me.children.map((c: any) => [c.firstName, c.parentsInCharge])).toEqual([
      ["Olga", false],
      ["Yara", true],
    ]);
    const settings = await api("/me/notifications", { cookie });
    expect(settings.body.persons.map((p: any) => p.person.id)).toEqual([mum, younger]);
    const change = await api(`/children/${older}/permissions`, { cookie, method: "PUT", body: { permission: "may_decline", value: false } });
    expect(change.status).toBe(403);
    expect((await api(`/children/${older}/permissions`, { cookie })).body.parentsInCharge).toBe(false);
  });
});

describe("Einstellung und Elternlinks", () => {
  it("Für Mannschaften ohne Eltern gibt es keinen Elternlink", async () => {
    const cookie = await loginAs(coach);
    const res = await api(`/teams/${wb}/invites`, { cookie, body: { kind: "parent" } });
    expect(res.status).toBe(409);
    expect((await api(`/teams/${wb}`, { cookie })).body).toMatchObject({ parentsEnabled: false, invites: { parent: null } });
  });

  it("Ausschalten macht offene Elternlinks ungültig, nur Admins dürfen das", async () => {
    const coachCookie = await loginAs(coach);
    const link = await api(`/teams/${wd}/invites`, { cookie: coachCookie, body: { kind: "parent" } });
    const token = String(link.body.url).split("#")[1];
    expect((await api("/join/info", { body: { token } })).status).toBe(200);

    expect((await api(`/teams/${wd}`, { cookie: coachCookie, method: "PATCH", body: { parentsEnabled: false } })).status).toBe(403);
    const adminCookie = await loginAs(admin);
    expect((await api(`/teams/${wd}`, { cookie: adminCookie, method: "PATCH", body: { parentsEnabled: false } })).status).toBe(200);

    const info = await api("/join/info", { body: { token } });
    expect(info.status).toBe(400);
    expect(info.body.error.code).toBe("parents_disabled");
    // Wieder eingeschaltet bleibt der alte Link zurückgezogen
    await api(`/teams/${wd}`, { cookie: adminCookie, method: "PATCH", body: { parentsEnabled: true } });
    expect((await api("/join/info", { body: { token } })).body.error.code).toBe("invite_revoked");
  });

  it("Neue Aktivenmannschaften starten ohne Eltern, Jugendmannschaften mit", async () => {
    const cookie = await loginAs(admin);
    const women = await api("/teams", { cookie, body: { name: "Damen", ageClassCode: "F" } });
    const youth = await api("/teams", { cookie, body: { name: "wC", ageClassCode: "wC" } });
    const teams = (await api("/teams", { cookie })).body.teams;
    expect(teams.find((t: any) => t.id === women.body.id).parentsEnabled).toBe(false);
    expect(teams.find((t: any) => t.id === youth.body.id).parentsEnabled).toBe(true);
  });
});
