// Helferdienste bei Vereinsterminen (Sondertermin für den ganzen Verein) und das Update auf „Helfer aus“. Alle Namen
// erfunden.
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { cacheVersions } from "../../../worker/lib/cache";
import type { PushJob } from "../../../worker/domain/notify";
import { addDays, localToInstant, todayLocal } from "../../../worker/lib/time";
import { api, exec, freshDb, guardian, loginAs, member, migrateRest, one, person, rows, season, team, upgradeFrom } from "../../../test/helpers";
import { sendDutyNotifications } from "../worker/notify";

let wd: number;
let damen: number;
let kim: number;
let mona: number;
let dana: number;
let tara: number;
let adminCookie: string;
let kuchen: number;
let ball: number;

async function clubEvent(days = 10) {
  const date = addDays(todayLocal(), days);
  const res = await api("/events", {
    cookie: adminCookie,
    body: {
      title: "Sommerturnier",
      startsAt: `${date}T10:00`,
      endsAt: `${date}T16:00`,
      clubWide: true,
      duties: [
        { dutyTypeId: kuchen, startsAt: `${date}T10:00`, endsAt: `${date}T13:00`, slots: 2 },
        { dutyTypeId: ball, startsAt: `${date}T10:00`, endsAt: `${date}T12:00`, slots: 4, helperTeams: [wd] },
      ],
    },
  });
  expect(res.status).toBe(201);
  const id = res.body.id as number;
  const blocks = await rows<{ id: number; duty_type_id: number }>("SELECT id, duty_type_id FROM event_duties WHERE event_id = ?", id);
  return { id, kuchenBlock: blocks.find((b) => b.duty_type_id === kuchen)!.id, ballBlock: blocks.find((b) => b.duty_type_id === ball)!.id };
}

describe("Helferdienste bei Vereinsterminen", () => {
  beforeEach(async () => {
    await freshDb();
    await season();
    wd = await team("wD", "wD");
    damen = await team("Damen", "F");
    await exec("UPDATE teams SET parents_enabled = 0 WHERE id = ?", damen);
    kim = await person("Kim", { lastName: "Kaiser", birthYear: 2014 });
    mona = await person("Mona", { lastName: "Kaiser" });
    dana = await person("Dana", { lastName: "Dorn", birthYear: 1995 });
    tara = await person("Tara", { lastName: "Trainer" });
    await member(kim, wd);
    await guardian(mona, kim);
    await member(dana, damen);
    await member(tara, wd, "coach");
    adminCookie = await loginAs(await person("Ada", { admin: true }));
    // Kuchen: Eltern; Ball holen: nur über „Helfer aus“ (Spieler der wD)
    kuchen = (await one<{ id: number }>("INSERT INTO duty_types (name, mode, who_parents, sort) VALUES ('Kuchen', 'onsite', 1, 1) RETURNING id")).id;
    ball = (await one<{ id: number }>("INSERT INTO duty_types (name, mode, who_parents, sort) VALUES ('Ball holen', 'onsite', 0, 2) RETURNING id")).id;
  });

  it("alle sehen alle Dienste, eintragen nach „Wer hilft“ über alle Mannschaften", async () => {
    const { id, kuchenBlock, ballBlock } = await clubEvent();
    const monaCookie = await loginAs(mona);
    expect((await api("/session", { cookie: monaCookie })).body.me.clubDuties).toBe(true);
    const list = (await api("/duties/club", { cookie: monaCookie })).body;
    const g = list.games.find((x: any) => x.id === id);
    expect(g).toMatchObject({ club: true, teamName: "Ganzer Verein", canManage: false });
    const roles = (blockId: number) => g.blocks.find((b: any) => b.id === blockId).roles;
    // Kuchen: für Kim (Mannschaft mit Eltern); Ball holen: Kim macht es selbst
    expect(roles(kuchenBlock)).toEqual([{ childId: kim, childName: "Kim" }]);
    expect(roles(ballBlock)).toEqual([{ childId: kim, childName: "Kim", doer: true }]);
    expect((await api("/duties", { cookie: monaCookie, body: { blockId: kuchenBlock, childId: kim } })).status).toBe(201);
    expect((await api("/duties", { cookie: monaCookie, body: { blockId: ballBlock, childId: kim } })).status).toBe(201);
    expect(await rows("SELECT person_id, child_id FROM duties WHERE event_id = ? ORDER BY id", id)).toEqual([
      { person_id: mona, child_id: kim },
      { person_id: kim, child_id: kim },
    ]);

    // Dana spielt bei den Damen (ohne Eltern): zählt bei „Eltern“ selbst, Ball holen nicht
    const danaCookie = await loginAs(dana);
    const dg = (await api("/duties/club", { cookie: danaCookie })).body.games.find((x: any) => x.id === id);
    expect(dg.blocks.find((b: any) => b.id === kuchenBlock).roles).toEqual([{ childId: null, childName: null }]);
    expect(dg.blocks.find((b: any) => b.id === ballBlock).roles).toEqual([]);
    expect((await api("/duties", { cookie: danaCookie, body: { blockId: ballBlock } })).status).toBe(403);

    // Ohne Mannschaft: sieht die Dienste, kann sich aber nicht eintragen; kein Reiter Helfer
    const ottoCookie = await loginAs(await person("Otto"));
    expect((await api("/session", { cookie: ottoCookie })).body.me.clubDuties).toBe(false);
    const og = (await api("/duties/club", { cookie: ottoCookie })).body.games.find((x: any) => x.id === id);
    expect(og.blocks.map((b: any) => b.roles)).toEqual([[], []]);
    expect((await api("/duties", { cookie: ottoCookie, body: { blockId: kuchenBlock } })).status).toBe(403);

    // Auf der Startseite: „Helfer benötigt“ für Dana (Kuchen hat noch einen Platz)
    const ev = (await api("/events", { cookie: danaCookie })).body.events.find((e: any) => e.id === id);
    expect(ev.helpersNeeded).toBe(1);
  });

  it("verwalten: Admins und Organisatoren, Trainer einer Mannschaft nicht", async () => {
    const { id, kuchenBlock } = await clubEvent();
    const date = addDays(todayLocal(), 10);
    const block = { dutyTypeId: kuchen, startsAt: `${date}T13:00`, endsAt: `${date}T16:00`, slots: 2 };
    const taraCookie = await loginAs(tara);
    expect((await api(`/duties/events/${id}/blocks`, { cookie: taraCookie, body: block })).status).toBe(403);
    expect((await api(`/events/${id}`, { cookie: taraCookie })).body.dutyManage).toBe(false);
    expect((await api(`/events/${id}`, { cookie: adminCookie })).body.dutyManage).toBe(true);
    await exec("INSERT INTO event_organizers (event_id, person_id) VALUES (?, ?)", id, tara);
    expect((await api(`/events/${id}`, { cookie: taraCookie })).body.dutyManage).toBe(true);
    expect((await api(`/duties/events/${id}/blocks`, { cookie: taraCookie, body: block })).status).toBe(201);
    // „Helferdienste verwalten“ auf der Terminseite
    expect((await api(`/duties/events/${id}/manage`, { cookie: taraCookie })).body).toMatchObject({ id, club: true, canManage: true });
    // Organisatorin teilt jemanden ein (Personenauswahl über alle Mannschaften)
    const people = (await api(`/duties/events/${id}/people`, { cookie: taraCookie })).body.people.map((p: any) => p.personId);
    expect(people).toEqual(expect.arrayContaining([mona, dana]));
    expect((await api("/duties", { cookie: taraCookie, body: { blockId: kuchenBlock, onBehalfPersonId: dana } })).status).toBe(201);
  });

  it("kein „Helfer gesucht“, aber Erinnerung an Eingetragene", async () => {
    const pushes: PushJob[] = [];
    const testEnv = { ...env, MAIL_FROM: "no-reply@example.org", PUSH_QUEUE: { sendBatch: async (jobs: { body: PushJob }[]) => void pushes.push(...jobs.map((j) => j.body)) } } as unknown as Env;
    const { kuchenBlock } = await clubEvent(3);
    const monaCookie = await loginAs(mona);
    expect((await api("/duties", { cookie: monaCookie, body: { blockId: kuchenBlock, childId: kim } })).status).toBe(201);
    // Dana könnte Kuchen übernehmen, bekommt aber kein „Helfer gesucht“
    await loginAs(dana);
    for (const p of [mona, dana]) {
      const { id } = await one<{ id: number }>("SELECT id FROM accounts WHERE person_id = ?", p);
      await exec("INSERT INTO push_subscriptions (account_id, endpoint, p256dh, auth) VALUES (?, ?, 'x', 'y')", id, `https://push.example/${id}`);
    }
    await sendDutyNotifications(testEnv, localToInstant(`${todayLocal()}T09:00`));
    expect(pushes.filter((p) => p.payload.title.includes("gesucht"))).toEqual([]);
    const remind = pushes.filter((p) => p.payload.title === "Dein Helferdienst in 3 Tagen");
    expect(remind).toHaveLength(1);
    expect(remind[0]!.payload.body).toContain("Kuchen (für Kim): Sommerturnier am");
  });

  it("ohne Mannschaft und ohne „ganzer Verein“ gibt es weiter keine Helfer", async () => {
    const e = await one<{ id: number }>("INSERT INTO events (kind, title, starts_at, club_wide) VALUES ('special', 'Ohne alles', ?, 0) RETURNING id", `${addDays(todayLocal(), 5)}T10:00`);
    const date = addDays(todayLocal(), 5);
    const res = await api(`/duties/events/${e.id}/blocks`, { cookie: adminCookie, body: { dutyTypeId: kuchen, startsAt: `${date}T10:00`, endsAt: `${date}T12:00`, slots: 1 } });
    expect(res.status).toBe(400);
    expect(damen).toBeGreaterThan(0);
  });
});

describe("Update auf „Helfer aus“ (202611200200_duties_helper-sources.sql)", () => {
  it("bestehende Dienstarten, Vorlagen und Blöcke behalten ihr Verhalten; die vorige Version schreibt weiter", async () => {
    await upgradeFrom("202611200200_duties_helper-sources.sql");
    await exec("INSERT INTO seasons (id, name, starts_on, ends_on, is_current) VALUES (1, '2026/27', '2026-07-01', '2027-06-30', 1)");
    const type = await one<{ id: number }>("INSERT INTO duty_types (name, mode, who_parents, sort) VALUES ('Theke', 'onsite', 1, 1) RETURNING id");
    const tpl = await one<{ id: number }>("INSERT INTO duty_templates (name) VALUES ('Heimspiel') RETURNING id");
    await exec("INSERT INTO duty_template_items (template_id, duty_type_id, slots) VALUES (?, ?, 2)", tpl.id, type.id);
    const ev = await one<{ id: number }>("INSERT INTO events (kind, title, starts_at) VALUES ('special', 'Fest', '2026-12-05T14:00') RETURNING id");
    const block = await one<{ id: number }>("INSERT INTO event_duties (event_id, duty_type_id, starts_at, ends_at, slots) VALUES (?, ?, '2026-12-05T14:00', '2026-12-05T16:00', 2) RETURNING id", ev.id, type.id);
    await migrateRest();

    expect(await one("SELECT assign_only, notify_open, adults_only FROM duty_types WHERE id = ?", type.id)).toEqual({ assign_only: 0, notify_open: 1, adults_only: 0 });
    expect(await one("SELECT helper_mode, helper_teams FROM duty_template_items WHERE template_id = ?", tpl.id)).toEqual({ helper_mode: "default", helper_teams: null });
    expect(await one("SELECT helper_mode, helper_teams, rotate_team_id, rotate_notified FROM event_duties WHERE id = ?", block.id)).toEqual({
      helper_mode: "default",
      helper_teams: null,
      rotate_team_id: null,
      rotate_notified: null,
    });
    // Die vorige Version schreibt ohne die neuen Spalten
    await exec("INSERT INTO duty_types (name, mode, who_parents, sort) VALUES ('Grill', 'onsite', 1, 2)");
    await exec("INSERT INTO event_duties (event_id, duty_type_id, starts_at, ends_at, slots) VALUES (?, ?, '2026-12-05T16:00', '2026-12-05T18:00', 1)", ev.id, type.id);
    expect(await one("SELECT notify_open FROM duty_types WHERE name = 'Grill'")).toEqual({ notify_open: 1 });

    // Zwischenspeicher: die Schalter an der Dienstart zählen (ref, duties), die Zuteilung an Blöcken nicht
    const before = await cacheVersions(env.DB);
    await exec("UPDATE duty_types SET adults_only = 1 WHERE id = ?", type.id);
    const after = await cacheVersions(env.DB);
    expect([after.ref, after.duties]).toEqual([before.ref + 1, before.duties + 1]);
    await exec("UPDATE event_duties SET rotate_notified = 1 WHERE id = ?", block.id);
    expect(await cacheVersions(env.DB)).toEqual(after);
  });
});
