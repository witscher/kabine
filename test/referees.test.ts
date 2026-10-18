// KiHaSL/JuHaSL: Rolle per Link oder Admin, Dienst bei Jugend-Heimspielen F–C. Namen erfunden.
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendDutyNotifications } from "../worker/domain/duty-notify";
import { type MailMessage, mailer } from "../worker/domain/email-login";
import type { PushJob } from "../worker/domain/notify";
import { localToInstant, todayLocal } from "../worker/lib/time";
import { api, eventIn, exec, freshDb, guardian, loginAs, member, one, person, rows, season, team } from "./helpers";

let wd: number;
let wb: number;
let mini: number;
let admin: number;
let lena: number; // Spielerin wB, wird KiHaSL
let kim: number; // Kind der Mutter, wird KiHaSL
let mona: number; // Mutter von Kim
let other: number; // Spieler ohne Rolle
let adminCookie: string;
let lenaCookie: string;
let monaCookie: string;
let otherCookie: string;
let homeD: number;

async function game(teamId: number, days: number, isHome: 0 | 1) {
  const id = await eventIn(teamId, days, { kind: "game", time: "11:00" });
  await exec("UPDATE events SET external_ref = 'handball4all:g' || id, is_home = ?, home_team = 'SV Musterstadt', guest_team = 'SG Gegner' WHERE id = ?", isHome, id);
  return id;
}

async function link(): Promise<string> {
  const res = await api("/admin/referee-links", { cookie: adminCookie, body: {} });
  expect(res.status).toBe(201);
  return String(res.body.url).split("#")[1]!;
}

beforeEach(async () => {
  await freshDb();
  await season();
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

describe("KiHaSL/JuHaSL", () => {
  it("Link: angemeldet für sich oder ein eigenes Kind, nicht für Fremde", async () => {
    const token = await link();
    const info = await api("/referee/info", { cookie: monaCookie, body: { token } });
    expect(info.body.candidates.map((c: any) => c.personId)).toEqual([mona, kim]);
    expect((await api("/referee/accept", { cookie: monaCookie, body: { token, personId: lena } })).status).toBe(400);
    expect((await api("/referee/accept", { cookie: monaCookie, body: { token, personId: kim } })).status).toBe(200);
    expect((await api("/referee/accept", { cookie: lenaCookie, body: { token, personId: lena } })).status).toBe(200);
    expect(await rows("SELECT person_id FROM referees ORDER BY person_id")).toEqual([{ person_id: lena }, { person_id: kim }].sort((a, b) => a.person_id - b.person_id));
    // Nicht angemeldet: nur der Hinweis, keine Freischaltung
    expect((await api("/referee/info", { body: { token } })).body).toMatchObject({ loggedIn: false, candidates: [] });
    expect((await api("/referee/accept", { body: { token, personId: lena } })).status).toBe(401);
    expect((await api("/session", { cookie: monaCookie })).body.me.referee).toBe(true);
    expect((await api("/session", { cookie: otherCookie })).body.me.referee).toBe(false);
  });

  it("zurückgezogene und abgelaufene Links gelten nicht", async () => {
    const token = await link();
    const { id } = await one<{ id: number }>("SELECT id FROM referee_links");
    await api(`/admin/referee-links/${id}`, { method: "DELETE", cookie: adminCookie });
    expect((await api("/referee/accept", { cookie: lenaCookie, body: { token, personId: lena } })).body.error.code).toBe("link_revoked");
    const fresh = await link();
    await exec("UPDATE referee_links SET expires_at = '2000-01-01T00:00:00.000Z' WHERE revoked_at IS NULL");
    expect((await api("/referee/accept", { cookie: lenaCookie, body: { token: fresh, personId: lena } })).body.error.code).toBe("link_expired");
  });

  it("Admin setzt und entfernt die Rolle direkt, andere dürfen das nicht", async () => {
    expect((await api(`/admin/referees/${other}`, { method: "PUT", cookie: lenaCookie })).status).toBe(403);
    expect((await api(`/admin/referees/${other}`, { method: "PUT", cookie: adminCookie })).status).toBe(200);
    const list = await api("/admin/persons", { cookie: adminCookie });
    expect(list.body.persons.find((p: any) => p.person.id === other).isReferee).toBe(true);
    await api(`/admin/referees/${other}`, { method: "DELETE", cookie: adminCookie });
    expect(await rows("SELECT * FROM referees")).toEqual([]);
  });

  it("Dienst nur bei Heimspielen F–C, auch ohne Helferplan, und nur mit Rolle", async () => {
    await exec("INSERT INTO referees (person_id) VALUES (?), (?)", lena, kim);
    const awayD = await game(wd, 5, 0);
    await game(wb, 6, 1); // B-Jugend: kein KiHaSL
    await game(mini, 7, 1); // Minis: kein KiHaSL
    const list = await api("/duties/referee", { cookie: lenaCookie });
    expect(list.status).toBe(200);
    expect(list.body.games.map((g: any) => g.id)).toEqual([homeD]);
    expect(list.body.games[0]).toMatchObject({ teamName: "wD", blocks: [{ referee: true, label: "KiHaSL/JuHaSL", total: 1, entries: [] }] });
    const blockId = list.body.games[0].blocks[0].id;
    // Auswärtsspiel hat keinen KiHaSL-Block
    expect(await rows("SELECT * FROM event_duties WHERE event_id = ?", awayD)).toEqual([]);

    expect((await api("/duties", { cookie: otherCookie, body: { blockId } })).body.error.code).toBe("not_referee");
    // Letzter Platz gleichzeitig: Lena und Mona (für Kim), nur eine gewinnt
    const results = (
      await Promise.all([
        api("/duties", { cookie: lenaCookie, body: { blockId } }),
        api("/duties", { cookie: monaCookie, body: { blockId, childId: kim } }),
      ])
    )
      .map((r) => r.status)
      .sort();
    expect(results).toEqual([201, 409]);
  });

  it("Terminübersicht: eigener KiHaSL-Dienst sichtbar, offene Plätze ohne rote Marke, fremde Spiele unsichtbar", async () => {
    await exec("INSERT INTO referees (person_id) VALUES (?)", kim);
    const events = async (cookie: string) => (await api("/events", { cookie })).body.events.filter((e: any) => e.kind === "game");
    // Vor dem Eintragen: wD-Spiel gehört nicht zu Monas Mannschaften
    expect((await events(monaCookie)).map((e: any) => e.id)).not.toContain(homeD);
    const blockId = (await api("/duties/referee", { cookie: monaCookie })).body.games[0].blocks[0].id;
    expect((await api("/duties", { cookie: monaCookie, body: { blockId, childId: kim } })).status).toBe(201);
    const game = (await events(monaCookie)).find((e: any) => e.id === homeD);
    expect(game.myDuties).toEqual([{ dutyTypeId: 5, referee: true, label: "KiHaSL/JuHaSL", child: "Kim", mine: false }]);
    expect(game.helpersNeeded).toBe(0);
    const kimCookie = await loginAs(kim);
    const own = (await events(kimCookie)).find((e: any) => e.id === homeD);
    expect(own.myDuties).toEqual([{ dutyTypeId: 5, referee: true, label: "KiHaSL/JuHaSL", child: null, mine: true }]);
    // Details ohne Teilnehmerliste
    expect((await api(`/events/${homeD}`, { cookie: kimCookie })).body.participants).toBeNull();
    // Austragen durch die Mutter
    const entry = await one<{ id: number }>("SELECT id FROM duties WHERE duty_type_id = 5");
    expect((await api(`/duties/${entry.id}`, { method: "DELETE", cookie: monaCookie })).status).toBe(200);
  });

  it("Admin-Sicht referee: ohne Admin, mit Rolle", async () => {
    const me = (await api("/session", { cookie: `${adminCookie}; kabine_view=referee` })).body.me;
    expect(me).toMatchObject({ isAdmin: false, referee: true, viewAs: { mode: "referee", readOnly: false } });
    expect((await api("/duties/referee", { cookie: `${adminCookie}; kabine_view=referee` })).status).toBe(200);
  });
});

describe("KiHaSL/JuHaSL gesucht", () => {
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

  it("3 Tage vorher an alle mit Rolle bzw. ihre Eltern, die noch nicht eingetragen sind, nur einmal", async () => {
    await exec("INSERT INTO referees (person_id) VALUES (?), (?)", lena, kim);
    await exec("INSERT INTO push_subscriptions (account_id, endpoint, p256dh, auth) SELECT id, 'https://push.example/' || id, 'k', 'a' FROM accounts");
    const soon = await game(wd, 3, 1);
    expect(soon).toBeGreaterThan(0);
    const at9 = localToInstant(`${todayLocal()}T09:00`);
    await sendDutyNotifications(testEnv(), at9);
    const titles = pushes.filter((p) => p.payload.title.startsWith("KiHaSL/JuHaSL gesucht"));
    const accounts = (await rows<{ id: number; person_id: number }>("SELECT id, person_id FROM accounts")).reduce<Record<number, number>>(
      (m, a) => ({ ...m, [a.id]: a.person_id }),
      {},
    );
    const people = titles.flatMap((p) => p.accountIds.map((a) => accounts[a]));
    // Lena selbst und Mona für Kim (Kim hat keinen eigenen Zugang); nicht Otto, nicht der Admin
    expect(new Set(people)).toEqual(new Set([lena, mona]));
    pushes = [];
    await sendDutyNotifications(testEnv(), at9 + 3_600_000);
    expect(pushes.filter((p) => p.payload.title.startsWith("KiHaSL/JuHaSL gesucht"))).toEqual([]);
  });
});
