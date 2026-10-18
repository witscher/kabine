// Sichten für Admins (Spieler, Elternteil, Trainer). Alle Namen erfunden.
import { beforeEach, describe, expect, it } from "vitest";
import { api, eventIn, exec, freshDb, guardian, loginAs, member, person, season, team } from "./helpers";

let wd: number;
let admin: number;
let kim: number;
let coach: number;
let adminCookie: string;

beforeEach(async () => {
  await freshDb();
  await season();
  wd = await team("wD", "wD");
  const wb = await team("wB", "wB");
  admin = await person("Chef", { admin: true });
  kim = await person("Kim", { lastName: "Kaiser" });
  coach = await person("Tara", { lastName: "Trainer" });
  await member(kim, wd);
  await member(coach, wd, "coach");
  await member(admin, wb, "coach");
  await guardian(admin, kim);
  await exec("UPDATE teams SET helper_plan = 1 WHERE id = ?", wd);
  adminCookie = await loginAs(admin);
  await eventIn(wd, 3, { kind: "training" });
});

const as = (mode: string) => `${adminCookie}; kabine_view=${mode}`;

describe("Sichten für Admins", () => {
  it("Spielersicht: erstes Kind, ohne Admin, schreibgeschützt", async () => {
    const me = (await api("/session", { cookie: as("player") })).body.me;
    expect(me.person).toMatchObject({ id: kim, firstName: "Kim", isAdmin: false });
    expect(me.viewAs).toEqual({ mode: "player", readOnly: true });
    expect(me.memberships.map((m: any) => `${m.name}:${m.role}`)).toEqual(["wD:player"]);
    expect((await api("/events", { cookie: as("player") })).body.events).toHaveLength(1);
    const write = await api("/profile/duty-prefs", { method: "PUT", cookie: as("player"), body: { tableDuty: false } });
    expect(write.status).toBe(403);
    expect(write.body.error.code).toBe("view_read_only");
    const rooms = (await api("/chat/rooms", { cookie: as("player") })).body.rooms;
    expect(rooms.every((r: any) => !r.canWrite)).toBe(true);
  });

  it("Elternsicht: man selbst ohne Admin- und Trainerrechte, schreiben erlaubt", async () => {
    const me = (await api("/session", { cookie: as("parent") })).body.me;
    expect(me.person).toMatchObject({ id: admin, isAdmin: false });
    expect(me.viewAs).toEqual({ mode: "parent", readOnly: false });
    expect(me.manageableTeams).toEqual([]);
    expect(me.memberships).toEqual([]);
    expect(me.children.map((c: any) => c.firstName)).toEqual(["Kim"]);
    expect((await api("/admin/export", { cookie: as("parent") })).status).toBe(403);
    expect((await api("/profile/duty-prefs", { method: "PUT", cookie: as("parent"), body: { tableDuty: false } })).status).toBe(200);
  });

  it("Trainersicht: erster Trainer der ersten eigenen Mannschaft, schreibgeschützt", async () => {
    const me = (await api("/session", { cookie: as("trainer") })).body.me;
    // Der Admin trainiert selbst die wB und ist dort der Trainer
    expect(me.person).toMatchObject({ id: admin, isAdmin: false });
    expect(me.manageableTeams.map((t: any) => t.name)).toEqual(["wB"]);
    expect(me.viewAs).toEqual({ mode: "trainer", readOnly: false });

    // Ohne eigene Trainerrolle: Trainer der Mannschaft des ersten Kindes
    await exec("DELETE FROM team_memberships WHERE person_id = ? AND role = 'coach'", admin);
    const other = (await api("/session", { cookie: as("trainer") })).body.me;
    expect(other.person).toMatchObject({ id: coach, firstName: "Tara", isAdmin: false });
    expect(other.manageableTeams.map((t: any) => t.name)).toEqual(["wD"]);
    expect(other.viewAs).toEqual({ mode: "trainer", readOnly: true });
    expect((await api("/events", { cookie: as("trainer") })).body.events).toHaveLength(1);
  });

  it("wirkt nur für Admins", async () => {
    const parentCookie = await loginAs(await person("Mona"));
    const me = (await api("/session", { cookie: `${parentCookie}; kabine_view=trainer` })).body.me;
    expect(me.viewAs).toBeNull();
    expect((await api("/session", { cookie: as("unbekannt") })).body.me.viewAs).toBeNull();
    expect((await api("/session", { cookie: adminCookie })).body.me).toMatchObject({ isAdmin: true, viewAs: null });
  });
});
