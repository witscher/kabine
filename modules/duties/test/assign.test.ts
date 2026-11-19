// Dienstarten mit Schaltern: „Vergibt der Trainer“, „Nur Erwachsene“, „Helfer gesucht schicken“. Alle Namen erfunden.
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { PushJob } from "../../../worker/domain/notify";
import { localToInstant, todayLocal } from "../../../worker/lib/time";
import { api, eventIn, exec, freshDb, guardian, loginAs, member, one, person, season, team } from "../../../test/helpers";
import { sendDutyAssigned, sendDutyNotifications } from "../worker/notify";

let wd: number;
let damen: number;
let tara: number;
let kim: number;
let lea: number;
let mona: number;
let dana: number;
let jule: number;
let taraCookie: string;
let monaCookie: string;
let adminCookie: string;
let home: number;

let pushes: PushJob[] = [];
const testEnv = () =>
  ({ ...env, MAIL_FROM: "no-reply@example.org", PUSH_QUEUE: { sendBatch: async (jobs: { body: PushJob }[]) => void pushes.push(...jobs.map((j) => j.body)) } }) as unknown as Env;

async function withDevice(personId: number) {
  await loginAs(personId);
  const { id } = await one<{ id: number }>("SELECT id FROM accounts WHERE person_id = ?", personId);
  await exec("INSERT OR IGNORE INTO push_subscriptions (account_id, endpoint, p256dh, auth) VALUES (?, ?, 'x', 'y')", id, `https://push.example/${id}`);
  return id;
}

beforeEach(async () => {
  pushes = [];
  await freshDb();
  await season();
  wd = await team("wD", "wD");
  damen = await team("Damen", "F");
  await exec("UPDATE teams SET helper_plan = 1 WHERE id = ?", wd);
  await exec("UPDATE teams SET parents_enabled = 0 WHERE id = ?", damen);
  tara = await person("Tara", { lastName: "Trainer" });
  kim = await person("Kim", { lastName: "Kaiser", birthYear: 2014 });
  lea = await person("Lea", { lastName: "Lang", birthYear: 2014 });
  mona = await person("Mona", { lastName: "Kaiser" });
  dana = await person("Dana", { lastName: "Dorn", birthYear: 1995 });
  // 17 Jahre: spielt bei den Damen, ist aber minderjährig
  jule = await person("Jule", { lastName: "Jung", birthYear: Number(todayLocal().slice(0, 4)) - 17 });
  await member(tara, wd, "coach");
  await member(kim, wd);
  await member(lea, wd);
  await guardian(mona, kim);
  await member(dana, damen);
  await member(jule, damen);
  taraCookie = await loginAs(tara);
  monaCookie = await loginAs(mona);
  adminCookie = await loginAs(await person("Ada", { admin: true }));
  home = await eventIn(wd, 5, { kind: "game", time: "14:00" });
  await exec("UPDATE events SET external_ref = 'handball4all:g' || id, is_home = 1, home_team = 'SV Musterstadt', guest_team = 'SG Gegner' WHERE id = ?", home);
});

async function dutyType(body: Record<string, unknown>) {
  const res = await api("/admin/duty-types", {
    cookie: adminCookie,
    body: { mode: "onsite", whoParents: true, whoPlayers: false, whoCoaches: false, noteAllowed: false, needsSkill: false, ...body },
  });
  expect(res.status).toBe(201);
  return res.body.id as number;
}

async function blockAt(eventId: number, typeId: number, extra: Record<string, unknown> = {}) {
  const date = (await one<{ starts_at: string }>("SELECT starts_at FROM events WHERE id = ?", eventId)).starts_at.slice(0, 10);
  const res = await api(`/duties/events/${eventId}/blocks`, { cookie: adminCookie, body: { dutyTypeId: typeId, startsAt: `${date}T13:00`, endsAt: `${date}T16:00`, slots: 2, ...extra } });
  expect(res.status).toBe(201);
  return res.body.id as number;
}

const viewOf = async (cookie: string, block: number, teamId = wd) =>
  (await api(`/duties?teamId=${teamId}`, { cookie })).body.games.flatMap((g: any) => g.blocks).find((b: any) => b.id === block);

describe("Dienst, den der Trainer vergibt", () => {
  it("niemand trägt sich selbst ein; der Trainer teilt im Rahmen von „Wer hilft“ ein", async () => {
    const typeId = await dutyType({ name: "Hallendienst", assignOnly: true });
    expect((await api("/duty-types", { cookie: taraCookie })).body.types.find((x: any) => x.id === typeId)).toMatchObject({ assignOnly: true, notifyOpen: true, adultsOnly: false });
    const block = await blockAt(home, typeId);
    // Eltern sehen den Dienst, aber ohne „Eintragen“
    expect(await viewOf(monaCookie, block)).toMatchObject({ assignOnly: true, roles: [] });
    const self = await api("/duties", { cookie: monaCookie, body: { blockId: block } });
    expect(self.status).toBe(403);
    expect(self.body.error.code).toBe("assign_only");
    // Die Auswahl zeigt nur, wer zu „Wer hilft“ passt (hier Eltern): Mona, nicht die Spielerin Lea
    const people = (await api(`/duties/events/${home}/people?block=${block}`, { cookie: taraCookie })).body.people.map((p: any) => p.personId);
    expect(people).toContain(mona);
    expect(people).not.toContain(lea);
    // Auch die Suche im ganzen Verein hält sich daran
    const found = (await api(`/duties/events/${home}/people/search`, { cookie: taraCookie, body: { q: "le", blockId: block } })).body.people;
    expect(found).toEqual([]);
    // Ohne Block wie bisher alle der Mannschaft
    expect((await api(`/duties/events/${home}/people`, { cookie: taraCookie })).body.people.map((p: any) => p.personId)).toContain(lea);
    const wrong = await api("/duties", { cookie: taraCookie, body: { blockId: block, onBehalfPersonId: lea } });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.code).toBe("not_in_who");
    expect((await api("/duties", { cookie: taraCookie, body: { blockId: block, onBehalfPersonId: mona, childId: kim } })).status).toBe(201);
    // Der Trainer kann sich auch selbst eintragen; Mona sieht ihren Eintrag und trägt sich aus
    expect((await viewOf(taraCookie, block)).roles).toHaveLength(1);
    const entry = (await viewOf(monaCookie, block)).entries[0];
    expect(entry).toMatchObject({ mine: true });
    expect((await api(`/duties/${entry.id}`, { method: "DELETE", cookie: monaCookie })).status).toBe(200);
  });

  it("die eingeteilte Person (bei Kindern auch die Eltern) bekommt sofort Bescheid", async () => {
    const typeId = await dutyType({ name: "Hallendienst", assignOnly: true, whoParents: false, whoPlayers: true });
    const block = await blockAt(home, typeId);
    const monaAccount = await withDevice(mona);
    const kimAccount = await withDevice(kim);
    expect((await api("/duties", { cookie: taraCookie, body: { blockId: block, onBehalfPersonId: kim } })).status).toBe(201);
    await sendDutyAssigned(testEnv(), { blockId: block, personId: kim, byName: "Tara" });
    const assigned = pushes.filter((p) => p.payload.title === "Eingeteilt: Hallendienst");
    expect(assigned.flatMap((p) => p.accountIds).sort()).toEqual([monaAccount, kimAccount].sort());
    expect(assigned[0]!.payload.body).toContain("13:00–16:00. Eingeteilt von Tara");
    expect(assigned[0]!.payload.url).toBe(`/helfer?mannschaft=${wd}&spiel=${home}`);
  });

  it("zählt nicht als „Helfer benötigt“ und bekommt kein „Helfer gesucht“", async () => {
    const typeId = await dutyType({ name: "Hallendienst", assignOnly: true });
    // Nur dieser Dienst: Blöcke der Vorlage als erzeugt markieren
    await exec("UPDATE events SET duties_generated = 3, duties_anchor = starts_at WHERE id = ?", home);
    await blockAt(home, typeId);
    const needed = async () => (await api("/events", { cookie: monaCookie })).body.events.find((e: any) => e.id === home).helpersNeeded;
    expect(await needed()).toBe(0);
    await withDevice(mona);
    const in3 = await eventIn(wd, 3, { kind: "special", title: "Sommerfest", time: "14:00" });
    await blockAt(in3, typeId);
    await sendDutyNotifications(testEnv(), localToInstant(`${todayLocal()}T09:00`));
    expect(pushes.filter((p) => p.payload.title.includes("gesucht"))).toEqual([]);
    // Gegenprobe: ohne „Vergibt der Trainer“ zählt der Dienst
    await exec("UPDATE duty_types SET assign_only = 0 WHERE id = ?", typeId);
    expect(await needed()).toBe(2);
  });
});

describe("Nur Erwachsene", () => {
  it("Minderjährige laut Geburtsjahr tragen sich nicht ein und werden nicht eingeteilt; ohne Geburtsjahr erwachsen", async () => {
    const typeId = await dutyType({ name: "Ordner", whoParents: false, whoPlayers: true, adultsOnly: true });
    const g = await eventIn(damen, 6, { kind: "special", title: "Hallenfest", time: "14:00" });
    const block = await blockAt(g, typeId);
    const juleCookie = await loginAs(jule);
    const danaCookie = await loginAs(dana);
    const view = async (cookie: string) => (await api(`/duties?teamId=${damen}`, { cookie })).body.games.find((x: any) => x.id === g).blocks.find((b: any) => b.id === block);
    expect((await view(danaCookie)).roles).toEqual([{ childId: null, childName: null }]);
    expect((await view(juleCookie)).roles).toEqual([]);
    const no = await api("/duties", { cookie: juleCookie, body: { blockId: block } });
    expect([no.status, no.body.error.code]).toEqual([403, "adults_only"]);
    // Einteilen: Jule nicht, und die Auswahl lässt sie weg
    expect((await api("/duties", { cookie: adminCookie, body: { blockId: block, onBehalfPersonId: jule } })).body.error.code).toBe("adults_only");
    const people = (await api(`/duties/events/${g}/people?block=${block}`, { cookie: adminCookie })).body.people.map((p: any) => p.personId);
    expect(people).toContain(dana);
    expect(people).not.toContain(jule);
    expect((await api("/duties", { cookie: danaCookie, body: { blockId: block } })).status).toBe(201);
    // Eltern ohne Geburtsjahr zählen als erwachsen
    const eltern = await dutyType({ name: "Kasse", whoParents: true, adultsOnly: true });
    const kasse = await blockAt(home, eltern);
    expect((await viewOf(monaCookie, kasse)).roles).toEqual([{ childId: kim, childName: "Kim" }]);
  });

  it("„Helfer aus“ mit „Nur Erwachsene“: das Kind macht den Dienst und zählt", async () => {
    const typeId = await dutyType({ name: "Ordner", whoParents: false, adultsOnly: true });
    const block = await blockAt(home, typeId, { helperMode: "teams", helperTeams: [wd] });
    // Kim ist 12: Mona kann sie nicht eintragen, Aushelfen bleibt leer
    expect((await api("/duties/help-out", { cookie: monaCookie })).body.games).toEqual([]);
    expect((await api("/duties", { cookie: monaCookie, body: { blockId: block, childId: kim } })).status).toBe(403);
    expect((await api("/session", { cookie: monaCookie })).body.me.helpOut).toBe(false);
  });
});

describe("„Helfer gesucht“ schicken", () => {
  it("ausgeschaltet: keine Nachricht; mit einem gesuchten Dienst steht er im Titel; Helfer aus anderen Mannschaften bekommen sie auch", async () => {
    const kuchen = await dutyType({ name: "Kuchen", notifyOpen: false });
    const wischer = await dutyType({ name: "Wischer", whoParents: false });
    const in3 = await eventIn(damen, 3, { kind: "special", title: "Hallenfest", time: "14:00" });
    await exec("INSERT INTO event_teams (event_id, team_id) VALUES (?, ?)", in3, wd);
    await blockAt(in3, kuchen);
    const monaAccount = await withDevice(mona);
    await sendDutyNotifications(testEnv(), localToInstant(`${todayLocal()}T09:00`));
    expect(pushes.filter((p) => p.accountIds.includes(monaAccount) && p.payload.title.includes("gesucht"))).toEqual([]);
    // Ein Wischer-Block aus der wD bei einem Termin der Damen: Mona bekommt „Wischer gesucht“
    const other = await eventIn(damen, 3, { kind: "special", title: "Turnier", time: "10:00" });
    await blockAt(other, wischer, { helperMode: "teams", helperTeams: [wd] });
    pushes = [];
    await sendDutyNotifications(testEnv(), localToInstant(`${todayLocal()}T10:00`));
    const wanted = pushes.filter((p) => p.payload.title === "Wischer gesucht · Damen");
    expect(wanted.flatMap((p) => p.accountIds)).toEqual([monaAccount]);
    // Der Schalter an der Dienstart lässt sich ändern, ohne andere Angaben mitzuschicken
    expect(
      (await api(`/admin/duty-types/${kuchen}`, { method: "PATCH", cookie: adminCookie, body: { name: "Kuchen", mode: "onsite", whoParents: true, whoPlayers: false, whoCoaches: false, noteAllowed: false, needsSkill: false } }))
        .status,
    ).toBe(200);
    expect((await one<{ notify_open: number }>("SELECT notify_open FROM duty_types WHERE id = ?", kuchen)).notify_open).toBe(0);
  });
});
