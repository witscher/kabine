// Home game day: the day rule, who is involved, the push texts, sending once at the hour in club time, the page of the
// day, the card on home, the settings and the upgrade. Invented names only.
import { env, exports } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_MODULES } from "../../../shared/modules";
import { api, eventIn, exec, freshDb, guardian, hall, loginAs, member, migrateRest, one, person, rows, season, team, upgradeFrom } from "../../../test/helpers";
import { enterClubContext, saveClub } from "../../../worker/domain/club";
import type { PushJob } from "../../../worker/domain/notify";
import { withLocale } from "../../../worker/i18n";
import { cacheVersions } from "../../../worker/lib/cache";
import { addDays, localToInstant, todayLocal } from "../../../worker/lib/time";
import type { GamedayDetail, GamedayPage, GamedaySettingsView } from "../types";
import { gamedayPush, gamedaysOf, loadGameday, recipients, sendGamedayNotice } from "../worker/domain";

let pushes: PushJob[] = [];
let teams: number[];
let games: number[];
let date: string;
let lena: number;
let mona: number;
let carl: number;
let fritz: number;
let hanna: number;
let olga: number;

const modules = (extra: Partial<typeof DEFAULT_MODULES> = {}) => saveClub(env.DB, { modules: { ...DEFAULT_MODULES, gameday: true, fans: true, ...extra } }).then(() => enterClubContext(env.DB));

async function homeGame(teamId: number, days: number, time: string, guest: string, locationId?: number) {
  const id = await eventIn(teamId, days, { kind: "game", time, locationId });
  await exec("UPDATE events SET is_home = 1, home_team = 'SV Musterstadt', guest_team = ? WHERE id = ?", guest, id);
  return id;
}

async function accountOf(personId: number): Promise<number> {
  await loginAs(personId);
  return (await one<{ id: number }>("SELECT id FROM accounts WHERE person_id = ?", personId)).id;
}

async function dutyOn(personId: number, eventId: number, startsAt: string) {
  const type = await one<{ id: number }>("INSERT INTO duty_types (name, mode, who_parents, sort) VALUES ('Theke', 'onsite', 1, 9) RETURNING id");
  const block = await one<{ id: number }>(
    "INSERT INTO event_duties (event_id, duty_type_id, starts_at, ends_at, slots) VALUES (?, ?, ?, ?, 2) RETURNING id",
    eventId,
    type.id,
    startsAt,
    startsAt.replace(/T\d\d/, "T23"),
  );
  await exec("INSERT INTO duties (event_id, event_duty_id, duty_type_id, person_id) VALUES (?, ?, ?, ?)", eventId, block.id, type.id, personId);
}

/** The mascot route with a picture body (api() of the test helpers sends JSON only). */
function fetchMascot(method: "GET" | "PUT" | "DELETE", cookie: string, type?: string): Promise<Response> {
  const headers: Record<string, string> = { cookie };
  if (type) headers["content-type"] = type;
  return exports.default.fetch(
    new Request("http://localhost:5173/api/gameday/mascot", { method, headers, body: method === "PUT" ? new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]) : undefined }),
  );
}

async function day() {
  return loadGameday(env.DB, await cacheVersions(env.DB), date, 5);
}

beforeEach(async () => {
  await freshDb();
  await season();
  await modules();
  const halle = await hall("Sporthalle Am Park");
  teams = [];
  for (const [name, code] of [["wE", "wE"], ["wD", "wD"], ["mC", "wC"], ["wB", "wB"], ["Damen", "F"]] as const) teams.push(await team(name, code));
  date = addDays(todayLocal(), 2);
  games = [];
  const times = ["10:00", "11:30", "13:00", "14:30", "18:00"];
  for (let i = 0; i < teams.length; i++) games.push(await homeGame(teams[i]!, 2, times[i]!, `TSV Gast ${i}`, halle));
  lena = await person("Lena", { birthYear: 2015 });
  mona = await person("Mona");
  carl = await person("Carl");
  fritz = await person("Fritz");
  hanna = await person("Hanna");
  olga = await person("Olga");
  await member(lena, teams[1]!);
  await guardian(mona, lena);
  await member(carl, teams[2]!, "coach");
  for (const p of [lena, mona, carl, fritz, hanna, olga]) await loginAs(p);
  await exec("INSERT INTO fan_follows (account_id, team_id) VALUES (?, ?)", await accountOf(fritz), teams[4]);
  pushes = [];
  vi.spyOn(env.PUSH_QUEUE, "sendBatch").mockImplementation(async (jobs) => {
    pushes.push(...[...jobs].map((j) => j.body as PushJob));
    return { metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } } } as unknown as QueueSendBatchResponse;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("home game day: the day rule", () => {
  it("counts from the threshold of teams with a home game that takes place", async () => {
    expect((await day())?.teamIds).toHaveLength(5);
    expect(await loadGameday(env.DB, await cacheVersions(env.DB), date, 6)).toBeNull();
    expect((await day())?.hall).toBe("Sporthalle Am Park");
    // A cancellation bumps the cache version (migration trigger): the day no longer counts
    await exec("UPDATE events SET cancelled_at = '2026-01-01T00:00:00Z' WHERE id = ?", games[0]);
    expect(await day()).toBeNull();
  });

  it("away games, groups and two games of one team do not count as more teams", () => {
    const g = (id: number, teamId: number, time: string) => ({ id, teamId, startsAt: `2026-12-05T${time}`, hall: null });
    const list = [g(1, 1, "10:00"), g(2, 1, "12:00"), g(3, 2, "11:00"), g(4, 3, "13:00")];
    expect(gamedaysOf(list, 3)).toHaveLength(1);
    expect(gamedaysOf(list, 4)).toEqual([]);
    expect(gamedaysOf(list, 3)[0]).toMatchObject({ first: "2026-12-05T10:00", last: "2026-12-05T13:00", teamIds: [1, 2, 3] });
  });

  it("an away game does not count", async () => {
    await exec("UPDATE events SET is_home = 0 WHERE id = ?", games[4]);
    expect(await day()).toBeNull();
  });
});

describe("home game day: who is involved", () => {
  it("own team, child, coach, followed team and a helper duty; not others", async () => {
    await dutyOn(hanna, games[0]!, `${date}T09:30`);
    const r = await recipients(env.DB, (await day())!);
    expect(r.get(await accountOf(lena))).toMatchObject({ self: { time: "11:30", team: "wD" } });
    expect(r.get(await accountOf(mona))).toMatchObject({ self: null, children: [{ name: "Lena", time: "11:30", team: "wD" }] });
    expect(r.get(await accountOf(carl))).toMatchObject({ teams: [{ time: "13:00", team: "mC" }] });
    expect(r.get(await accountOf(fritz))).toMatchObject({ teams: [{ time: "18:00", team: "Damen" }] });
    expect(r.get(await accountOf(hanna))).toMatchObject({ duty: `${date}T09:30` });
    expect(r.has(await accountOf(olga))).toBe(false);
  });

  it("fans only with the fans module, duties only with the duties module", async () => {
    await dutyOn(hanna, games[0]!, `${date}T09:30`);
    await modules({ fans: false, duties: false });
    const r = await recipients(env.DB, (await day())!);
    expect(r.has(await accountOf(fritz))).toBe(false);
    expect(r.has(await accountOf(hanna))).toBe(false);
    expect(r.has(await accountOf(lena))).toBe(true);
  });

  it("not with the topic switched off, not inactive players, parents only where parents are involved", async () => {
    await exec("INSERT INTO notification_settings (account_id, person_id, topic, enabled) VALUES (?, ?, 'gameday', 0)", await accountOf(carl), carl);
    const r = await recipients(env.DB, (await day())!);
    expect(r.has(await accountOf(carl))).toBe(false);
    await exec("UPDATE teams SET parents_enabled = 0 WHERE id = ?", teams[1]);
    expect((await recipients(env.DB, (await day())!)).has(await accountOf(mona))).toBe(false);
    await exec("UPDATE persons SET is_active = 0 WHERE id = ?", lena);
    expect((await recipients(env.DB, (await day())!)).has(await accountOf(lena))).toBe(false);
  });
});

describe("home game day: the push", () => {
  const push = async (p: number, locale: "de" | "en" = "de") => {
    const gd = (await day())!;
    const reason = (await recipients(env.DB, gd)).get(await accountOf(p))!;
    return withLocale(locale, () => gamedayPush(gd, reason));
  };

  it("personal texts in the recipient's language", async () => {
    expect(await push(lena, "en")).toEqual({
      title: "Tomorrow is home game day!",
      body: "5 teams play at home in Sporthalle Am Park, you play at 11:30 (wD). Come early or stay longer, the others are glad about every fan.",
      url: `/heimspieltag/${date}`,
      tag: `gameday-${date}`,
    });
    expect((await push(mona, "en")).body).toContain(", Lena plays at 11:30 (wD).");
    expect((await push(carl, "en")).body).toContain(", the mC play at 13:00.");
    expect((await push(fritz, "en")).body).toContain(", the Damen play at 18:00.");
    expect((await push(lena)).title).toBe("Morgen ist großer Heimspieltag!");
    expect((await push(lena)).body).toContain("du spielst um 11:30 (wD)");
    expect((await push(mona)).body).toContain("Lena spielt um 11:30 (wD)");
  });

  it("the helper duty, two children, two teams", async () => {
    await dutyOn(hanna, games[0]!, `${date}T09:30`);
    expect((await push(hanna, "en")).body).toContain(", your helper duty starts at 09:30.");
    const ben = await person("Ben", { birthYear: 2012 });
    await member(ben, teams[3]!);
    await guardian(mona, ben);
    expect((await push(mona, "en")).body).toContain(", Lena (wD) at 11:30 and Ben (wB) at 14:30 play.");
    await member(carl, teams[3]!, "coach");
    expect((await push(carl, "en")).body).toContain(", the mC at 13:00 and the wB at 14:30 play.");
  });

  it("after the squad, someone not nominated reads the team's name", async () => {
    await exec("UPDATE events SET squad_published_at = '2026-01-01T00:00:00Z' WHERE id = ?", games[1]);
    expect((await push(lena, "en")).body).toContain(", the wD play at 11:30.");
    await exec("INSERT INTO nominations (event_id, person_id) VALUES (?, ?)", games[1], lena);
    expect((await push(lena, "en")).body).toContain(", you play at 11:30 (wD).");
  });

  it("goes out once at the configured hour of the day before, in club time", async () => {
    for (const p of [lena, mona, carl, fritz, olga]) {
      const account = await accountOf(p);
      await exec("INSERT INTO push_subscriptions (account_id, endpoint, p256dh, auth) VALUES (?, ?, 'x', 'y')", account, `https://push.example/${account}`);
    }
    const at = (hour: string) => localToInstant(`${addDays(date, -1)}T${hour}:05`);
    expect(await sendGamedayNotice(env, at("17"))).toBe(0);
    // Too late for a missed run to catch up
    expect(await sendGamedayNotice(env, at("21"))).toBe(0);
    expect(await sendGamedayNotice(env, at("18"))).toBe(4);
    expect(pushes.flatMap((j) => j.accountIds).sort()).toEqual([await accountOf(lena), await accountOf(mona), await accountOf(carl), await accountOf(fritz)].sort());
    expect(await sendGamedayNotice(env, at("19"))).toBe(0);
    expect(await rows("SELECT day FROM gameday_sent")).toEqual([{ day: date }]);
    // Switched off: nothing
    await exec("DELETE FROM gameday_sent");
    await api("/gameday/settings", { method: "PUT", cookie: await loginAs(await person("Ada", { admin: true })), body: { enabled: false, minTeams: 5, hour: 18 } });
    expect(await sendGamedayNotice(env, at("18"))).toBe(0);
  });

  it("the hour is the club's local hour, not UTC", async () => {
    await exec("INSERT INTO push_subscriptions (account_id, endpoint, p256dh, auth) VALUES (?, 'https://push.example/l', 'x', 'y')", await accountOf(lena));
    await api("/gameday/settings", { method: "PUT", cookie: await loginAs(await person("Ada", { admin: true })), body: { enabled: true, minTeams: 5, hour: 12 } });
    await saveClub(env.DB, { timeZone: "Asia/Tokyo" });
    await enterClubContext(env.DB);
    try {
      // 12:05 in Tokyo is 03:05 UTC
      const noon = localToInstant(`${addDays(date, -1)}T12:05`);
      expect(new Date(noon).getUTCHours()).toBe(3);
      expect(await sendGamedayNotice(env, noon - 3_600_000)).toBe(0);
      expect(await sendGamedayNotice(env, noon)).toBe(1);
    } finally {
      await saveClub(env.DB, { timeZone: "Europe/Berlin" });
      await enterClubContext(env.DB);
    }
  });
});

describe("home game day: page, card and settings", () => {
  it("the page of the day only for people involved and admins, game data only", async () => {
    expect((await api(`/gameday/days/${date}`, { cookie: await loginAs(olga) })).status).toBe(404);
    expect((await api(`/gameday/days/${addDays(date, 1)}`, { cookie: await loginAs(mona) })).status).toBe(404);
    const d = (await api<GamedayDetail>(`/gameday/days/${date}`, { cookie: await loginAs(mona) })).body;
    expect(d.games).toHaveLength(5);
    expect(d.games.find((g) => g.teams[0]!.name === "wD")).toMatchObject({ own: true, fan: false, href: `/termine/${games[1]}` });
    expect(d.games.find((g) => g.teams[0]!.name === "Damen")).toMatchObject({ own: false, fan: false, href: `/spiel/${games[4]}` });
    // No squad, responses or names in it
    expect(JSON.stringify(d)).not.toMatch(/Lena|participants|responses/);
    const f = (await api<GamedayDetail>(`/gameday/days/${date}`, { cookie: await loginAs(fritz) })).body;
    expect(f.games.find((g) => g.teams[0]!.name === "Damen")).toMatchObject({ fan: true, href: `/spiel/${games[4]}` });
    await dutyOn(hanna, games[0]!, `${date}T09:30`);
    expect((await api(`/gameday/days/${date}`, { cookie: await loginAs(hanna) })).status).toBe(200);
    expect((await api(`/gameday/days/${date}`, { cookie: await loginAs(await person("Ada", { admin: true })) })).status).toBe(200);
    // Without the fans module the other games lead nowhere
    await modules({ fans: false });
    const m = (await api<GamedayDetail>(`/gameday/days/${date}`, { cookie: await loginAs(mona) })).body;
    expect(m.games.find((g) => g.teams[0]!.name === "Damen")!.href).toBeNull();
  });

  it("the card on home and later days as tiles, only for people involved", async () => {
    const later = addDays(todayLocal(), 10);
    for (let i = 0; i < teams.length; i++) await homeGame(teams[i]!, 10, "15:00", `TSV Später ${i}`);
    const page = async (p: number, query = "teams=all") => (await api(`/events?limit=50&${query}`, { cookie: await loginAs(p) })).body.modules.gameday as GamedayPage | undefined;
    const monaPage = (await page(mona))!;
    expect(monaPage.card).toMatchObject({ date, teams: 5, hall: "Sporthalle Am Park", first: `${date}T10:00`, last: `${date}T18:00` });
    expect(monaPage.card!.mine).toEqual([{ eventId: games[1], startsAt: `${date}T11:30`, team: "wD", fan: false, liveMinutes: 90 }]);
    expect(monaPage.later).toEqual([{ date: later, startsAt: `${later}T15:00` }]);
    expect((await page(fritz))!.card!.mine).toMatchObject([{ team: "Damen", fan: true }]);
    expect(await page(olga)).toBeUndefined();
    // Trainings only, or the past: nothing
    expect(await page(mona, "teams=all&show=training")).toBeUndefined();
    expect(await page(mona, "teams=all&past=1")).toBeUndefined();
    // Module off: nothing
    await modules({ gameday: false });
    expect(await page(mona)).toBeUndefined();
  });

  it("settings for admins only, checked", async () => {
    expect((await api("/gameday/settings", { cookie: await loginAs(mona) })).status).toBe(403);
    const admin = await loginAs(await person("Ada", { admin: true }));
    const view = (await api<GamedaySettingsView>("/gameday/settings", { cookie: admin })).body;
    expect(view).toMatchObject({ enabled: true, minTeams: 5, hour: 18, mascotVersion: null, next: { date, teams: 5, sendAt: `${addDays(date, -1)}T18:00`, recipients: 4 } });
    expect((await api("/gameday/settings", { method: "PUT", cookie: admin, body: { enabled: true, minTeams: 1, hour: 18 } })).status).toBe(400);
    expect((await api("/gameday/settings", { method: "PUT", cookie: admin, body: { enabled: true, minTeams: 5, hour: 17 } })).status).toBe(400);
    expect((await api("/gameday/settings", { method: "PUT", cookie: admin, body: { enabled: true, minTeams: 6, hour: 20 } })).status).toBe(200);
    expect((await api<GamedaySettingsView>("/gameday/settings", { cookie: admin })).body).toMatchObject({ minTeams: 6, hour: 20, next: null });
  });

  it("the mascot picture: uploaded by an admin, served with its version, removed", async () => {
    const admin = await loginAs(await person("Ada", { admin: true }));
    const res = await fetchMascot("PUT", admin, "image/png");
    expect(res.status).toBe(200);
    expect((await fetchMascot("PUT", await loginAs(mona), "image/png")).status).toBe(403);
    expect((await fetchMascot("PUT", admin, "image/gif")).status).toBe(400);
    const v = (await api<GamedaySettingsView>("/gameday/settings", { cookie: admin })).body.mascotVersion;
    expect(v).toBe(1);
    const got = await fetchMascot("GET", admin);
    expect(got.status).toBe(200);
    expect(got.headers.get("content-type")).toBe("image/png");
    expect((await fetchMascot("DELETE", admin)).status).toBe(200);
    expect((await fetchMascot("GET", admin)).status).toBe(404);
    expect((await api<GamedaySettingsView>("/gameday/settings", { cookie: admin })).body.mascotVersion).toBeNull();
  });
});

describe("home game day: upgrade", () => {
  it("adds the sent markers and the cache triggers to a club's database", async () => {
    await upgradeFrom("202611230400_gameday_sent.sql");
    await season();
    const tm = await team("wD", "wD");
    const id = await eventIn(tm, 3, { kind: "game" });
    await migrateRest();
    expect(await rows("SELECT * FROM gameday_sent")).toEqual([]);
    const before = (await cacheVersions(env.DB)).duties;
    await exec("UPDATE events SET cancelled_at = '2026-01-01T00:00:00Z' WHERE id = ?", id);
    expect((await cacheVersions(env.DB)).duties).toBe(before + 1);
    const ref = (await cacheVersions(env.DB)).ref;
    await exec("INSERT INTO app_meta (key, value) VALUES ('gameday', '{}')");
    await exec("INSERT INTO app_meta (key, value) VALUES ('other', '{}')");
    expect((await cacheVersions(env.DB)).ref).toBe(ref + 1);
  });
});
