// Protocol for admins (Administration → Protocol). Names are invented.
import { beforeEach, describe, expect, it } from "vitest";
import { api, eventIn, exec, freshDb, guardian, loginAs, member, migrateRest, one, person, rows, season, team, upgradeFrom } from "./helpers";

let wd: number;
let admin: number;
let coach: number;
let kira: number;
let mona: number;
let adminCookie: string;

beforeEach(async () => {
  await freshDb();
  await season();
  wd = await team("wD", "wD");
  admin = await person("Ada", { admin: true });
  coach = await person("Clara");
  kira = await person("Kira");
  mona = await person("Mona");
  await member(coach, wd, "coach");
  await member(kira, wd);
  await guardian(mona, kira);
  adminCookie = await loginAs(admin);
});

const log = async () => (await api("/admin/audit-log", { cookie: adminCookie })).body.entries as any[];

describe("Protokoll", () => {
  it("hält fest, wer was mit wem gemacht hat, die neuesten zuerst", async () => {
    const coachCookie = await loginAs(coach);
    await loginAs(kira);
    expect((await api(`/persons/${kira}/active`, { cookie: coachCookie, body: { active: false } })).status).toBe(200);
    expect((await api(`/persons/${kira}/personal-link`, { cookie: adminCookie, body: {} })).status).toBe(201);
    expect((await api(`/persons/${kira}/account`, { method: "DELETE", cookie: adminCookie })).status).toBe(200);
    expect((await api(`/admin/persons/${coach}`, { method: "PATCH", cookie: adminCookie, body: { isAdmin: true, adminEmail: "clara@example.org" } })).status).toBe(200);
    expect((await api(`/teams/${wd}/members/${kira}`, { method: "DELETE", cookie: coachCookie })).status).toBe(200);
    // Removing something that does not exist leaves no entry
    expect((await api(`/teams/${wd}/members/${kira}`, { method: "DELETE", cookie: coachCookie })).status).toBe(404);

    const entries = await log();
    expect(entries.map((e) => e.action)).toEqual(["member_removed", "admin_granted", "account_removed", "personal_link", "set_inactive"]);
    expect(entries[0]).toMatchObject({
      actor: { id: coach, name: "Clara Muster" },
      person: { id: kira, name: "Kira Muster" },
      team: { id: wd, name: "wD" },
      detail: { role: "player" },
    });
    expect(entries[3].detail).toEqual({ replacesAccess: true });
  });

  it("gelöschte Personen bleiben lesbar, der Eintrag kommt vor dem Löschen", async () => {
    expect((await api(`/admin/persons/${kira}`, { method: "DELETE", cookie: adminCookie })).status).toBe(200);
    const entries = await log();
    // Mona had no other child and no role: deleted with her
    expect(entries.map((e) => [e.action, e.person.name])).toEqual(
      expect.arrayContaining([
        ["person_deleted", "Kira Muster"],
        ["person_deleted", "Mona Muster"],
      ]),
    );
    expect(await one("SELECT count(*) AS n FROM persons WHERE id IN (?, ?)", kira, mona)).toEqual({ n: 0 });
  });

  it("Absagen, Zurücknehmen und gelöschte Sondertermine mit Titel und Datum", async () => {
    const coachCookie = await loginAs(coach);
    const training = await eventIn(wd, 3);
    const party = await eventIn(wd, 10, { kind: "special", title: "Sommerfest" });
    expect((await api(`/events/${training}/cancel`, { cookie: coachCookie, body: { reason: "Halle belegt" } })).status).toBe(200);
    expect((await api(`/events/${training}/uncancel`, { cookie: coachCookie, body: {} })).status).toBe(200);
    expect((await api(`/events/${party}`, { method: "DELETE", cookie: coachCookie })).status).toBe(200);
    const entries = await log();
    expect(entries.map((e) => e.action)).toEqual(["event_deleted", "event_uncancelled", "event_cancelled"]);
    expect(entries[0]).toMatchObject({ eventId: party, team: { id: wd }, detail: { kind: "special", title: "Sommerfest" } });
    // The reason of a cancellation is not copied
    expect(JSON.stringify(entries)).not.toContain("Halle belegt");
  });

  it("nur für Admins, seitenweise", async () => {
    expect((await api("/admin/audit-log", { cookie: await loginAs(coach) })).status).toBe(403);
    for (let i = 0; i < 130; i++) await exec("INSERT INTO audit_log (actor_id, action) VALUES (?, 'export')", admin);
    const page = await api("/admin/audit-log", { cookie: adminCookie });
    expect(page.body.entries).toHaveLength(100);
    expect(page.body.hasMore).toBe(true);
    const next = await api(`/admin/audit-log?before=${page.body.entries.at(-1).id}`, { cookie: adminCookie });
    expect(next.body.entries).toHaveLength(30);
    expect(next.body.hasMore).toBe(false);
  });

  it("ein fehlgeschlagener Eintrag hält die Aktion nicht auf", async () => {
    await exec("DROP TABLE audit_log");
    expect((await api(`/persons/${kira}/active`, { cookie: adminCookie, body: { active: false } })).status).toBe(200);
    expect(await one("SELECT is_active FROM persons WHERE id = ?", kira)).toEqual({ is_active: 0 });
  });

  it("nicht im Export", async () => {
    await api(`/persons/${kira}/active`, { cookie: adminCookie, body: { active: false } });
    const res = await api("/admin/export", { cookie: adminCookie });
    expect(res.status).toBe(200);
    expect(res.body.data.audit_log).toBeUndefined();
    expect((await log()).map((e) => e.action)).toEqual(["export", "set_inactive"]);
  });
});

describe("migration 202611101400_core_audit-log.sql", () => {
  it("creates an empty protocol, existing data untouched", async () => {
    await upgradeFrom("202611101400_core_audit-log.sql");
    await exec("INSERT INTO persons (id, first_name) VALUES (900, 'Ida')");
    await migrateRest();
    expect(await rows("SELECT * FROM audit_log")).toEqual([]);
    expect(await one("SELECT first_name FROM persons WHERE id = 900")).toEqual({ first_name: "Ida" });
  });
});
