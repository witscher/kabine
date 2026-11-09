// Qualifications (docs/dev/design.md, Qualifications): duty types whose prior knowledge an admin approves, the youth
// referee as such a qualification taken from all teams (by link or admin, home games of the youngest age groups),
// and the migration from the youth referee role. Invented names.
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendDutyNotifications } from "../worker/notify";
import { type MailMessage, mailer } from "../../../worker/domain/email-login";
import type { PushJob } from "../../../worker/domain/notify";
import { localToInstant, todayLocal } from "../../../worker/lib/time";
import { api, eventIn, exec, freshDb, guardian, loginAs, member, migrateRest, one, person, rows, season, team, upgradeFrom } from "../../../test/helpers";

let wd: number;
let wb: number;
let mini: number;
let admin: number;
let lena: number; // player wB, becomes youth referee
let kim: number; // child of the mother, becomes youth referee
let mona: number; // mother of Kim
let other: number; // player without approval
let adminCookie: string;
let lenaCookie: string;
let monaCookie: string;
let otherCookie: string;
let homeD: number;
let referee: number; // duty type id of the youth referee

async function game(teamId: number, days: number, isHome: 0 | 1) {
  const id = await eventIn(teamId, days, { kind: "game", time: "11:00" });
  await exec("UPDATE events SET external_ref = 'handball4all:g' || id, is_home = ?, home_team = 'SV Musterstadt', guest_team = 'SG Gegner' WHERE id = ?", isHome, id);
  return id;
}

async function link(dutyTypeId = referee): Promise<string> {
  const res = await api("/admin/skill-links", { cookie: adminCookie, body: { dutyTypeId } });
  expect(res.status).toBe(201);
  expect(String(res.body.url)).toContain("/freigabe#");
  return String(res.body.url).split("#")[1]!;
}

const grant = (personId: number, typeId = referee) => exec("INSERT INTO skill_grants (person_id, duty_type_id) VALUES (?, ?)", personId, typeId);

beforeEach(async () => {
  await freshDb();
  await season();
  referee = (await one<{ id: number }>("SELECT id FROM duty_types WHERE code = 'referee'")).id;
  wd = await team("wD", "wD");
  wb = await team("wB", "wB");
  mini = await team("Minis", "Minis");
  admin = await person("Ada", { admin: true });
  lena = await person("Lena", { lastName: "Lang", birthYear: 2010 });
  kim = await person("Kim", { lastName: "Kaiser", birthYear: 2012 });
  mona = await person("Mona", { lastName: "Kaiser" });
  other = await person("Otto", { lastName: "Ohne" });
  await member(lena, wb);
  await member(kim, wb);
  await member(other, wb);
  await guardian(mona, kim);
  adminCookie = await loginAs(admin);
  lenaCookie = await loginAs(lena);
  monaCookie = await loginAs(mona);
  otherCookie = await loginAs(other);
  homeD = await game(wd, 4, 1);
});

describe("Jugendschiedsrichter als Freigabe", () => {
  it("Link: angemeldet für sich oder ein eigenes Kind, nicht für Fremde", async () => {
    const token = await link();
    const info = await api("/skill-link/info", { cookie: monaCookie, body: { token } });
    expect(info.body.dutyType).toBe("Jugendschiedsrichter");
    expect(info.body.candidates.map((c: any) => c.personId)).toEqual([mona, kim]);
    expect((await api("/skill-link/accept", { cookie: monaCookie, body: { token, personId: lena } })).status).toBe(400);
    expect((await api("/skill-link/accept", { cookie: monaCookie, body: { token, personId: kim } })).status).toBe(200);
    expect((await api("/skill-link/accept", { cookie: lenaCookie, body: { token, personId: lena } })).status).toBe(200);
    expect(await rows("SELECT person_id FROM skill_grants WHERE duty_type_id = ? ORDER BY person_id", referee)).toEqual(
      [{ person_id: lena }, { person_id: kim }].sort((a, b) => a.person_id - b.person_id),
    );
    // Not signed in: only the hint, no approval
    expect((await api("/skill-link/info", { body: { token } })).body).toMatchObject({ loggedIn: false, candidates: [] });
    expect((await api("/skill-link/accept", { body: { token, personId: lena } })).status).toBe(401);
    const me = (await api("/session", { cookie: monaCookie })).body.me;
    expect(me.referee).toBe(true);
    expect(me.qualifiedLists).toEqual([{ id: referee, name: "Jugendschiedsrichter", mine: true }]);
    expect((await api("/session", { cookie: otherCookie })).body.me).toMatchObject({ referee: false, qualifiedLists: [] });
  });

  it("zurückgezogene und abgelaufene Links gelten nicht", async () => {
    const token = await link();
    const { id } = await one<{ id: number }>("SELECT id FROM skill_grant_links");
    await api(`/admin/skill-links/${id}`, { method: "DELETE", cookie: adminCookie });
    expect((await api("/skill-link/accept", { cookie: lenaCookie, body: { token, personId: lena } })).body.error.code).toBe("link_revoked");
    const fresh = await link();
    await exec("UPDATE skill_grant_links SET expires_at = '2000-01-01T00:00:00.000Z' WHERE revoked_at IS NULL");
    expect((await api("/skill-link/accept", { cookie: lenaCookie, body: { token: fresh, personId: lena } })).body.error.code).toBe("link_expired");
  });

  it("Admin setzt und entfernt die Freigabe direkt, andere dürfen das nicht", async () => {
    expect((await api(`/admin/skill-grants/${other}/${referee}`, { method: "PUT", cookie: lenaCookie })).status).toBe(403);
    expect((await api(`/admin/skill-grants/${other}/${referee}`, { method: "PUT", cookie: adminCookie })).status).toBe(200);
    const list = await api("/admin/persons", { cookie: adminCookie });
    expect(list.body.persons.find((p: any) => p.person.id === other).skillGrants).toEqual([referee]);
    const page = await api("/admin/qualifications", { cookie: adminCookie });
    expect(page.body.types.find((q: any) => q.dutyTypeId === referee).people.map((p: any) => p.personId)).toEqual([other]);
    await api(`/admin/skill-grants/${other}/${referee}`, { method: "DELETE", cookie: adminCookie });
    expect(await rows("SELECT * FROM skill_grants")).toEqual([]);
    // Only for duty types an admin approves
    const kiosk = (await one<{ id: number }>("SELECT id FROM duty_types WHERE code = 'kuchen'")).id;
    expect((await api(`/admin/skill-grants/${other}/${kiosk}`, { method: "PUT", cookie: adminCookie })).status).toBe(404);
  });

  it("Dienst nur bei Heimspielen der Altersklassen mit Pflichtdienst, auch ohne Helferplan, und nur mit Freigabe", async () => {
    await grant(lena);
    await grant(kim);
    const awayD = await game(wd, 5, 0);
    await game(wb, 6, 1); // B youth: no youth referee
    await game(mini, 7, 1); // Minis: no youth referee
    const list = await api(`/duties/qualified/${referee}`, { cookie: lenaCookie });
    expect(list.status).toBe(200);
    expect(list.body.games.map((g: any) => g.id)).toEqual([homeD]);
    expect(list.body.games[0]).toMatchObject({ teamName: "wD", blocks: [{ referee: true, label: "Jugendschiedsrichter", total: 1, entries: [] }] });
    const blockId = list.body.games[0].blocks[0].id;
    // The away game has no youth referee block
    expect(await rows("SELECT * FROM event_duties WHERE event_id = ?", awayD)).toEqual([]);

    expect((await api("/duties", { cookie: otherCookie, body: { blockId } })).body.error.code).toBe("not_qualified");
    expect((await api(`/duties/qualified/${referee}`, { cookie: otherCookie })).status).toBe(403);
    // Last place at the same time: Lena and Mona (for Kim), only one wins
    const results = (
      await Promise.all([api("/duties", { cookie: lenaCookie, body: { blockId } }), api("/duties", { cookie: monaCookie, body: { blockId, childId: kim } })])
    )
      .map((r) => r.status)
      .sort();
    expect(results).toEqual([201, 409]);
  });

  it("Terminübersicht: eigener Dienst sichtbar, offene Plätze ohne rote Marke, fremde Spiele unsichtbar", async () => {
    await grant(kim);
    const events = async (cookie: string) => (await api("/events", { cookie })).body.events.filter((e: any) => e.kind === "game");
    // Before signing up: the wD game is not one of Mona's teams
    expect((await events(monaCookie)).map((e: any) => e.id)).not.toContain(homeD);
    const blockId = (await api(`/duties/qualified/${referee}`, { cookie: monaCookie })).body.games[0].blocks[0].id;
    expect((await api("/duties", { cookie: monaCookie, body: { blockId, childId: kim } })).status).toBe(201);
    const game = (await events(monaCookie)).find((e: any) => e.id === homeD);
    expect(game.myDuties).toEqual([{ dutyTypeId: referee, referee: true, label: "Jugendschiedsrichter", child: "Kim", mine: false }]);
    expect(game.helpersNeeded).toBe(0);
    const kimCookie = await loginAs(kim);
    const own = (await events(kimCookie)).find((e: any) => e.id === homeD);
    expect(own.myDuties).toEqual([{ dutyTypeId: referee, referee: true, label: "Jugendschiedsrichter", child: null, mine: true }]);
    expect((await api(`/events/${homeD}`, { cookie: kimCookie })).body.participants).toBeNull();
    // The mother signs her off
    const entry = await one<{ id: number }>("SELECT id FROM duties WHERE duty_type_id = ?", referee);
    expect((await api(`/duties/${entry.id}`, { method: "DELETE", cookie: monaCookie })).status).toBe(200);
  });

  it("Admin-Sicht referee: ohne Admin, mit allen Listen", async () => {
    const me = (await api("/session", { cookie: `${adminCookie}; kabine_view=referee` })).body.me;
    expect(me).toMatchObject({ isAdmin: false, referee: true, viewAs: { mode: "referee", readOnly: false } });
    expect((await api(`/duties/qualified/${referee}`, { cookie: `${adminCookie}; kabine_view=referee` })).status).toBe(200);
  });

  it("Gruppe aller Freigegebenen folgt den Freigaben, Verantwortliche von Hand", async () => {
    const g = (await api("/groups", { cookie: adminCookie, body: { name: "JSR", autoSkill: referee } })).body.id;
    const members = async () => (await rows<{ person_id: number }>("SELECT person_id FROM team_memberships WHERE team_id = ? AND role = 'player' ORDER BY person_id", g)).map((r) => r.person_id);
    expect(await members()).toEqual([]);
    await api(`/admin/skill-grants/${lena}/${referee}`, { method: "PUT", cookie: adminCookie });
    expect(await members()).toEqual([lena]);
    expect((await api(`/teams/${g}`, { cookie: adminCookie })).body.autoSkill).toEqual({ id: referee, name: "Jugendschiedsrichter" });
    await api(`/admin/skill-grants/${lena}/${referee}`, { method: "DELETE", cookie: adminCookie });
    expect(await members()).toEqual([]);
    // Only duty types an admin approves
    const kiosk = (await one<{ id: number }>("SELECT id FROM duty_types WHERE code = 'kuchen'")).id;
    expect((await api("/groups", { cookie: adminCookie, body: { name: "Kuchen", autoSkill: kiosk } })).status).toBe(400);
  });
});

describe("Dienstart mit Freigabe durch einen Admin (z. B. Turnierleitung)", () => {
  let lead: number;
  let block: number;
  beforeEach(async () => {
    await exec("UPDATE teams SET helper_plan = 1, parents_enabled = 0 WHERE id = ?", wb);
    const body = { name: "Turnierleitung", mode: "onsite", whoParents: false, whoPlayers: true, whoCoaches: false, noteAllowed: false, needsSkill: true, skillGrant: "admin" };
    lead = (await api("/admin/duty-types", { cookie: adminCookie, body })).body.id;
    const special = await eventIn(wb, 5, { kind: "special", title: "Turnier" });
    const date = (await one<{ starts_at: string }>("SELECT starts_at FROM events WHERE id = ?", special)).starts_at.slice(0, 10);
    const coach = await person("Tara");
    await member(coach, wb, "coach");
    block = (await api(`/duties/events/${special}/blocks`, { cookie: await loginAs(coach), body: { dutyTypeId: lead, startsAt: `${date}T10:00`, endsAt: `${date}T12:00`, slots: 1 } })).body.id;
  });
  const visible = async (cookie: string) =>
    (await api(`/duties?teamId=${wb}`, { cookie })).body.games.flatMap((g: any) => g.blocks).filter((b: any) => b.id === block);

  it("nur Freigegebene sehen und übernehmen den Dienst; eine eigene Zustimmung im Profil zählt nicht", async () => {
    expect(await visible(lenaCookie)).toEqual([]);
    // A consent in the profile does not count, and the profile does not offer a switch for it
    await api("/profile/duty-prefs", { method: "PUT", cookie: lenaCookie, body: { skills: [{ dutyTypeId: lead, on: true }] } });
    expect(await rows("SELECT * FROM skill_consents WHERE duty_type_id = ?", lead)).toEqual([]);
    expect((await api("/profile/duty-prefs", { cookie: lenaCookie })).body.skills.map((s: any) => s.dutyTypeId)).not.toContain(lead);
    expect((await api("/duties", { cookie: lenaCookie, body: { blockId: block } })).body.error.code).toBe("skill_missing");

    await grant(lena, lead);
    const [b] = await visible(lenaCookie);
    expect(b).toMatchObject({ skillByAdmin: true, skillMissing: false, roles: [{ childId: null, childName: null }] });
    expect((await api("/profile/duty-prefs", { cookie: lenaCookie })).body.approved).toEqual([{ dutyTypeId: lead, name: "Turnierleitung", child: null }]);
    expect((await api("/duties", { cookie: lenaCookie, body: { blockId: block } })).status).toBe(201);
    // Taken back: the own entry stays visible
    await exec("DELETE FROM skill_grants WHERE person_id = ?", lena);
    expect((await visible(lenaCookie)).length).toBe(1);
    expect((await visible(otherCookie)).length).toBe(0);
  });

  it("Typ von „selbst“ auf „Admin“ umgestellt: frühere Zustimmungen zählen nicht mehr", async () => {
    await api(`/admin/duty-types/${lead}`, {
      method: "PATCH",
      cookie: adminCookie,
      body: { name: "Turnierleitung", mode: "onsite", whoParents: false, whoPlayers: true, whoCoaches: false, noteAllowed: false, needsSkill: true, skillGrant: "self" },
    });
    await api("/profile/duty-prefs", { method: "PUT", cookie: otherCookie, body: { skills: [{ dutyTypeId: lead, on: true }] } });
    expect((await visible(otherCookie))[0]).toMatchObject({ skillMissing: false });
    await api(`/admin/duty-types/${lead}`, {
      method: "PATCH",
      cookie: adminCookie,
      body: { name: "Turnierleitung", mode: "onsite", whoParents: false, whoPlayers: true, whoCoaches: false, noteAllowed: false, needsSkill: true, skillGrant: "admin" },
    });
    expect(await visible(otherCookie)).toEqual([]);
    expect((await api("/duties", { cookie: otherCookie, body: { blockId: block } })).body.error.code).toBe("skill_missing");
  });
});

describe("Gesucht: Dienst für Freigegebene", () => {
  let mails: MailMessage[];
  let pushes: PushJob[];
  const testEnv = () =>
    ({ ...env, PUSH_QUEUE: { sendBatch: async (jobs: { body: PushJob }[]) => void pushes.push(...jobs.map((j) => j.body)) } }) as unknown as Env;
  beforeEach(() => {
    mails = [];
    pushes = [];
    vi.spyOn(mailer, "send").mockImplementation(async (_env, msg) => void mails.push(msg));
  });
  afterEach(() => vi.restoreAllMocks());

  it("3 Tage vorher an alle Freigegebenen bzw. ihre Eltern, die noch nicht eingetragen sind, nur einmal", async () => {
    await grant(lena);
    await grant(kim);
    await exec("INSERT INTO push_subscriptions (account_id, endpoint, p256dh, auth) SELECT id, 'https://push.example/' || id, 'k', 'a' FROM accounts");
    const soon = await game(wd, 3, 1);
    expect(soon).toBeGreaterThan(0);
    const at9 = localToInstant(`${todayLocal()}T09:00`);
    await sendDutyNotifications(testEnv(), at9);
    const titles = pushes.filter((p) => p.payload.title.startsWith("Jugendschiedsrichter gesucht"));
    expect(titles[0]?.payload.url).toBe(`/helfer?liste=${referee}&spiel=${soon}`);
    const accounts = (await rows<{ id: number; person_id: number }>("SELECT id, person_id FROM accounts")).reduce<Record<number, number>>(
      (m, a) => ({ ...m, [a.id]: a.person_id }),
      {},
    );
    const people = titles.flatMap((p) => p.accountIds.map((a) => accounts[a]));
    // Lena herself and Mona for Kim (Kim has no access of her own); not Otto, not the admin
    expect(new Set(people)).toEqual(new Set([lena, mona]));
    pushes = [];
    await sendDutyNotifications(testEnv(), at9 + 3_600_000);
    expect(pushes.filter((p) => p.payload.title.startsWith("Jugendschiedsrichter gesucht"))).toEqual([]);
  });
});

describe("migration 202611092330_core_qualifications.sql", () => {
  it("turns the youth referee role, its links, the age class flag and the automatic group into qualifications", async () => {
    await upgradeFrom("202611092330_core_qualifications.sql");
    await season();
    const ref = (await one<{ id: number }>("SELECT id FROM duty_types WHERE code = 'referee'")).id;
    const p1 = await person("Lena");
    const p2 = await person("Kim");
    await exec("INSERT INTO referees (person_id, added_by) VALUES (?, NULL), (?, ?)", p1, p2, p1);
    await exec("INSERT INTO referee_links (token_hash, expires_at) VALUES ('abc', '2099-01-01T00:00:00.000Z')");
    await exec("INSERT INTO teams (name, age_class_code, kind, auto_members) VALUES ('Jugendschiedsrichter', 'F', 'group', 'referees')");
    await migrateRest();
    expect(await one("SELECT skill_grant, needs_skill FROM duty_types WHERE id = ?", ref)).toEqual({ skill_grant: "admin", needs_skill: 0 });
    expect(await one("SELECT skill_grant FROM duty_types WHERE code = 'zeitnehmer'")).toEqual({ skill_grant: "self" });
    expect(await rows("SELECT person_id, granted_by FROM skill_grants WHERE duty_type_id = ? ORDER BY person_id", ref)).toEqual([
      { person_id: p1, granted_by: null },
      { person_id: p2, granted_by: p1 },
    ]);
    expect(await rows("SELECT duty_type_id, token_hash FROM skill_grant_links")).toEqual([{ duty_type_id: ref, token_hash: "abc" }]);
    // season() marks wE, wD, wC
    expect((await rows<{ code: string }>("SELECT ac.code FROM age_class_duties acd JOIN age_classes ac ON ac.id = acd.age_class_id ORDER BY ac.rank")).map((r) => r.code)).toEqual([
      "wE",
      "wD",
      "wC",
    ]);
    expect(await one("SELECT auto_skill FROM teams WHERE auto_members = 'referees'")).toEqual({ auto_skill: ref });
    // The previous release keeps reading its tables
    expect(await rows("SELECT person_id FROM referees ORDER BY person_id")).toEqual([{ person_id: p1 }, { person_id: p2 }]);
  });

  it("a club that had switched the youth referees off gets no required duties, and the duty type is archived", async () => {
    await upgradeFrom("202611092330_core_qualifications.sql");
    await season();
    await exec("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('club', ?)", JSON.stringify({ modules: { youthReferees: false } }));
    await migrateRest();
    expect(await rows("SELECT * FROM age_class_duties")).toEqual([]);
    expect(await one("SELECT archived FROM duty_types WHERE code = 'referee'")).toEqual({ archived: 1 });
  });
});

describe("migration 202610202300_youth-referees_rename.sql", () => {
  it("renames the duty type and the automatic group only where the club kept the old name", async () => {
    await upgradeFrom("202610202300_youth-referees_rename.sql");
    expect(await one("SELECT name FROM duty_types WHERE code = 'referee'")).toEqual({ name: "KiHaSL/JuHaSL" });
    await exec("INSERT INTO teams (name, age_class_code, kind, auto_members) VALUES ('KiHaSL/JuHaSL', 'F', 'group', 'referees')");
    await exec("INSERT INTO teams (name, age_class_code, kind) VALUES ('KiHaSL-Treff', 'F', 'group')");
    await migrateRest();
    expect(await one("SELECT name FROM duty_types WHERE code = 'referee'")).toEqual({ name: "Jugendschiedsrichter" });
    expect((await rows<{ name: string }>("SELECT name FROM teams ORDER BY name")).map((t) => t.name)).toEqual(["Jugendschiedsrichter", "KiHaSL-Treff"]);
  });

  it("keeps a name the club changed, and does not clash with an existing team of the new name", async () => {
    await upgradeFrom("202610202300_youth-referees_rename.sql");
    await exec("UPDATE duty_types SET name = 'Schiri Jugend' WHERE code = 'referee'");
    await exec("INSERT INTO teams (name, age_class_code, kind) VALUES ('Jugendschiedsrichter', 'F', 'group')");
    await exec("INSERT INTO teams (name, age_class_code, kind, auto_members) VALUES ('KiHaSL/JuHaSL', 'F', 'group', 'referees')");
    await migrateRest();
    expect(await one("SELECT name FROM duty_types WHERE code = 'referee'")).toEqual({ name: "Schiri Jugend" });
    expect(await rows("SELECT name FROM teams WHERE auto_members = 'referees'")).toEqual([{ name: "KiHaSL/JuHaSL" }]);
  });
});
