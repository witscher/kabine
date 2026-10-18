// Game schedule sources exclude each other per team: the club may switch on several, each team takes its
// games from one of them. Next to handball4all the tests use an invented second source, registered only
// here. Invented names only.
import { env } from "cloudflare:workers";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { defineModule } from "../shared/module-api";
import { DEFAULT_MODULES, MODULES } from "../shared/modules";
import { saveClub } from "../worker/domain/club";
import { addDays, todayLocal } from "../worker/lib/time";
import { type FixtureConnector, FixtureFormatError, type WorkerModule } from "../worker/module-api";
import { WORKER_MODULES } from "../worker/modules";
import { api, freshDb, loginAs, member, one, person, rows, season, team } from "./helpers";

const manifest = defineModule({
  id: "testSource",
  kind: "fixtures",
  vendor: "Testquelle",
  status: "beta",
  defaultOn: false,
  label: () => "Testquelle",
  description: () => "Invented source for the tests.",
  privacy: () => null,
});

const connector: FixtureConnector = {
  name: "Testquelle",
  fetchFrom: "device",
  minIntervalMs: 60_000,
  linkField: () => ({ label: "Link", hint: "Hint", placeholder: "https://www.testsource.example/teams/…" }),
  parseLink: (input) => {
    const m = /^https:\/\/www\.testsource\.example\/teams\/(\d+)\?league=(\d+)$/.exec(input.trim());
    return m ? { teamId: m[1]!, leagueId: m[2]! } : null;
  },
  describe: (s) => `League ${s.leagueId}, team ${s.teamId}`,
  request: (s) => ({ url: `https://api.testsource.example/schedule?league=${s.leagueId}&team=${s.teamId}` }),
  parse: (data) => {
    const games = (data as { games?: { id: string; date: string; time: string; home: string; guest: string }[] }).games;
    if (!Array.isArray(games)) throw new FixtureFormatError("No game list");
    return {
      games: games.map((g) => ({ externalId: g.id, number: null, date: g.date, time: g.time, home: g.home, guest: g.guest, venue: null, homeGoals: null, guestGoals: null })),
      ownTeamHint: "TV Heimverein",
      skipped: 0,
    };
  },
};
const worker: WorkerModule = { manifest, fixtures: connector };

beforeAll(() => {
  (MODULES as unknown as unknown[]).push(manifest);
  (WORKER_MODULES as WorkerModule[]).push(worker);
});
afterAll(() => {
  (MODULES as unknown as unknown[]).splice((MODULES as unknown as unknown[]).indexOf(manifest), 1);
  (WORKER_MODULES as WorkerModule[]).splice((WORKER_MODULES as WorkerModule[]).indexOf(worker), 1);
});

const H4A_LINK = "https://www.handball4all.de/home/portal/baden-wuerttembergischer-hv#/league?ogId=1&lId=555&tId=999";
const TEST_LINK = "https://www.testsource.example/teams/7?league=3";

const ddmmyy = (date: string) => {
  const [y, m, d] = date.split("-");
  return `${d}.${m}.${y!.slice(2)}`;
};
const h4aPayload = (games: { id: string; date: string }[]) => [
  {
    head: { name: "Testliga" },
    content: {
      actualGames: [],
      futureGames: {
        gClassID: "555",
        games: games.map((g) => ({ gID: g.id, gNo: g.id, gDate: ddmmyy(g.date), gTime: "14:00", gHomeTeam: "TV Heimverein", gGuestTeam: "HSG Andere", gHomeGoals: " ", gGuestGoals: " " })),
      },
      teamsList: [{ teamID: "999", teamName: "TV Heimverein" }],
    },
  },
];
const testPayload = (games: { id: string; date: string }[]) => ({ games: games.map((g) => ({ ...g, time: "16:00", home: "SG Gast", guest: "TV Heimverein" })) });

let teamA: number;
let teamB: number;
let cookie: string;

/** Reserve the fetch like a device does and hand in the data. */
async function sync(teamId: number, data: unknown) {
  expect((await api(`/teams/${teamId}/games/claim`, { cookie, body: { manual: true } })).body).toMatchObject({ claimed: true });
  const res = await api(`/teams/${teamId}/games/import`, { cookie, body: { data } });
  expect(res.status).toBe(200);
  return res.body;
}
const link = (teamId: number, connector: string, url: string) => api(`/teams/${teamId}/games/source`, { method: "PUT", cookie, body: { connector, link: url } });
const gamesOf = (teamId: number) =>
  rows<{ external_ref: string; cancelled: number }>(
    "SELECT e.external_ref, e.cancelled_at IS NOT NULL AS cancelled FROM events e JOIN event_teams et ON et.event_id = e.id WHERE et.team_id = ? ORDER BY e.external_ref",
    teamId,
  );

beforeEach(async () => {
  await freshDb();
  await season();
  teamA = await team("wD", "wD");
  teamB = await team("wC", "wC");
  const coach = await person("Carla");
  await member(coach, teamA, "coach");
  await member(coach, teamB, "coach");
  cookie = await loginAs(coach);
  await saveClub(env.DB, { modules: { ...DEFAULT_MODULES, handball4all: true, testSource: true } as typeof DEFAULT_MODULES });
});

describe("one game schedule source per team", () => {
  it("two sources on: each team links its own and they sync independently", async () => {
    const source = (await api(`/teams/${teamA}/games/source`, { cookie })).body;
    expect(source.connectors.map((c: { id: string }) => c.id).sort()).toEqual(["handball4all", "testSource"]);
    expect((await link(teamA, "handball4all", H4A_LINK)).status).toBe(200);
    expect((await link(teamB, "testSource", TEST_LINK)).status).toBe(200);

    const d = addDays(todayLocal(), 10);
    await sync(teamA, h4aPayload([{ id: "1", date: d }]));
    await sync(teamB, testPayload([{ id: "t1", date: d }]));
    expect(await gamesOf(teamA)).toEqual([{ external_ref: "handball4all:1", cancelled: 0 }]);
    expect(await gamesOf(teamB)).toEqual([{ external_ref: "testSource:t1", cancelled: 0 }]);

    // A sync of team A without the game cancels A's game, team B's game stays untouched
    // (the next sync would wait for minIntervalMs)
    await env.DB.prepare("UPDATE teams SET fixture_synced_at = NULL").run();
    await sync(teamA, h4aPayload([]));
    expect(await gamesOf(teamA)).toEqual([{ external_ref: "handball4all:1", cancelled: 1 }]);
    expect(await gamesOf(teamB)).toEqual([{ external_ref: "testSource:t1", cancelled: 0 }]);
  });

  it("a link has to fit the chosen source", async () => {
    const res = await link(teamB, "testSource", H4A_LINK);
    expect(res.status).toBe(400);
    expect((await one<{ fixture_connector: string | null }>("SELECT fixture_connector FROM teams WHERE id = ?", teamB)).fixture_connector).toBeNull();
  });

  it("changing a team's source keeps the games of the old one, no longer synced", async () => {
    const d = addDays(todayLocal(), 10);
    await link(teamA, "handball4all", H4A_LINK);
    await sync(teamA, h4aPayload([{ id: "1", date: d }]));
    expect((await api(`/teams/${teamA}/games/source`, { cookie })).body.linkedGames).toBe(1);

    expect((await link(teamA, "testSource", TEST_LINK)).status).toBe(200);
    // One value per team: the old source is gone
    expect(await one("SELECT fixture_connector FROM teams WHERE id = ?", teamA)).toEqual({ fixture_connector: "testSource" });
    const after = (await api(`/teams/${teamA}/games/source`, { cookie })).body;
    expect(after.connector.id).toBe("testSource");
    expect(after.linkedGames).toBe(0);

    // The new source neither changes nor cancels the old games
    await sync(teamA, testPayload([{ id: "t9", date: addDays(todayLocal(), 12) }]));
    expect(await gamesOf(teamA)).toEqual([
      { external_ref: "handball4all:1", cancelled: 0 },
      { external_ref: "testSource:t9", cancelled: 0 },
    ]);
  });

  it("switching a source off pauses the sync of its teams, their games stay", async () => {
    await link(teamB, "testSource", TEST_LINK);
    await sync(teamB, testPayload([{ id: "t1", date: addDays(todayLocal(), 10) }]));
    await saveClub(env.DB, { modules: { ...DEFAULT_MODULES, handball4all: true, testSource: false } as typeof DEFAULT_MODULES });

    const source = (await api(`/teams/${teamB}/games/source`, { cookie })).body;
    expect(source).toMatchObject({ configured: false, paused: { id: "testSource" } });
    expect(source.connectors.map((c: { id: string }) => c.id)).toEqual(["handball4all"]);
    expect((await api(`/teams/${teamB}/games/claim`, { cookie, body: { manual: true } })).status).toBe(409);
    expect(await gamesOf(teamB)).toEqual([{ external_ref: "testSource:t1", cancelled: 0 }]);

    // The settings page warns how many teams use it
    const admin = await loginAs(await person("Ada", { admin: true }));
    const usage = (await api("/admin/fixture-sources", { cookie: admin })).body.sources;
    expect(usage.find((s: { id: string }) => s.id === "testSource")).toMatchObject({ teams: 1 });
    expect(usage.find((s: { id: string }) => s.id === "handball4all")).toMatchObject({ teams: 0 });
  });
});
