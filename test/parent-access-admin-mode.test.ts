// Eltern richten den Zugang ihres Kindes ein; Admin/Trainer-Umschalter. Namen erfunden.
import { beforeEach, describe, expect, it } from "vitest";
import { api, exec, freshDb, guardian, loginAs, member, person, rows, season, team } from "./helpers";

let wd: number;
let wb: number;
let coach: number;
let mia: number;
let paula: number;

beforeEach(async () => {
  await freshDb();
  await season();
  wd = await team("wD", "wD");
  wb = await team("wB", "wB");
  coach = await person("Tina");
  mia = await person("Mia", { birthYear: 2014 });
  paula = await person("Paula");
  await member(coach, wd, "coach");
  await member(mia, wd);
  await guardian(paula, mia);
});

describe("Eltern: Zugang des Kindes", () => {
  it("Elternteil erzeugt einen persönlichen Link, alte Passkeys bleiben", async () => {
    const res = await api(`/persons/${mia}/personal-link`, { cookie: await loginAs(paula), body: { revokeExisting: true } });
    expect(res.status).toBe(201);
    expect(res.body.url).toContain("/einladung#");
    expect(await rows("SELECT kind, revoke_existing FROM invites WHERE person_id = ?", mia)).toEqual([{ kind: "personal", revoke_existing: 0 }]);
  });

  it("nicht ohne Eltern-Einbindung, nicht für fremde Kinder", async () => {
    await exec("UPDATE teams SET parents_enabled = 0 WHERE id = ?", wd);
    expect((await api(`/persons/${mia}/personal-link`, { cookie: await loginAs(paula), body: {} })).status).toBe(403);
    const ella = await person("Ella", { birthYear: 2010 });
    await member(ella, wb);
    expect((await api(`/persons/${ella}/personal-link`, { cookie: await loginAs(paula), body: {} })).status).toBe(403);
  });
});

describe("Admin/Trainer-Umschalter", () => {
  it("Admin mit Mannschaft arbeitet als Trainer und schaltet zurück", async () => {
    const ada = await person("Ada", { admin: true });
    await member(ada, wd, "coach");
    const cookie = await loginAs(ada);
    expect((await api("/session", { cookie })).body.me).toMatchObject({ isAdmin: true, adminSwitch: { coachMode: false } });

    expect((await api("/profile/admin-mode", { method: "PUT", cookie, body: { coachMode: true } })).status).toBe(200);
    const me = (await api("/session", { cookie })).body.me;
    expect(me).toMatchObject({ isAdmin: false, adminSwitch: { coachMode: true } });
    expect(me.manageableTeams.map((t: { id: number }) => t.id)).toEqual([wd]);
    expect((await api("/admin/extra-events", { cookie })).status).toBe(403);
    // Gilt für das Konto, also auch auf einem anderen Gerät
    expect((await api("/session", { cookie: await loginAs(ada) })).body.me.isAdmin).toBe(false);

    expect((await api("/profile/admin-mode", { method: "PUT", cookie, body: { coachMode: false } })).status).toBe(200);
    expect((await api("/session", { cookie })).body.me.isAdmin).toBe(true);
  });

  it("nur für Admins mit Trainerrolle", async () => {
    expect((await api("/profile/admin-mode", { method: "PUT", cookie: await loginAs(coach), body: { coachMode: true } })).status).toBe(403);
    const ada = await person("Ada", { admin: true });
    const cookie = await loginAs(ada);
    expect((await api("/session", { cookie })).body.me.adminSwitch).toBeNull();
    expect((await api("/profile/admin-mode", { method: "PUT", cookie, body: { coachMode: true } })).status).toBe(403);
  });
});
