// Sondertermine: Ersteller und Organisatoren verwalten die Helferdienste; ordentliche Mitglieder. Namen erfunden.
import { beforeEach, describe, expect, it } from "vitest";
import { api, exec, freshDb, guardian, loginAs, member, one, person, rows, season, team } from "./helpers";

let wd: number;
let wc: number;
let we: number;
let tara: number;
let kim: number;
let olga: number;
let oskar: number;
let admin: number;
let taraCookie: string;
let eventId: number;

const day = "2099-06-27";

beforeEach(async () => {
  await freshDb();
  await season();
  wd = await team("wD", "wD");
  wc = await team("wC1", "wC");
  we = await team("wE", "wE");
  tara = await person("Tara", { lastName: "Trainer" });
  kim = await person("Kim", { lastName: "Kaiser" });
  olga = await person("Olga", { lastName: "Orga" });
  oskar = await person("Oskar", { lastName: "Ohne" });
  admin = await person("Ada", { admin: true });
  const lotte = await person("Lotte", { lastName: "Orga" });
  await member(tara, wd, "coach");
  await member(tara, wc, "coach");
  await member(kim, wc);
  await guardian(tara, kim);
  await member(lotte, we);
  await guardian(olga, lotte);
  await guardian(oskar, lotte);
  taraCookie = await loginAs(tara);
  await loginAs(olga);
  await loginAs(oskar);
  // Olga ist ordentliches Mitglied (von Hand), Oskar nicht
  await exec("INSERT INTO club_members (person_id) VALUES (?)", olga);

  const created = await api("/events", {
    cookie: taraCookie,
    body: {
      title: "Saisonabschluss",
      startsAt: `${day}T15:00`,
      endsAt: `${day}T19:00`,
      teamIds: [wd, wc],
      duties: [{ newTypeName: "Grill", startsAt: `${day}T15:00`, endsAt: `${day}T17:00`, slots: 2 }],
    },
  });
  expect(created.status).toBe(201);
  eventId = created.body.id;
});

describe("Sondertermine: Ersteller und Organisatoren", () => {
  it("der Ersteller verwaltet auch in der Ansicht einer Mannschaft, in der er nicht Trainer ist", async () => {
    expect(await one("SELECT created_by FROM events WHERE id = ?", eventId)).toEqual({ created_by: tara });
    // Tara ist nur noch Mutter in der wC1, nicht mehr Trainerin
    await exec("DELETE FROM team_memberships WHERE person_id = ? AND team_id = ? AND role = 'coach'", tara, wc);
    const list = await api(`/duties?teamId=${wc}`, { cookie: await loginAs(tara) });
    const game = list.body.games.find((g: any) => g.id === eventId);
    expect(game.canManage).toBe(true);
    // Und sie darf auch ohne Trainerrolle in der wC1 Blöcke ändern und andere eintragen
    expect((await api(`/duties/blocks/${game.blocks[0].id}`, { method: "PATCH", cookie: taraCookie, body: { slots: 3 } })).status).toBe(200);
    expect((await api("/duties", { cookie: taraCookie, body: { blockId: game.blocks[0].id, manualName: "Opa Otto" } })).status).toBe(201);
  });

  it("Organisatorin aus einer anderen Mannschaft verwaltet nur die Helferdienste", async () => {
    const olgaCookie = await loginAs(olga);
    // Vorher: sieht den Termin nicht
    expect((await api(`/events/${eventId}`, { cookie: olgaCookie })).status).toBe(404);
    // Nur ordentliche Mitglieder mit Zugang
    expect((await api(`/events/${eventId}/organizers`, { cookie: taraCookie, body: { personId: oskar } })).body.error.code).toBe("not_eligible");
    expect((await api(`/events/${eventId}/organizers`, { cookie: await loginAs(oskar), body: { personId: olga } })).status).toBe(403);
    expect((await api(`/events/${eventId}/organizers`, { cookie: taraCookie, body: { personId: olga } })).status).toBe(201);

    const detail = await api(`/events/${eventId}`, { cookie: olgaCookie });
    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject({ dutyManage: true, participants: null, canManage: false });
    expect(detail.body.organizers).toEqual({ creator: { id: tara, name: "Tara T." }, people: [{ id: olga, name: "Olga O." }], editable: false });
    expect((await api("/events?from=2099-06-01&to=2099-07-31", { cookie: olgaCookie })).body.events.some((e: any) => e.id === eventId)).toBe(true);

    // Reiter Helfer: Mannschaft erscheint, Termin verwaltbar
    const session = await api("/session", { cookie: olgaCookie });
    expect(session.body.me.helperTeams.map((t: any) => t.id)).toContain(wd);
    const list = await api(`/duties?teamId=${wd}`, { cookie: olgaCookie });
    expect(list.body.games.find((g: any) => g.id === eventId).canManage).toBe(true);
    const block = await api(`/duties/events/${eventId}/blocks`, { cookie: olgaCookie, body: { newTypeName: "Aufbau", startsAt: `${day}T14:00`, endsAt: `${day}T15:00`, slots: 3 } });
    expect(block.status).toBe(201);
    expect((await api("/duties", { cookie: olgaCookie, body: { blockId: block.body.id, onBehalfPersonId: kim } })).status).toBe(201);
    // Personensuche des Termins
    const found = await api(`/duties/events/${eventId}/people?q=kim`, { cookie: olgaCookie });
    expect(found.body.people.map((p: any) => p.name)).toEqual(["Kim K."]);

    // Den Termin selbst ändert sie nicht
    expect((await api(`/events/${eventId}`, { method: "PATCH", cookie: olgaCookie, body: { title: "Anders" } })).status).toBe(403);
    // Organisatoren ändert sie nicht
    expect((await api(`/events/${eventId}/organizers`, { cookie: olgaCookie, body: { personId: olga } })).status).toBe(403);

    // Entfernt: keine Rechte mehr
    expect((await api(`/events/${eventId}/organizers/${olga}`, { method: "DELETE", cookie: taraCookie })).status).toBe(200);
    expect((await api(`/duties/events/${eventId}/blocks`, { cookie: olgaCookie, body: { newTypeName: "X", startsAt: `${day}T14:00`, endsAt: `${day}T15:00`, slots: 1 } })).status).toBe(403);
  });

  it("Organisatoren nur bei Sonderterminen, Zeilen verschwinden mit dem Termin", async () => {
    const game = await api(`/duties/teams/${wd}/games`, { cookie: taraCookie, body: { opponent: "SG Test", isHome: true, date: day, time: "10:00" } });
    expect((await api(`/events/${game.body.id}/organizers`, { cookie: taraCookie, body: { personId: olga } })).status).toBe(404);
    await api(`/events/${eventId}/organizers`, { cookie: taraCookie, body: { personId: olga } });
    await exec("DELETE FROM events WHERE id = ?", eventId);
    expect(await rows("SELECT * FROM event_organizers")).toEqual([]);
  });

  it("Offene Plätze gehen bei Sonderterminen auch an die Organisatoren", async () => {
    await api(`/events/${eventId}/organizers`, { cookie: taraCookie, body: { personId: olga } });
    const olgaAccount = (await one<{ id: number }>("SELECT id FROM accounts WHERE person_id = ?", olga)).id;
    const recipients = await rows<{ account_id: number }>(
      `SELECT a.id AS account_id FROM accounts a WHERE a.person_id IN (SELECT created_by FROM events WHERE id = ?1 UNION SELECT person_id FROM event_organizers WHERE event_id = ?1)`,
      eventId,
    );
    expect(recipients.map((r) => r.account_id)).toContain(olgaAccount);
  });
});

describe("Ordentliche Mitglieder", () => {
  it("neue Spieler und Trainer werden Mitglied, Admins setzen und entfernen das Merkmal", async () => {
    // Testpersonen entstehen direkt in der Datenbank; über die API zugeordnet wird man Mitglied
    const adminCookie = await loginAs(admin);
    expect((await api(`/teams/${we}/members`, { cookie: adminCookie, body: { personId: oskar, role: "player" } })).status).toBe(201);
    expect(await one("SELECT count(*) AS n FROM club_members WHERE person_id = ?", oskar)).toEqual({ n: 1 });

    expect((await api(`/admin/club-members/${oskar}`, { method: "DELETE", cookie: taraCookie })).status).toBe(403);
    expect((await api(`/admin/club-members/${oskar}`, { method: "DELETE", cookie: adminCookie })).status).toBe(200);
    const persons = await api("/admin/persons", { cookie: adminCookie });
    const byId = new Map(persons.body.persons.map((p: any) => [p.person.id, p]));
    expect(byId.get(oskar)).toMatchObject({ isClubMember: false });
    expect(byId.get(olga)).toMatchObject({ isClubMember: true });
    expect((await api(`/admin/club-members/${oskar}`, { method: "PUT", cookie: adminCookie })).status).toBe(200);
    expect(await one("SELECT count(*) AS n FROM club_members WHERE person_id = ?", oskar)).toEqual({ n: 1 });
  });

  it("Wer hilft: Mitglieder – Elternteil mit Merkmal darf sich eintragen, ohne nicht", async () => {
    const adminCookie = await loginAs(admin);
    await exec("UPDATE teams SET helper_plan = 1 WHERE id = ?", we);
    const created = await api("/admin/duty-types", {
      cookie: adminCookie,
      body: { name: "Kasse", mode: "onsite", whoParents: false, whoPlayers: false, whoCoaches: false, whoMembers: true, noteAllowed: false, needsSkill: false },
    });
    expect(created.status).toBe(201);
    const special = await api("/events", {
      cookie: adminCookie,
      body: { title: "Turnier", startsAt: `${day}T10:00`, teamIds: [we], duties: [{ dutyTypeId: created.body.id, startsAt: `${day}T10:00`, endsAt: `${day}T12:00`, slots: 2 }] },
    });
    const blockId = (await one<{ id: number }>("SELECT id FROM event_duties WHERE event_id = ?", special.body.id)).id;
    expect((await api("/duties", { cookie: await loginAs(olga), body: { blockId } })).status).toBe(201);
    expect((await api("/duties", { cookie: await loginAs(oskar), body: { blockId } })).status).toBe(403);
  });
});
