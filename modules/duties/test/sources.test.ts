// „Helfer aus“ an Vorlagenzeile und Zeitblock, „abwechselnd“, Aushelfen, Dienstarten zusammenführen, Zeitblock samt
// Einträgen löschen, „Helferdienste verwalten“ auf der Terminseite. Alle Namen erfunden.
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { cacheVersions } from "../../../worker/lib/cache";
import type { PushJob } from "../../../worker/domain/notify";
import { addDays, localToInstant, todayLocal } from "../../../worker/lib/time";
import { api, eventIn, exec, freshDb, guardian, loginAs, member, one, person, rows, season, team } from "../../../test/helpers";
import { sendDutyNotifications } from "../worker/notify";

let herren: number;
let wd: number;
let md: number;
let we: number;
let kim: number;
let mona: number;
let ben: number;
let paul: number;
let hugo: number;
let adminCookie: string;
let hugoCookie: string;
let wischer: number;

async function game(teamId: number, days: number) {
  const id = await eventIn(teamId, days, { kind: "game", time: "18:00" });
  await exec("UPDATE events SET external_ref = 'handball4all:g' || id, is_home = 1, home_team = 'SV Musterstadt', guest_team = 'SG Gegner' WHERE id = ?", id);
  return id;
}

beforeEach(async () => {
  await freshDb();
  await season();
  herren = await team("Herren 1", "F", { gender: "m" });
  await exec("UPDATE teams SET helper_plan = 1, parents_enabled = 0 WHERE id = ?", herren);
  wd = await team("wD", "wD");
  md = await team("mD", "wD", { gender: "m" });
  we = await team("wE", "wE");
  kim = await person("Kim", { lastName: "Kaiser", birthYear: 2014 });
  mona = await person("Mona", { lastName: "Kaiser" });
  ben = await person("Ben", { lastName: "Berg", birthYear: 2014 });
  paul = await person("Paul", { lastName: "Berg" });
  hugo = await person("Hugo", { lastName: "Herr" });
  await member(kim, wd);
  await guardian(mona, kim);
  await member(ben, md);
  await guardian(paul, ben);
  await member(hugo, herren, "coach");
  adminCookie = await loginAs(await person("Ada", { admin: true }));
  hugoCookie = await loginAs(hugo);
  // „Wer hilft“ leer: die Helfer kommen nur über „Helfer aus“
  const created = await api("/admin/duty-types", {
    cookie: adminCookie,
    body: { name: "Wischer", mode: "onsite", whoParents: false, whoPlayers: false, whoCoaches: false, noteAllowed: false, needsSkill: false },
  });
  expect(created.status).toBe(201);
  wischer = created.body.id;
});

async function rotationTemplate() {
  const body = {
    name: "Herren Heimspiel",
    items: [{ dutyTypeId: wischer, slots: 2, beforeMin: 15, afterMin: 0, taskWhen: "after", helperMode: "rotate", helperTeams: [wd, md, we] }],
  };
  const tpl = await api("/admin/duty-templates", { cookie: adminCookie, body });
  expect(tpl.status).toBe(201);
  await exec("UPDATE teams SET home_template_id = ? WHERE id = ?", tpl.body.id, herren);
  return tpl.body.id as number;
}

const blocksOf = (eventIds: number[]) =>
  rows<{ event_id: number; rotate_team_id: number | null; helper_mode: string }>(
    `SELECT ed.event_id, ed.rotate_team_id, ed.helper_mode FROM event_duties ed JOIN duty_types dt ON dt.id = ed.duty_type_id
      WHERE dt.name = 'Wischer' AND ed.event_id IN (SELECT value FROM json_each(?)) ORDER BY ed.event_id`,
    JSON.stringify(eventIds),
  );

describe("Helfer aus: abwechselnd", () => {
  it("die Vorlage verteilt die Spiele der Reihe nach; neue Spiele machen weiter, wo die Reihe steht", async () => {
    await rotationTemplate();
    const tpl = (await api("/duty-templates", { cookie: hugoCookie })).body.templates.find((x: any) => x.name === "Herren Heimspiel");
    expect(tpl.items[0]).toMatchObject({ helperMode: "rotate", helperTeams: [wd, md, we] });
    // Absichtlich nicht in zeitlicher Reihenfolge angelegt
    const g3 = await game(herren, 15);
    const g1 = await game(herren, 5);
    const g2 = await game(herren, 10);
    const g4 = await game(herren, 20);
    await api(`/duties?teamId=${herren}`, { cookie: hugoCookie });
    const byGame = new Map((await blocksOf([g1, g2, g3, g4])).map((b) => [b.event_id, b.rotate_team_id]));
    expect([byGame.get(g1), byGame.get(g2), byGame.get(g3), byGame.get(g4)]).toEqual([wd, md, we, wd]);
    // Ein neues Spiel später: die Reihe geht weiter (nach wD kommt mD)
    const g5 = await game(herren, 25);
    await api(`/duties?teamId=${herren}`, { cookie: hugoCookie });
    expect((await blocksOf([g5]))[0]!.rotate_team_id).toBe(md);
  });

  it("nur die zuständige Mannschaft trägt sich ein; Trainer ändern die Zuteilung; Hinweis bei eigenem Termin", async () => {
    await rotationTemplate();
    const g1 = await game(herren, 5);
    const g2 = await game(herren, 10);
    const list = (await api(`/duties?teamId=${herren}`, { cookie: hugoCookie })).body;
    const block = (g: number) => list.games.find((x: any) => x.id === g).blocks.find((b: any) => b.label === "Wischer");
    expect(block(g1).helperFrom).toMatchObject({ mode: "rotate", current: { id: wd, name: "wD" }, teams: [{ name: "wD" }, { name: "mD" }, { name: "wE" }] });

    // Mona (Kim in der wD): Aushelfen zeigt nur Spiel 1, dort trägt sie Kim ein, Kim macht den Dienst; bei Spiel 2 (mD) nicht
    const monaCookie = await loginAs(mona);
    expect((await api("/session", { cookie: monaCookie })).body.me.helpOut).toBe(true);
    const out = (await api("/duties/help-out", { cookie: monaCookie })).body;
    expect(out.games.map((g: any) => g.id)).toEqual([g1]);
    expect(out.games[0]).toMatchObject({ teamName: "Herren 1", canManage: false });
    expect(out.games[0].blocks[0].roles).toEqual([{ childId: kim, childName: "Kim", doer: true }]);
    expect((await api("/duties", { cookie: monaCookie, body: { blockId: block(g1).id, childId: kim } })).status).toBe(201);
    expect(await one("SELECT person_id, child_id FROM duties WHERE event_duty_id = ?", block(g1).id)).toEqual({ person_id: kim, child_id: kim });
    expect((await api("/duties", { cookie: monaCookie, body: { blockId: block(g2).id, childId: kim } })).status).toBe(403);
    // Paul (Ben in der mD) bei Spiel 2
    const paulCookie = await loginAs(paul);
    expect((await api("/duties", { cookie: paulCookie, body: { blockId: block(g2).id, childId: ben } })).status).toBe(201);
    // Ein Dienst aus „Helfer aus“ macht den fremden Termin für das Kind sichtbar (ohne Teilnehmerliste)
    const kimCookie = await loginAs(kim);
    expect((await api(`/events/${g1}`, { cookie: kimCookie })).status).toBe(200);
    expect((await api(`/events/${g2}`, { cookie: kimCookie })).status).toBe(404);

    // Trainer tauscht Spiel 2 auf wE; eine Mannschaft außerhalb der Reihe geht nicht; „Helfer aus“ ändern auch nicht
    const b2 = block(g2).id;
    expect((await api(`/duties/blocks/${b2}`, { method: "PATCH", cookie: hugoCookie, body: { rotateTeamId: herren } })).body.error.code).toBe("bad_helper_source");
    expect((await api(`/duties/blocks/${b2}`, { method: "PATCH", cookie: hugoCookie, body: { helperMode: "default" } })).body.error.code).toBe("bad_helper_source");
    expect((await api(`/duties/blocks/${b2}`, { method: "PATCH", cookie: hugoCookie, body: { rotateTeamId: we } })).status).toBe(200);
    expect((await one<{ rotate_team_id: number }>("SELECT rotate_team_id FROM event_duties WHERE id = ?", b2)).rotate_team_id).toBe(we);

    // wD hat zur Zeit von Spiel 1 selbst ein Spiel: Hinweis für den Trainer der Herren, nicht für Eltern
    await eventIn(wd, 5, { kind: "game", time: "18:30" });
    const again = (await api(`/duties?teamId=${herren}`, { cookie: hugoCookie })).body;
    const b1 = again.games.find((x: any) => x.id === g1).blocks.find((b: any) => b.label === "Wischer");
    expect(b1.helperFrom.conflict).toBe("wD hat zur selben Zeit ein Spiel (18:30).");
    expect((await api("/duties/help-out", { cookie: monaCookie })).body.games[0].blocks[0].helperFrom.conflict).toBeNull();
  });

  it("eine Woche vorher Hinweis im Chat der zuständigen Mannschaft, einmal; nach einer Änderung an die neue", async () => {
    await rotationTemplate();
    const g = await game(herren, 6);
    const later = await game(herren, 20);
    const testEnv = { ...env, PUSH_QUEUE: { sendBatch: async (_: { body: PushJob }[]) => undefined } } as unknown as Env;
    await sendDutyNotifications(testEnv, localToInstant(`${todayLocal()}T09:00`));
    const notified = await rows<{ event_id: number; rotate_notified: number | null; rotate_team_id: number }>(
      "SELECT event_id, rotate_notified, rotate_team_id FROM event_duties WHERE helper_mode = 'rotate' ORDER BY event_id",
    );
    expect(notified.find((r) => r.event_id === g)).toMatchObject({ rotate_notified: wd, rotate_team_id: wd });
    // Spiel in 20 Tagen: noch kein Hinweis
    expect(notified.find((r) => r.event_id === later)!.rotate_notified).toBeNull();
    const id = (await one<{ id: number }>("SELECT id FROM event_duties WHERE event_id = ? AND helper_mode = 'rotate'", g)).id;
    // Die Zuteilung ändert nichts an den zwischengespeicherten Daten (Version „duties“ bleibt)
    const before = await cacheVersions(env.DB);
    await api(`/duties/blocks/${id}`, { method: "PATCH", cookie: hugoCookie, body: { rotateTeamId: we } });
    expect((await cacheVersions(env.DB)).duties).toBe(before.duties);
    expect((await one<{ rotate_notified: number | null }>("SELECT rotate_notified FROM event_duties WHERE id = ?", id)).rotate_notified).toBeNull();
    await sendDutyNotifications(testEnv, localToInstant(`${todayLocal()}T10:00`));
    expect((await one<{ rotate_notified: number | null }>("SELECT rotate_notified FROM event_duties WHERE id = ?", id)).rotate_notified).toBe(we);
  });
});

describe("Helfer aus: bestimmte Mannschaften", () => {
  it("Vorlage und Zeitblock prüfen die Mannschaften; abwechselnd nur über Vorlagen; zurück auf „Wie Dienstart“", async () => {
    const group = (await api("/groups", { cookie: adminCookie, body: { name: "Trainerteam" } })).body.id;
    const item = { dutyTypeId: wischer, slots: 1, beforeMin: 0, afterMin: 0, taskWhen: "after" };
    expect((await api("/admin/duty-templates", { cookie: adminCookie, body: { name: "X", items: [{ ...item, helperMode: "teams", helperTeams: [group] }] } })).body.error.code).toBe(
      "unknown_team",
    );
    expect((await api("/admin/duty-templates", { cookie: adminCookie, body: { name: "X", items: [{ ...item, helperMode: "teams", helperTeams: [] }] } })).body.error.code).toBe(
      "bad_helper_source",
    );
    const g = await game(herren, 5);
    const date = addDays(todayLocal(), 5);
    const slot = { dutyTypeId: wischer, startsAt: `${date}T17:45`, endsAt: `${date}T20:00`, slots: 1 };
    expect((await api(`/duties/events/${g}/blocks`, { cookie: hugoCookie, body: { ...slot, helperMode: "rotate", helperTeams: [wd, md] } })).body.error.code).toBe("bad_helper_source");
    const id = (await api(`/duties/events/${g}/blocks`, { cookie: hugoCookie, body: { ...slot, helperMode: "teams", helperTeams: [wd, md] } })).body.id;
    const list = (await api(`/duties?teamId=${herren}`, { cookie: hugoCookie })).body;
    expect(list.games.find((x: any) => x.id === g).blocks.find((b: any) => b.id === id).helperFrom).toMatchObject({
      mode: "teams",
      current: null,
      teams: [{ id: wd, name: "wD" }, { id: md, name: "mD" }],
    });
    // Beide Mannschaften helfen aus; die Personenauswahl des Trainers nennt ihre Spieler
    expect((await api("/duties/help-out", { cookie: await loginAs(paul) })).body.games.map((x: any) => x.id)).toEqual([g]);
    const people = (await api(`/duties/events/${g}/people?block=${id}`, { cookie: hugoCookie })).body.people.map((p: any) => p.personId);
    expect(people).toEqual(expect.arrayContaining([kim, ben]));
    expect((await api(`/duties/blocks/${id}`, { method: "PATCH", cookie: hugoCookie, body: { helperMode: "default" } })).status).toBe(200);
    expect(await one("SELECT helper_mode, helper_teams FROM event_duties WHERE id = ?", id)).toEqual({ helper_mode: "default", helper_teams: null });
  });

  it("die Eltern der Mannschaft des Termins tragen sich bei „Helfer aus“ nicht ein, Trainer schon", async () => {
    const kuchen = (await api("/admin/duty-types", { cookie: adminCookie, body: { name: "Ordner", mode: "onsite", whoParents: true, whoPlayers: true, whoCoaches: false, noteAllowed: false, needsSkill: false } }))
      .body.id;
    const dana = await person("Dana", { lastName: "Dorn", birthYear: 1990 });
    await member(dana, herren);
    const g = await game(herren, 5);
    const date = addDays(todayLocal(), 5);
    const id = (await api(`/duties/events/${g}/blocks`, { cookie: hugoCookie, body: { dutyTypeId: kuchen, startsAt: `${date}T17:00`, endsAt: `${date}T20:00`, slots: 2, helperMode: "teams", helperTeams: [wd] } }))
      .body.id;
    const danaCookie = await loginAs(dana);
    const view = (await api(`/duties?teamId=${herren}`, { cookie: danaCookie })).body.games.find((x: any) => x.id === g).blocks.find((b: any) => b.id === id);
    expect(view.roles).toEqual([]);
    expect((await api("/duties", { cookie: danaCookie, body: { blockId: id } })).status).toBe(403);
    expect((await api("/duties", { cookie: hugoCookie, body: { blockId: id } })).status).toBe(201);
  });
});

describe("Dienstart zusammenführen", () => {
  it("Ordner D in Ordner: Vorlagen, Blöcke, Einträge und Freigaben wandern mit, „Helfer aus“ bleibt", async () => {
    const make = async (name: string) =>
      (await api("/admin/duty-types", { cookie: adminCookie, body: { name, mode: "onsite", whoParents: false, whoPlayers: false, whoCoaches: false, noteAllowed: false, needsSkill: false } }))
        .body.id as number;
    const ordner = await make("Ordner");
    const ordnerD = await make("Ordner D");
    const tpl = await api("/admin/duty-templates", {
      cookie: adminCookie,
      body: { name: "Herren", items: [{ dutyTypeId: ordnerD, slots: 2, beforeMin: 0, afterMin: 0, taskWhen: "after", helperMode: "teams", helperTeams: [wd] }] },
    });
    await exec("UPDATE teams SET home_template_id = ? WHERE id = ?", tpl.body.id, herren);
    await exec("INSERT INTO skill_grants (person_id, duty_type_id) VALUES (?, ?)", mona, ordnerD);
    const g = await game(herren, 5);
    await api(`/duties?teamId=${herren}`, { cookie: hugoCookie });
    const block = await one<{ id: number }>("SELECT id FROM event_duties WHERE event_id = ? AND duty_type_id = ?", g, ordnerD);
    const monaCookie = await loginAs(mona);
    expect((await api("/duties", { cookie: monaCookie, body: { blockId: block.id, childId: kim } })).status).toBe(201);

    expect((await api(`/admin/duty-types/${ordnerD}/merge`, { cookie: hugoCookie, body: { intoId: ordner } })).status).toBe(403);
    const task = (await api("/admin/duty-types", { cookie: adminCookie, body: { name: "Trikots", mode: "task", whoParents: true, whoPlayers: false, whoCoaches: false, noteAllowed: false, needsSkill: false } }))
      .body.id;
    expect((await api(`/admin/duty-types/${ordnerD}/merge`, { cookie: adminCookie, body: { intoId: task } })).body.error.code).toBe("mode_differs");
    expect((await api(`/admin/duty-types/${ordnerD}/merge`, { cookie: adminCookie, body: { intoId: ordner } })).status).toBe(200);
    expect(await rows("SELECT 1 FROM duty_types WHERE id = ?", ordnerD)).toEqual([]);
    expect(await one("SELECT duty_type_id, helper_mode, helper_teams FROM event_duties WHERE id = ?", block.id)).toEqual({ duty_type_id: ordner, helper_mode: "teams", helper_teams: `[${wd}]` });
    expect((await one<{ duty_type_id: number }>("SELECT duty_type_id FROM duties WHERE event_duty_id = ?", block.id)).duty_type_id).toBe(ordner);
    expect((await one<{ duty_type_id: number }>("SELECT duty_type_id FROM duty_template_items WHERE template_id = ?", tpl.body.id)).duty_type_id).toBe(ordner);
    expect(await rows("SELECT duty_type_id FROM skill_grants WHERE person_id = ?", mona)).toEqual([{ duty_type_id: ordner }]);
  });
});

describe("Zeitblöcke verwalten", () => {
  it("ein Zeitblock lässt sich samt Einträgen löschen; die Einträge zeigen im Verwalten die Uhrzeit", async () => {
    const ordner = (await api("/admin/duty-types", { cookie: adminCookie, body: { name: "Ordner", mode: "onsite", whoParents: false, whoPlayers: true, whoCoaches: false, noteAllowed: false, needsSkill: false } }))
      .body.id;
    const dana = await person("Dana", { lastName: "Dorn" });
    await member(dana, herren);
    const g = await game(herren, 5);
    const date = addDays(todayLocal(), 5);
    const id = (await api(`/duties/events/${g}/blocks`, { cookie: hugoCookie, body: { dutyTypeId: ordner, startsAt: `${date}T17:00`, endsAt: `${date}T19:30`, slots: 2 } })).body.id;
    expect((await api("/duties", { cookie: await loginAs(dana), body: { blockId: id } })).status).toBe(201);
    // „Helferdienste verwalten“ auf der Terminseite: derselbe Termin wie in der Liste, auch für Eltern nicht abrufbar
    const managed = (await api(`/duties/events/${g}/manage`, { cookie: hugoCookie })).body;
    expect(managed).toMatchObject({ id: g, canManage: true, teamName: "Herren 1" });
    expect(managed.blocks.find((b: any) => b.id === id)).toMatchObject({ startsAt: `${date}T17:00`, endsAt: `${date}T19:30`, entries: [{ name: "Dana D." }] });
    expect((await api(`/duties/events/${g}/manage`, { cookie: await loginAs(mona) })).status).toBe(403);
    // Löschen nimmt den Eintrag mit (die App fragt vorher nach)
    expect((await api(`/duties/blocks/${id}`, { method: "DELETE", cookie: hugoCookie })).status).toBe(200);
    expect(await rows("SELECT id FROM duties WHERE event_duty_id = ?", id)).toEqual([]);
    expect(await rows("SELECT id FROM event_duties WHERE id = ?", id)).toEqual([]);
  });

  it("ein Sondertermin ohne Zeitblöcke lässt sich verwalten, und die Dauer 2,5 h passt in einen Block", async () => {
    const special = await eventIn(herren, 8, { kind: "special", title: "Saisonabschluss", time: "15:00" });
    const managed = (await api(`/duties/events/${special}/manage`, { cookie: hugoCookie })).body;
    expect(managed).toMatchObject({ id: special, kind: "special", blocks: [] });
    const date = addDays(todayLocal(), 8);
    const res = await api(`/duties/events/${special}/blocks`, { cookie: hugoCookie, body: { newTypeName: "Grill", startsAt: `${date}T15:00`, endsAt: `${date}T17:30`, slots: 2 } });
    expect(res.status).toBe(201);
  });
});
