// Mehrere Rollen in einer Person: Admin, Trainer und Elternteil gleichzeitig.
import { beforeEach, describe, expect, it } from "vitest";
import { api, eventIn, freshDb, guardian, loginAs, member, person, season, team } from "./helpers";

let wd: number;
let wc: number;
let mb: number;

beforeEach(async () => {
  await freshDb();
  await season();
  wd = await team("wD", "wD");
  wc = await team("wC", "wC");
  mb = await team("mB", "wB");
});

describe("Mehrere Rollen", () => {
  it("Admin ist Trainer der wD und Elternteil von Kindern in wD und wC", async () => {
    const admin = await person("Ada", { admin: true });
    const kidD = await person("Dora");
    const kidC = await person("Clara");
    const other = await person("Otto");
    await member(admin, wd, "coach");
    await member(kidD, wd);
    await member(kidC, wc);
    await member(other, mb);
    await guardian(admin, kidD);
    await guardian(admin, kidC);
    const inD = await eventIn(wd, 2);
    const inC = await eventIn(wc, 3);
    await eventIn(mb, 4);
    const cookie = await loginAs(admin);

    const session = (await api("/session", { cookie })).body.me;
    expect(session.isAdmin).toBe(true);
    expect(session.memberships).toEqual([expect.objectContaining({ name: "wD", role: "coach" })]);
    expect(session.children.map((c: { firstName: string }) => c.firstName)).toEqual(["Clara", "Dora"]);

    // Eigene Termine: als Trainerin und über die Kinder, fremde Mannschaften nicht
    const events = (await api("/events", { cookie })).body.events;
    expect(events.map((e: { id: number }) => e.id)).toEqual([inD, inC]);
    const d = events.find((e: { id: number }) => e.id === inD);
    expect(d.canManage).toBe(true);
    expect(d.mine.find((m: { person: { id: number } }) => m.person.id === kidD)).toMatchObject({ canAccept: true, canDecline: true });

    // Für beide Kinder antworten, Trainersicht mit Namen in der eigenen Mannschaft
    expect((await api(`/events/${inD}/responses`, { cookie, body: { personId: kidD, status: "yes" } })).status).toBe(200);
    expect((await api(`/events/${inC}/responses`, { cookie, body: { personId: kidC, status: "no", reason: "Schule" } })).status).toBe(200);
    expect((await api(`/events/${inD}`, { cookie })).body.participants).not.toBeNull();

    // Chat: eigene Mannschaft als Moderatorin, die andere über das Kind
    const rooms = (await api("/chat/rooms", { cookie })).body.rooms;
    expect(rooms.find((r: { teamId: number }) => r.teamId === wd)).toMatchObject({ isMod: true, canRead: true });
    expect(rooms.find((r: { teamId: number }) => r.teamId === wc)).toMatchObject({ viaChildren: ["Clara"], canRead: true });
  });

  it("Trainer hat Kinder in der eigenen und in einer anderen Mannschaft", async () => {
    const coach = await person("Theo");
    const own = await person("Olivia");
    const elsewhere = await person("Emma");
    await member(coach, wd, "coach");
    await member(own, wd);
    await member(elsewhere, wc);
    await guardian(coach, own);
    await guardian(coach, elsewhere);
    const inD = await eventIn(wd, 2);
    const inC = await eventIn(wc, 3);
    const cookie = await loginAs(coach);

    const events = (await api("/events", { cookie })).body.events;
    expect(events.map((e: { id: number }) => e.id)).toEqual([inD, inC]);
    expect(events.find((e: { id: number }) => e.id === inD).canManage).toBe(true);
    // In der fremden Mannschaft nur Elternteil: keine Trainerrechte, keine Namen anderer
    const c = await api(`/events/${inC}`, { cookie });
    expect(c.body.canManage).toBe(false);
    expect(c.body.participants).toBeNull();
    expect((await api(`/events/${inC}/responses`, { cookie, body: { personId: elsewhere, status: "yes" } })).status).toBe(200);
    expect((await api(`/teams/${wc}`, { cookie })).status).toBe(403);
    expect((await api(`/teams/${wd}`, { cookie })).status).toBe(200);
  });
});

describe("Eltern und Kinder durch Admins zuordnen", () => {
  it("verknüpft, korrigiert und löst, ohne Personen zu löschen", async () => {
    const admin = await person("Ada", { admin: true });
    const coach = await person("Theo");
    const parent = await person("Mara");
    const wrong = await person("Wanda");
    const right = await person("Rita");
    await member(coach, wd, "coach");
    await member(wrong, wd);
    await member(right, wd);
    const ev = await eventIn(wd, 2);
    const adminCookie = await loginAs(admin);

    // Nur Admins
    expect((await api("/admin/guardianships", { cookie: await loginAs(coach), body: { guardianId: parent, childId: right } })).status).toBe(403);

    // Falsch zugeordnet, dann korrigiert: zuerst lösen, die Elternperson bleibt
    expect((await api("/admin/guardianships", { cookie: adminCookie, body: { guardianId: parent, childId: wrong } })).status).toBe(201);
    expect((await api(`/admin/guardianships/${parent}/${wrong}`, { cookie: adminCookie, method: "DELETE" })).status).toBe(200);
    expect((await api("/admin/guardianships", { cookie: adminCookie, body: { guardianId: parent, childId: right } })).status).toBe(201);

    const persons = (await api("/admin/persons", { cookie: adminCookie })).body.persons;
    expect(persons.find((x: { person: { id: number } }) => x.person.id === parent)).toMatchObject({ childIds: [right] });
    expect(persons.find((x: { person: { id: number } }) => x.person.id === right)).toMatchObject({ parentIds: [parent] });

    // Das Elternteil sieht nun die Termine des richtigen Kindes
    const mine = (await api(`/events/${ev}`, { cookie: await loginAs(parent) })).body.mine;
    expect(mine.map((m: { person: { id: number } }) => m.person.id)).toEqual([right]);

    // Sich selbst oder umgekehrt verknüpfen geht nicht
    expect((await api("/admin/guardianships", { cookie: adminCookie, body: { guardianId: parent, childId: parent } })).status).toBe(400);
    expect((await api("/admin/guardianships", { cookie: adminCookie, body: { guardianId: right, childId: parent } })).status).toBe(409);
    // Der Admin kann sich selbst als Elternteil eintragen
    expect((await api("/admin/guardianships", { cookie: adminCookie, body: { guardianId: admin, childId: wrong } })).status).toBe(201);
  });
});
