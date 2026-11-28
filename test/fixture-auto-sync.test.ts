// Game schedules that sync by themselves (docs/dev/connectors.md, worker/domain/fixtures.ts): after games without a
// result and weekly from a coach's device, the limits of the button, the pushes of a sync and the league table from
// the same fetch. With handball4all as the source; invented names only.
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { saveClub } from "../worker/domain/club";
import { importGames } from "../worker/domain/fixtures";
import { hasLeagueTable, teamsWithLeagueTable } from "../worker/domain/league-table";
import type { PushJob } from "../worker/domain/notify";
import { addDays, nowLocal, todayLocal, utcIso } from "../worker/lib/time";
import { api, exec, freshDb, loginAs, member, migrateRest, one, person, rows, season, team, upgradeFrom } from "./helpers";

const ddmmyy = (date: string) => {
  const [y, m, d] = date.split("-");
  return `${d}.${m}.${y!.slice(2)}`;
};

function game(id: string, date: string, time: string, home: string, guest: string, goals: [string, string] = [" ", " "]) {
  return { gID: id, gNo: `7${id}`, gDate: ddmmyy(date), gTime: time, gGymnasiumID: "10", gGymnasiumName: "Vereinshalle", gHomeTeam: home, gGuestTeam: guest, gHomeGoals: goals[0], gGuestGoals: goals[1] };
}

const score = [
  { tabScore: 1, tabTeamID: "888", tabTeamname: "HSG Andere", numPlayedGames: 4, numWonGames: 4, numEqualGames: 0, numLostGames: 0, numGoalsShot: 100, numGoalsGot: 80, pointsPlus: 8, pointsMinus: 0 },
  { tabScore: 2, tabTeamID: "999", tabTeamname: "TV Heimverein", numPlayedGames: 4, numWonGames: 2, numEqualGames: 1, numLostGames: 1, numGoalsShot: 90, numGoalsGot: 85, pointsPlus: 5, pointsMinus: 3 },
  { tabScore: "", tabTeamID: "777", tabTeamname: "SG Gast", numPlayedGames: "4", numWonGames: 0, numEqualGames: 1, numLostGames: 3, numGoalsShot: 70, numGoalsGot: 95, pointsPlus: 1, pointsMinus: 7 },
];

function payload(games: object[], past: object[] = [], withTable = true) {
  return [
    {
      head: { name: "weibliche D-Jugend Testliga" },
      content: {
        actualGames: [{ gClassID: "555", games: past }],
        futureGames: { gClassID: "555", games },
        teamsList: [{ teamID: "999", teamName: "TV Heimverein" }],
        ...(withTable ? { score, scoreComments: ["Nach dem direkten Vergleich.<br>Ohne Platzziffer: <b>gleicher</b> Platz."] } : {}),
      },
    },
  ];
}

let wd: number;
let coach: number;
let admin: number;
let kid: number;

beforeEach(async () => {
  await freshDb();
  await season();
  wd = await team("wD", "wD");
  await exec(
    "UPDATE teams SET fixture_connector = 'handball4all', fixture_source = ? WHERE id = ?",
    JSON.stringify({ orgId: 1, leagueId: 555, teamId: 999, portal: null }),
    wd,
  );
  await exec("INSERT INTO locations (id, name, kind, external_ref) VALUES (1, 'Vereinshalle', 'hall', 'handball4all:10')");
  coach = await person("Tina");
  admin = await person("Ada", { admin: true });
  kid = await person("Kira", { birthYear: 2015 });
  await member(coach, wd, "coach");
  await member(kid, wd);
});

const teamRow = () => one<any>("SELECT * FROM teams WHERE id = ?", wd);
const autoSync = async (cookie: string) => ((await api("/coach-hints", { cookie })).body.autoSync as { teamId: number }[]).map((s) => s.teamId);
const claim = async (cookie: string, manual: boolean) => (await api(`/teams/${wd}/games/claim`, { cookie, body: { manual } })).body;

describe("League table", () => {
  it("comes with the schedule, is stored per team and shown on the game for everyone who sees it", async () => {
    const d = addDays(todayLocal(), 4);
    await importGames(env, await teamRow(), payload([game("1", d, "14:00", "TV Heimverein", "HSG Andere")]));
    const id = (await one<{ id: number }>("SELECT id FROM events WHERE external_ref = 'handball4all:1'")).id;
    const table = (await api(`/events/${id}`, { cookie: await loginAs(kid) })).body.standings;
    expect(table).toMatchObject({
      source: "handball4all",
      leagueName: "weibliche D-Jugend Testliga",
      comment: "Nach dem direkten Vergleich. Ohne Platzziffer: gleicher Platz.",
      fetchedAt: expect.any(String),
    });
    expect(table.rows.map((r: any) => [r.pos, r.team, r.own, r.games, r.pointsPlus, r.pointsMinus])).toEqual([
      [1, "HSG Andere", false, 4, 8, 0],
      [2, "TV Heimverein", true, 4, 5, 3],
      [null, "SG Gast", false, 4, 1, 7],
    ]);
    // The source's ids of the teams do not leave the server
    expect(JSON.stringify(table)).not.toContain("teamId");
    expect(await hasLeagueTable(env.DB, wd)).toBe(true);
    expect([...(await teamsWithLeagueTable(env.DB))]).toEqual([wd]);

    // A fetch without a table keeps the stored one
    await importGames(env, await teamRow(), payload([game("1", d, "14:00", "TV Heimverein", "HSG Andere")], [], false));
    expect(await rows("SELECT team_id FROM league_tables")).toEqual([{ team_id: wd }]);

    // Fans of the team see it on the fan page of the game
    await saveClub(env.DB, { modules: { fans: true } as never });
    const fan = await person("Fina");
    expect((await api(`/fans/games/${id}`, { cookie: await loginAs(fan) })).body.standings.rows).toHaveLength(3);

    // Module off: not shown; another source for the team: gone
    await saveClub(env.DB, { modules: { handball4all: false } as never });
    expect((await api(`/events/${id}`, { cookie: await loginAs(kid) })).body.standings).toBeNull();
    expect(await hasLeagueTable(env.DB, wd)).toBe(false);
    await saveClub(env.DB, { modules: { handball4all: true } as never });
    const res = await api(`/teams/${wd}/games/source`, { method: "PUT", cookie: await loginAs(coach), body: { link: null } });
    expect(res.status).toBe(200);
    expect(await rows("SELECT team_id FROM league_tables")).toEqual([]);
  });

  it("checks the table before storing it: no more than 40 rows, no rows without a team, numbers only", async () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ ...score[0], tabScore: i + 1, tabTeamname: `Team ${i}`, numGoalsShot: "<b>1</b>" }));
    await importGames(env, await teamRow(), payload([game("1", addDays(todayLocal(), 4), "14:00", "TV Heimverein", "HSG Andere")]).map((p) => ({ ...p, content: { ...p.content, score: [...many, { tabScore: 31 }] } })));
    const stored = JSON.parse((await one<{ rows: string }>("SELECT rows FROM league_tables")).rows);
    expect(stored).toHaveLength(30);
    expect(stored[0]).toMatchObject({ team: "Team 0", goalsFor: 0, own: false });
  });

  it("the season change deletes the tables", async () => {
    await importGames(env, await teamRow(), payload([game("1", addDays(todayLocal(), 4), "14:00", "TV Heimverein", "HSG Andere")]));
    expect(await rows("SELECT team_id FROM league_tables")).toHaveLength(1);
    const cookie = await loginAs(admin);
    const created = await api(`/seasons`, { cookie, body: { name: "2027/28", startsOn: "2027-07-01", endsOn: "2028-06-30" } });
    const done = await api(`/season-change/execute`, { cookie, body: { seasonId: created.body.id, confirmName: "2027/28", assignments: [] } });
    expect(done.body).toMatchObject({ ok: true });
    expect(await rows("SELECT team_id FROM league_tables")).toEqual([]);
  });
});

describe("Sync by itself", () => {
  /** A game of the team that started this many hours ago, without a result. */
  async function pastGame(hoursAgo: number, ref = "42") {
    const startsAt = nowLocal(Date.now() - hoursAgo * 3_600_000);
    await exec(
      "INSERT INTO events (kind, starts_at, ends_at, external_ref, home_team, guest_team, is_home) VALUES ('game', ?, ?, ?, 'TV Heimverein', 'HSG Andere', 1)",
      startsAt,
      startsAt,
      `handball4all:${ref}`,
    );
    await exec("INSERT INTO event_teams (event_id, team_id) SELECT id, ? FROM events WHERE external_ref = ?", wd, `handball4all:${ref}`);
    return startsAt;
  }

  it("only coaches of the team, only after a game without a result (at most twice, 3 hours apart) or after a week", async () => {
    const coachCookie = await loginAs(coach);
    const adminCookie = await loginAs(admin);
    // Synced an hour ago, no game over: nothing due
    await exec("UPDATE teams SET fixture_synced_at = ? WHERE id = ?", utcIso(Date.now() - 3_600_000), wd);
    await exec("INSERT INTO events (kind, starts_at, ends_at, external_ref) VALUES ('game', ?, ?, 'handball4all:99')", addDays(todayLocal(), 9) + "T12:00", addDays(todayLocal(), 9) + "T13:30");
    await exec("INSERT INTO event_teams (event_id, team_id) SELECT id, ? FROM events WHERE external_ref = 'handball4all:99'", wd);
    expect(await autoSync(coachCookie)).toEqual([]);
    expect(await claim(coachCookie, false)).toMatchObject({ claimed: false, reason: "not_due" });

    // Kick-off 2 hours ago: 90 minutes of play plus an hour are not over yet
    const early = await pastGame(2, "41");
    expect(await autoSync(coachCookie)).toEqual([]);
    await exec("DELETE FROM events WHERE starts_at = ?", early);

    // Kick-off 4 hours ago, no result: due
    const startsAt = await pastGame(4);
    expect(await autoSync(coachCookie)).toEqual([wd]);
    // Admins who do not coach the team never sync by themselves
    expect(await autoSync(adminCookie)).toEqual([]);
    expect(await claim(adminCookie, false)).toMatchObject({ claimed: false, reason: "not_coach" });

    // A sync without the result counts a try; then 3 hours of quiet, after two tries none
    expect(await claim(coachCookie, false)).toMatchObject({ claimed: true });
    // Another device meanwhile is not told to sync
    expect(await autoSync(coachCookie)).toEqual([]);
    const d = startsAt.slice(0, 10);
    const noResult = payload([], [game("42", d, startsAt.slice(11), "TV Heimverein", "HSG Andere")]);
    expect((await api(`/teams/${wd}/games/import`, { cookie: coachCookie, body: { data: noResult } })).status).toBe(200);
    expect(await one("SELECT result_tries AS n FROM events WHERE external_ref = 'handball4all:42'")).toEqual({ n: 1 });
    expect(await autoSync(coachCookie)).toEqual([]);
    expect(await claim(coachCookie, false)).toMatchObject({ claimed: false, reason: "not_due" });
    await exec("UPDATE events SET result_tried_at = ? WHERE external_ref = 'handball4all:42'", utcIso(Date.now() - 4 * 3_600_000));
    await exec("UPDATE teams SET fixture_synced_at = ? WHERE id = ?", utcIso(Date.now() - 4 * 3_600_000), wd);
    expect(await autoSync(coachCookie)).toEqual([wd]);
    await exec("UPDATE events SET result_tries = 2 WHERE external_ref = 'handball4all:42'");
    expect(await autoSync(coachCookie)).toEqual([]);

    // With the result: stored, nothing due any more
    await exec("UPDATE events SET result_tries = 0, result_tried_at = NULL WHERE external_ref = 'handball4all:42'");
    expect(await claim(coachCookie, false)).toMatchObject({ claimed: true });
    const withResult = payload([], [game("42", d, startsAt.slice(11), "TV Heimverein", "HSG Andere", ["25", "22"])]);
    await api(`/teams/${wd}/games/import`, { cookie: coachCookie, body: { data: withResult } });
    expect(await one("SELECT home_goals, guest_goals, result_tries FROM events WHERE external_ref = 'handball4all:42'")).toEqual({ home_goals: 25, guest_goals: 22, result_tries: 0 });
    expect(await autoSync(coachCookie)).toEqual([]);

    // A week without a sync: due (while games are ahead; the syncs above cancelled game 99, it is not in the payloads)
    await exec("UPDATE teams SET fixture_synced_at = ? WHERE id = ?", utcIso(Date.now() - 8 * 86_400_000), wd);
    expect(await autoSync(coachCookie)).toEqual([]);
    await exec("UPDATE events SET cancelled_at = NULL WHERE external_ref = 'handball4all:99'");
    expect(await autoSync(coachCookie)).toEqual([wd]);
    expect(await claim(coachCookie, false)).toMatchObject({ claimed: true });
  });

  it("waits for the result of the season's last game, too, but not right after a sync", async () => {
    await exec("UPDATE teams SET fixture_synced_at = ? WHERE id = ?", utcIso(Date.now() - 3_600_000), wd);
    await pastGame(5);
    const cookie = await loginAs(coach);
    expect(await autoSync(cookie)).toEqual([wd]);
    // The source's minimum between two syncs holds for syncs by themselves as well
    await exec("UPDATE teams SET fixture_synced_at = ? WHERE id = ?", utcIso(Date.now() - 5 * 60_000), wd);
    expect(await autoSync(cookie)).toEqual([]);
    expect(await claim(cookie, false)).toMatchObject({ claimed: false, reason: "recent" });
  });

  it("the button: coaches at most once an hour, admins without that limit", async () => {
    await exec("UPDATE teams SET fixture_synced_at = ? WHERE id = ?", utcIso(Date.now() - 20 * 60_000), wd);
    const res = await claim(await loginAs(coach), true);
    expect(res).toMatchObject({ claimed: false, reason: "recent" });
    expect(Date.parse(res.retryAt) - Date.now()).toBeGreaterThan(35 * 60_000);
    expect(await claim(await loginAs(admin), true)).toMatchObject({ claimed: true });
    // The source's own minimum stays for admins too
    await exec("UPDATE teams SET fixture_synced_at = ?, fixture_claimed_at = NULL WHERE id = ?", utcIso(Date.now() - 5 * 60_000), wd);
    expect(await claim(await loginAs(admin), true)).toMatchObject({ claimed: false, reason: "recent" });
  });
});

describe("Pushes of a sync", () => {
  let pushes: PushJob[];
  beforeEach(async () => {
    pushes = [];
    await loginAs(coach);
    await loginAs(kid);
    await exec("UPDATE accounts SET locale = 'en'");
    await exec("INSERT INTO push_subscriptions (account_id, endpoint, p256dh, auth) SELECT id, 'https://push.example/' || id, 'k', 'a' FROM accounts");
    vi.spyOn(env.PUSH_QUEUE, "sendBatch").mockImplementation(async (jobs) => {
      pushes.push(...[...jobs].map((j) => j.body as PushJob));
      return { metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } } } as unknown as QueueSendBatchResponse;
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it("cancelled to team and coaches, back in the schedule to the same, moves also to the coaches, new games only to the coaches", async () => {
    const account = async (p: number) => (await one<{ id: number }>("SELECT id FROM accounts WHERE person_id = ?", p)).id;
    const [coachAccount, kidAccount] = [await account(coach), await account(kid)];
    const sent = () => pushes.map((p) => [p.payload.title, [...p.accountIds].sort((a, b) => a - b)]);
    const g1 = game("1", addDays(todayLocal(), 10), "14:00", "TV Heimverein", "HSG Andere");
    const g2 = game("2", addDays(todayLocal(), 17), "16:00", "SG Gast", "TV Heimverein");

    // The first sync of a team brings the whole season: no push
    await importGames(env, await teamRow(), payload([g1]));
    expect(sent()).toEqual([]);
    await importGames(env, await teamRow(), payload([g1, g2]));
    expect(sent()).toEqual([["New games (wD)", [coachAccount]]]);
    expect(pushes[0]!.payload.body).toBe("One new game is in the schedule of handball4all.");

    pushes.length = 0;
    await importGames(env, await teamRow(), payload([g2]));
    expect(sent()).toEqual([
      ["Game cancelled (wD)", [kidAccount]],
      ["Game cancelled (wD)", [coachAccount]],
    ]);
    expect(pushes[0]!.payload.body).toContain("no longer in the schedule of handball4all and counts as cancelled");

    pushes.length = 0;
    await importGames(env, await teamRow(), payload([g1, { ...g2, gTime: "17:30" }]));
    expect(sent()).toEqual([
      ["Game moved (wD)", [kidAccount]],
      ["Game moved (wD)", [coachAccount]],
      ["Game going ahead (wD)", [kidAccount]],
      ["Game going ahead (wD)", [coachAccount]],
    ]);
    expect(pushes[1]!.payload.body).toMatch(/^According to handball4all from .*16:00 to .*17:30, Vereinshalle\.$/);

    // Results come without a push
    pushes.length = 0;
    await importGames(env, await teamRow(), payload([g1, { ...g2, gTime: "17:30", gHomeGoals: "20", gGuestGoals: "21" }]));
    expect(sent()).toEqual([]);
  });

  it("in the recipient's language", async () => {
    await exec("UPDATE accounts SET locale = 'de' WHERE person_id = ?", coach);
    const g1 = game("1", addDays(todayLocal(), 10), "14:00", "TV Heimverein", "HSG Andere");
    await importGames(env, await teamRow(), payload([g1]));
    await importGames(env, await teamRow(), payload([]));
    expect(pushes.map((p) => p.payload.title).sort()).toEqual(["Game cancelled (wD)", "Spiel abgesagt (wD)"]);
  });
});

describe("Migration", () => {
  it("202611270100: games start without tries, teams without a table", async () => {
    await upgradeFrom("202611270100_core_fixture-results-and-tables.sql");
    await exec("INSERT INTO teams (id, name, age_class_code) VALUES (1, 'wD', 'wD')");
    await exec("INSERT INTO events (id, kind, starts_at) VALUES (1, 'game', '2026-11-21T10:00')");
    await migrateRest();
    expect(await one("SELECT result_tries, result_tried_at FROM events WHERE id = 1")).toEqual({ result_tries: 0, result_tried_at: null });
    await exec("INSERT INTO league_tables (team_id, connector, rows, fetched_at) VALUES (1, 'handball4all', '[]', '2026-11-27T10:00:00Z')");
    await exec("DELETE FROM teams WHERE id = 1");
    expect(await rows("SELECT * FROM league_tables")).toEqual([]);
  });
});
