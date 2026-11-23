// Fans module: following teams, what fans may see, the push for games moved or cancelled at short notice, the
// calendar, cleanup and the upgrade. Invented names only.
import { env, exports } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_MODULES } from "../../../shared/modules";
import { api, eventIn, exec, freshDb, guardian, loginAs, member, migrateRest, one, person, rows, season, team, upgradeFrom } from "../../../test/helpers";
import { saveClub } from "../../../worker/domain/club";
import type { PushJob } from "../../../worker/domain/notify";
import { addDays, todayLocal } from "../../../worker/lib/time";
import { EXPORT_TABLES } from "../../../worker/routes/season";
import type { FansPage, FollowView } from "../types";
import { notifyFans } from "../worker/domain";

let pushes: PushJob[] = [];

async function accountOf(personId: number): Promise<number> {
  await loginAs(personId);
  return (await one<{ id: number }>("SELECT id FROM accounts WHERE person_id = ?", personId)).id;
}

async function withDevice(personId: number): Promise<number> {
  const account = await accountOf(personId);
  await exec("INSERT INTO push_subscriptions (account_id, endpoint, p256dh, auth) VALUES (?, ?, 'x', 'y')", account, `https://push.example/${account}`);
  return account;
}

/** A game of the team in n days, home or away against an invented opponent. */
async function game(teamId: number, days: number, opts: { home?: boolean | null; time?: string } = {}) {
  const id = await eventIn(teamId, days, { kind: "game", time: opts.time ?? "15:00" });
  const home = opts.home === undefined ? true : opts.home;
  await exec(
    "UPDATE events SET is_home = ?, home_team = ?, guest_team = ?, meeting_point = 'Eingang Nord', meeting_time = '14:00' WHERE id = ?",
    home == null ? null : home ? 1 : 0,
    home === false ? "TSV Beispieldorf" : "SV Musterstadt",
    home === false ? "SV Musterstadt" : "TSV Beispieldorf",
    id,
  );
  return id;
}

const fansOn = () => saveClub(env.DB, { modules: { ...DEFAULT_MODULES, fans: true } });

async function page(cookie: string, query = "teams=all&fans.games=1"): Promise<FansPage | undefined> {
  const res = await api(`/events?limit=20&${query}`, { cookie });
  expect(res.status).toBe(200);
  return res.body.modules.fans;
}

let wd: number;
let wc: number;
let lina: number;
let coachUwe: number;
let fanFrida: number;
let fridaCookie: string;

beforeEach(async () => {
  await freshDb();
  await season();
  await fansOn();
  wd = await team("wD", "wD");
  wc = await team("wC", "wC");
  lina = await person("Lina", { lastName: "Kowalczyk" });
  coachUwe = await person("Uwe");
  fanFrida = await person("Frida");
  await member(lina, wc);
  await member(coachUwe, wc, "coach");
  // Frida plays in the wD and follows the wC
  await member(fanFrida, wd);
  fridaCookie = await loginAs(fanFrida);
  pushes = [];
  vi.spyOn(env.PUSH_QUEUE, "sendBatch").mockImplementation(async (jobs) => {
    pushes.push(...[...jobs].map((j) => j.body as PushJob));
    return { metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } } } as unknown as QueueSendBatchResponse;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("following teams", () => {
  it("answers only while the club has the module on", async () => {
    await saveClub(env.DB, { modules: { ...DEFAULT_MODULES, fans: false } });
    expect((await api("/fans/follows", { cookie: fridaCookie })).status).toBe(404);
    await fansOn();
    expect((await api("/fans/follows", { cookie: fridaCookie })).status).toBe(200);
  });

  it("own teams are fixed, groups are not offered, nobody else sees whom someone follows", async () => {
    const group = await one<{ id: number }>("INSERT INTO teams (name, age_class_code, kind) VALUES ('Schiris', '', 'group') RETURNING id");
    const view = (await api<FollowView>("/fans/follows", { cookie: fridaCookie })).body;
    expect(view.teams.map((tm) => [tm.name, tm.own, tm.following])).toEqual([
      ["wC", false, false],
      ["wD", true, false],
    ]);
    expect(view).toMatchObject({ homeOnly: false, calendar: false });

    const own = await api(`/fans/follows/${wd}`, { method: "PUT", cookie: fridaCookie, body: { follow: true } });
    expect(own.status).toBe(400);
    expect(own.body.error.code).toBe("own_team");
    expect((await api(`/fans/follows/${group.id}`, { method: "PUT", cookie: fridaCookie, body: { follow: true } })).status).toBe(404);

    const res = await api<FollowView>(`/fans/follows/${wc}`, { method: "PUT", cookie: fridaCookie, body: { follow: true } });
    expect(res.body.teams.find((tm) => tm.id === wc)?.following).toBe(true);
    // Lina (another account) sees her own state only; there is no way to ask for someone else's
    const linaView = (await api<FollowView>("/fans/follows", { cookie: await loginAs(lina) })).body;
    expect(linaView.teams.every((tm) => !tm.following)).toBe(true);
  });

  it("a parent follows the children's teams only where parents are not involved", async () => {
    const mum = await person("Mara");
    await guardian(mum, lina);
    const cookie = await loginAs(mum);
    expect((await api(`/fans/follows/${wc}`, { method: "PUT", cookie, body: { follow: true } })).body.error.code).toBe("own_team");
    await exec("UPDATE teams SET parents_enabled = 0 WHERE id = ?", wc);
    expect((await api(`/fans/follows/${wc}`, { method: "PUT", cookie, body: { follow: true } })).status).toBe(200);
  });
});

describe("what fans see", () => {
  it("only game data of followed teams, no trainings, no names, no meeting point, no reason", async () => {
    const home = await game(wc, 2);
    const away = await game(wc, 3, { home: false });
    await eventIn(wc, 2, { kind: "training" });
    // A game of both teams is Frida's own game, listed as her event
    const shared = await game(wc, 4);
    await exec("INSERT INTO event_teams (event_id, team_id) VALUES (?, ?)", shared, wd);
    await exec("INSERT INTO responses (event_id, person_id, status, reason, responded_at) VALUES (?, ?, 'no', 'Zahnarzt', '2026-01-01T00:00:00Z')", home, lina);
    await exec("INSERT INTO nominations (event_id, person_id) VALUES (?, ?)", home, lina);
    await exec("UPDATE events SET cancelled_at = '2026-01-01T00:00:00Z', cancel_reason = 'Halle gesperrt', cancelled_by = ? WHERE id = ?", coachUwe, away);

    // Without following: no star, no games
    expect(await page(fridaCookie)).toBeUndefined();
    await api(`/fans/follows/${wc}`, { method: "PUT", cookie: fridaCookie, body: { follow: true } });

    const fans = (await page(fridaCookie))!;
    expect(fans.teams).toEqual([{ id: wc, name: "wC" }]);
    expect(fans.games.map((g) => g.id)).toEqual([home, away]);
    expect(fans.games[0]).toMatchObject({ kind: "game", isHome: true, following: true, cancelled: null, teams: [{ id: wc, name: "wC" }] });
    expect(fans.games[1]!.cancelled).toEqual({ at: "2026-01-01T00:00:00Z" });
    const text = JSON.stringify(fans);
    for (const secret of ["Lina", "Kowalczyk", "Uwe", "Zahnarzt", "Halle gesperrt", "Eingang Nord", "14:00"]) expect(text).not.toContain(secret);

    // The star off: only the followed teams for the button, no games
    expect((await page(fridaCookie, "teams=all"))!.games).toEqual([]);
    // The chip "Training" has no games
    expect((await page(fridaCookie, "teams=all&show=training&fans.games=1"))!.games).toEqual([]);
    // Own teams off, star on: the fan games still come
    expect((await page(fridaCookie, "teams=none&fans.games=1"))!.games.map((g) => g.id)).toEqual([home, away]);

    // Home games only
    await api("/fans/settings", { method: "PUT", cookie: fridaCookie, body: { homeOnly: true } });
    expect((await page(fridaCookie))!.games.map((g) => g.id)).toEqual([home]);
  });

  it("the page of a game: game data for every signed-in person, not for trainings or groups", async () => {
    const home = await game(wc, 2);
    const training = await eventIn(wc, 2, { kind: "training" });
    const res = await api(`/fans/games/${home}`, { cookie: fridaCookie });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: home, title: expect.stringContaining("TSV Beispieldorf"), following: false });
    expect(JSON.stringify(res.body)).not.toContain("Eingang Nord");
    expect((await api(`/fans/games/${training}`, { cookie: fridaCookie })).status).toBe(404);
    const group = await one<{ id: number }>("INSERT INTO teams (name, age_class_code, kind) VALUES ('Schiris', '', 'group') RETURNING id");
    const groupGame = await game(group.id, 2);
    expect((await api(`/fans/games/${groupGame}`, { cookie: fridaCookie })).status).toBe(404);
    expect((await api(`/fans/games/${home}`)).status).toBe(401);
  });

  it("the view of all games of the club: every other team, also without following, home only does not apply", async () => {
    const wcAway = await game(wc, 2, { home: false });
    const wdGame = await game(wd, 3);
    await api("/fans/settings", { method: "PUT", cookie: fridaCookie, body: { homeOnly: true } });
    const res = await api(`/events?limit=20&teams=all&show=game&fans.club=1`, { cookie: fridaCookie });
    // Own games as events, the others as fan games
    expect(res.body.events.map((e: { id: number }) => e.id)).toEqual([wdGame]);
    expect((res.body.modules.fans as FansPage).games.map((g) => [g.id, g.following])).toEqual([[wcAway, false]]);
  });

  it("stays inside the page's window and says where it stopped", async () => {
    await api(`/fans/follows/${wc}`, { method: "PUT", cookie: fridaCookie, body: { follow: true } });
    const own = [await eventIn(wd, 1), await eventIn(wd, 2), await eventIn(wd, 6)];
    const fanGames = [await game(wc, 1), await game(wc, 4), await game(wc, 8)];
    // Two own events per page: the page ends on day 2, the games after it come with the next page
    const res = await api(`/events?limit=2&teams=all&fans.games=1`, { cookie: fridaCookie });
    expect(res.body.events.map((e: { id: number }) => e.id)).toEqual(own.slice(0, 2));
    expect((res.body.modules.fans as FansPage).games.map((g) => g.id)).toEqual([fanGames[0]]);
    // Own teams off: the module pages itself, whole days
    const many = await api(`/events?limit=1&teams=none&fans.games=1`, { cookie: fridaCookie });
    expect((many.body.modules.fans as FansPage).games.map((g) => g.id)).toEqual([fanGames[0]]);
    expect((many.body.modules.fans as FansPage).more).toBe(`${addDays(todayLocal(), 1)}T15:00`);
  });
});

describe("push for games moved or cancelled at short notice", () => {
  let fridaAccount: number;

  beforeEach(async () => {
    fridaAccount = await withDevice(fanFrida);
    await exec("INSERT INTO fan_follows (account_id, team_id) VALUES (?, ?)", fridaAccount, wc);
    await withDevice(lina);
  });

  const recipientsOf = () => pushes.filter((p) => p.payload.url.startsWith("/spiel/")).flatMap((p) => p.accountIds);

  it("a cancellation at most 72 hours before kick-off reaches the fans, without the reason; the team gets its own push", async () => {
    const soon = await game(wc, 1);
    const later = await game(wc, 5);
    const coachCookie = await loginAs(coachUwe);
    expect((await api(`/events/${soon}/cancel`, { cookie: coachCookie, body: { reason: "Halle gesperrt" } })).status).toBe(200);
    expect(recipientsOf()).toEqual([fridaAccount]);
    const fanPush = pushes.find((p) => p.payload.url === `/spiel/${soon}`)!;
    expect(fanPush.payload.title).toContain("Findet nicht statt");
    expect(fanPush.payload.body).not.toContain("Halle gesperrt");
    // Lina plays in the team: only the team's push, with the event page
    expect(pushes.find((p) => p.payload.url === `/termine/${soon}`)?.accountIds).toContain(await accountOf(lina));

    pushes = [];
    expect((await api(`/events/${later}/cancel`, { cookie: coachCookie, body: { reason: "Halle gesperrt" } })).status).toBe(200);
    expect(recipientsOf()).toEqual([]);
  });

  it("not to members of the team or parents there, not with the topic off, home games only means home games", async () => {
    const away = await game(wc, 1, { home: false });
    const change = (eventId: number) => ({ change: "cancelled" as const, eventId, kind: "game" as const, teamIds: [wc], before: "", startsAt: "", exclude: [] });
    const at = async (eventId: number) => {
      const row = await one<{ starts_at: string }>("SELECT starts_at FROM events WHERE id = ?", eventId);
      return { ...change(eventId), before: row.starts_at, startsAt: row.starts_at };
    };
    // A parent of a player who follows the team from before
    const mum = await person("Mara");
    await guardian(mum, lina);
    const mumAccount = await withDevice(mum);
    await exec("INSERT INTO fan_follows (account_id, team_id) VALUES (?, ?)", mumAccount, wc);
    // Frida joins the team later: her follow stays, but she gets the team's push
    const kim = await person("Kim");
    const kimAccount = await withDevice(kim);
    await exec("INSERT INTO fan_follows (account_id, team_id) VALUES (?, ?)", kimAccount, wc);
    await member(kim, wc, "helper");

    expect(await notifyFans(env, await at(away))).toBe(1);
    expect(recipientsOf()).toEqual([fridaAccount]);

    // Topic off
    pushes = [];
    await exec("INSERT INTO notification_settings (account_id, person_id, topic, enabled) VALUES (?, ?, 'fans', 0)", fridaAccount, fanFrida);
    expect(await notifyFans(env, await at(away))).toBe(0);
    await exec("DELETE FROM notification_settings");

    // Home games only: not for the away game, but for a home game
    await exec("INSERT INTO fan_home_only (account_id) VALUES (?)", fridaAccount);
    expect(await notifyFans(env, await at(away))).toBe(0);
    const home = await game(wc, 2);
    expect(await notifyFans(env, await at(home))).toBe(1);

    // Parents not involved in the team: the mother is a fan like anyone else
    await exec("UPDATE teams SET parents_enabled = 0 WHERE id = ?", wc);
    pushes = [];
    await notifyFans(env, await at(home));
    expect(recipientsOf().sort()).toEqual([fridaAccount, mumAccount].sort());
  });

  it("a game moved: the earlier start that is still ahead counts, nothing for past or cancelled games", async () => {
    const id = await game(wc, 10);
    const start = await one<{ starts_at: string }>("SELECT starts_at FROM events WHERE id = ?", id);
    const soon = `${addDays(todayLocal(), 1)}T15:00`;
    // Moved from in ten days to tomorrow: short notice
    await exec("UPDATE events SET starts_at = ? WHERE id = ?", soon, id);
    const moved = { change: "moved" as const, eventId: id, kind: "game" as const, teamIds: [wc], before: start.starts_at, startsAt: soon, exclude: [] };
    expect(await notifyFans(env, moved)).toBe(1);
    expect(pushes[0]!.payload).toMatchObject({ title: expect.stringContaining("Spiel verlegt"), url: `/spiel/${id}` });
    // Moved from tomorrow to in ten days: also short notice (the old start was close)
    expect(await notifyFans(env, { ...moved, before: soon, startsAt: start.starts_at })).toBe(1);
    // Both far ahead: none
    expect(await notifyFans(env, { ...moved, before: start.starts_at, startsAt: `${addDays(todayLocal(), 12)}T15:00` })).toBe(0);
    // A training, or a game that does not take place
    expect(await notifyFans(env, { ...moved, kind: "training" })).toBe(0);
    await exec("UPDATE events SET cancelled_at = '2026-01-01T00:00:00Z' WHERE id = ?", id);
    expect(await notifyFans(env, moved)).toBe(0);
  });

  it("the topic is offered for oneself, not per child", async () => {
    const kid = await person("Ida");
    await member(kid, wd);
    await guardian(fanFrida, kid);
    const res = await api("/me/notifications", { cookie: fridaCookie });
    const byPerson = new Map(res.body.persons.map((p: { person: { id: number }; topics: Record<string, boolean> }) => [p.person.id, p.topics]));
    expect((byPerson.get(fanFrida) as Record<string, boolean>).fans).toBe(true);
    expect("fans" in (byPerson.get(kid) as Record<string, boolean>)).toBe(false);
  });
});

describe("personal calendar", () => {
  async function feed(cookie: string): Promise<string> {
    const { url } = (await api("/profile/calendar-token", { cookie, body: {} })).body;
    const res = await exports.default.fetch(new Request(`http://localhost:5173${new URL(url).pathname}`));
    expect(res.status).toBe(200);
    return res.text();
  }

  it("games as a fan only when ticked, game data only, same UID as an event, home games only applies", async () => {
    const home = await game(wc, 2);
    const away = await game(wc, 3, { home: false });
    await api(`/fans/follows/${wc}`, { method: "PUT", cookie: fridaCookie, body: { follow: true } });
    // Off by default, also with a link made before
    let ics = await feed(fridaCookie);
    expect(ics).not.toContain(`event-${home}@`);

    expect((await api<FollowView>("/fans/settings", { method: "PUT", cookie: fridaCookie, body: { calendar: true } })).body.calendar).toBe(true);
    ics = await feed(fridaCookie);
    expect(ics).toMatch(new RegExp(`UID:event-${home}@[^\\r]+\\.kabine`));
    expect(ics).toContain(`event-${away}@`);
    expect(ics).toContain("Du folgst wC als Fan.");
    expect(ics).not.toContain("Eingang Nord");

    await api("/fans/settings", { method: "PUT", cookie: fridaCookie, body: { homeOnly: true } });
    ics = await feed(fridaCookie);
    expect(ics).toContain(`event-${home}@`);
    expect(ics).not.toContain(`event-${away}@`);

    // Module off: no fan games in the feed
    await saveClub(env.DB, { modules: { ...DEFAULT_MODULES, fans: false } });
    expect(await feed(fridaCookie)).not.toContain(`event-${home}@`);
  });
});

describe("cleanup, export and upgrade", () => {
  it("someone who leaves the club loses the follows; the export has follows and home only, not the calendar choice", async () => {
    const account = await accountOf(fanFrida);
    await exec("INSERT INTO fan_follows (account_id, team_id) VALUES (?, ?)", account, wc);
    await exec("INSERT INTO fan_home_only (account_id) VALUES (?)", account);
    await exec("INSERT INTO fan_calendar (account_id) VALUES (?)", account);
    expect(EXPORT_TABLES).toEqual(expect.arrayContaining(["fan_follows", "fan_home_only"]));
    expect(EXPORT_TABLES).not.toContain("fan_calendar");

    const admin = await person("Ada", { admin: true });
    const res = await api(`/persons/${fanFrida}/leave`, { method: "POST", cookie: await loginAs(admin), body: {} });
    expect(res.status).toBe(200);
    for (const table of ["fan_follows", "fan_home_only", "fan_calendar"]) expect(await rows(`SELECT * FROM ${table}`), table).toEqual([]);
  });

  it("follows survive the season change; a deleted team takes them along", async () => {
    const account = await accountOf(fanFrida);
    await exec("INSERT INTO fan_follows (account_id, team_id) VALUES (?, ?)", account, wc);
    await exec("DELETE FROM teams WHERE id = ?", wc);
    expect(await rows("SELECT * FROM fan_follows")).toEqual([]);
  });

  it("upgrade: existing calendar links keep showing no fan games", async () => {
    await upgradeFrom("202611230300_fans_follows.sql");
    await season();
    const p = await person("Pia");
    await loginAs(p);
    await exec("INSERT INTO calendar_tokens (account_id, token_hash) SELECT id, 'h' FROM accounts WHERE person_id = ?", p);
    await migrateRest();
    expect(await rows("SELECT * FROM fan_calendar")).toEqual([]);
    expect(await rows("SELECT * FROM fan_follows")).toEqual([]);
    expect(await one<{ n: number }>("SELECT count(*) AS n FROM calendar_tokens")).toEqual({ n: 1 });
  });
});
