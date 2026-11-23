// Event list on home: team buttons and kind chips filter on the server, short game titles, team short codes per sport,
// order around the large card. Names invented.
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { splitAtCard } from "../shared/home-list";
import { teamShort } from "../shared/sport-api";
import { SPORTS, teamShortFor } from "../shared/sports";
import type { EventPage, EventSummary } from "../shared/types";
import { saveClub } from "../worker/domain/club";
import { shortGameTitle } from "../worker/domain/events";
import { addDays, todayLocal } from "../worker/lib/time";
import { api, eventIn, exec, freshDb, guardian, loginAs, member, person, season, team } from "./helpers";

let wd: number;
let men: number;
let tara: number;
let cookie: string;

beforeEach(async () => {
  await freshDb();
  await season();
  wd = await team("wD", "wD");
  men = await team("Men 2", "Adults", { gender: "m", level: 2 });
  // Coach of the men, mother of a player in the wD
  tara = await person("Tara");
  await member(tara, men, "coach");
  const mia = await person("Mia");
  await member(mia, wd);
  await guardian(tara, mia);
  cookie = await loginAs(tara);
});

const page = async (query: string) => {
  const res = await api<EventPage>(`/events?${query}`, { cookie });
  expect(res.status).toBe(200);
  return res.body;
};
const ids = (list: EventSummary[]) => list.map((e) => e.id);

describe("team buttons and kind chips filter on the server", () => {
  it("teams=all, a selection, none; the old team=<id> still works", async () => {
    const own: number[] = [];
    const kids: number[] = [];
    for (let d = 1; d <= 6; d++) {
      own.push(await eventIn(men, d));
      kids.push(await eventIn(wd, d, { time: "10:00" }));
    }
    const all = await page("limit=50&teams=all");
    expect(ids(all.events).sort()).toEqual([...own, ...kids].sort());
    expect(ids((await page(`limit=50&teams=${men}`)).events)).toEqual(own);
    expect(ids((await page(`limit=50&teams=${wd},${men}`)).events).sort()).toEqual([...own, ...kids].sort());
    expect(ids((await page(`limit=50&team=${wd}`)).events)).toEqual(kids);
    const none = await page("limit=50&teams=none");
    expect(none).toMatchObject({ events: [], next: [], openHelp: [], live: [], breaks: [], hasMore: false });
    expect((await api("/events?limit=20&teams=1;DROP", { cookie })).status).toBe(400);
  });

  it("'More events' stays correct with a narrow selection: the filter is in the query, not after it", async () => {
    // 30 events of the wD first, then 25 of the men
    for (let d = 1; d <= 30; d++) await eventIn(wd, d);
    const men25: number[] = [];
    for (let d = 31; d <= 55; d++) men25.push(await eventIn(men, d));
    const first = await page(`limit=20&teams=${men}`);
    expect(ids(first.events)).toEqual(men25.slice(0, 20));
    expect(first.hasMore).toBe(true);
    const more = await page(`limit=40&teams=${men}`);
    expect(ids(more.events)).toEqual(men25);
    expect(more.hasMore).toBe(false);
  });

  it("kinds: training, games, other (special events); club-wide events stay with any team selected", async () => {
    const training = await eventIn(men, 1);
    const game = await eventIn(men, 2, { kind: "game" });
    const party = await eventIn(men, 3, { kind: "special", title: "Season party" });
    const clubDay = await eventIn(men, 4, { kind: "special", title: "Club day" });
    await exec("DELETE FROM event_teams WHERE event_id = ?", clubDay);
    await exec("UPDATE events SET club_wide = 1 WHERE id = ?", clubDay);
    expect(ids((await page("limit=50&show=training")).events)).toEqual([training]);
    expect(ids((await page("limit=50&show=other")).events)).toEqual([party, clubDay]);
    expect(ids((await page("limit=50&show=game")).events)).toEqual([game]);
    expect(ids((await page(`limit=50&teams=${wd}&show=other`)).events)).toEqual([clubDay]);
    const gamesOnly = await page("limit=50&show=game");
    expect(gamesOnly.trainingsUntil).toBeNull();
    expect(gamesOnly.breaks).toEqual([]);
  });

  it("the large card follows the selection", async () => {
    // Mia's training lies beyond the first page of men events
    for (let d = 1; d <= 25; d++) await eventIn(men, d, { kind: "special", title: `Meeting ${d}` });
    const miaTraining = await eventIn(wd, 30);
    expect(ids((await page("limit=20")).next)).toEqual([miaTraining]);
    expect((await page(`limit=20&teams=${men}`)).next).toEqual([]);
    expect((await page("limit=20&show=game")).next).toEqual([]);
  });
});

describe("short game title", () => {
  const game = (over: Record<string, unknown>) => ({ kind: "game", is_home: 1, home_team: "SV Example", guest_team: "HSG Opponent", title: null, ...over }) as any;

  it("club abbreviation, with the level from the second team on", async () => {
    await saveClub(env.DB, { abbr: "SVE" });
    expect(shortGameTitle(game({}), [{ id: 1, name: "Men 1", level: 1 }])).toBe("SVE – HSG Opponent");
    expect(shortGameTitle(game({}), [{ id: 1, name: "Men 2", level: 2 }])).toBe("SVE 2 – HSG Opponent");
    expect(shortGameTitle(game({ is_home: 0, home_team: "TV Host" }), [{ id: 1, name: "wD", level: 3 }])).toBe("TV Host – SVE 3");
    // Without home/away and on matchdays as the full title
    expect(shortGameTitle(game({ is_home: null, title: "Cup final" }), [{ id: 1, name: "wD", level: 1 }])).toBe("Cup final");
    expect(shortGameTitle({ ...game({}), kind: "training", title: "Training" }, [])).toBe("Training");
  });

  it("comes with the event summary", async () => {
    await saveClub(env.DB, { abbr: "SVE" });
    const id = await eventIn(men, 2, { kind: "game" });
    await exec("UPDATE events SET is_home = 1, home_team = 'SV Example', guest_team = 'HSG Opponent' WHERE id = ?", id);
    const e = (await page("limit=20")).events.find((x) => x.id === id)!;
    expect(e.title).toBe("SVE Men 2 – HSG Opponent");
    expect(e.shortTitle).toBe("SVE 2 – HSG Opponent");
    expect(e.game?.isHome).toBe(true);
  });
});

describe("team short codes from the sport profile", () => {
  it("words of the profile, short names stay, initials as the fallback", () => {
    expect(teamShortFor("Men 1", "handball")).toBe("M1");
    expect(teamShortFor("Women", "handball")).toBe("W");
    expect(teamShortFor("Veterans", "handball")).toBe("V");
    expect(teamShortFor("Herren 2", "handball")).toBe("H2");
    expect(teamShortFor("Alte Herren", "football")).toBe("AH");
    expect(teamShortFor("Senioren", "football")).toBe("S");
    expect(teamShortFor("wD", "handball")).toBe("wD");
    expect(teamShortFor("mC1", "handball")).toBe("mC1");
    expect(teamShortFor("Erste Mannschaft", "handball")).toBe("EM");
    expect(teamShortFor("U13 girls", "football")).toBe("U13G");
    // Unknown sport: the fallback profile
    expect(teamShortFor("Women 2", "curling")).toBe("W2");
  });

  it("a word only counts as a whole word at the start", () => {
    expect(teamShort("Mensa Team", [{ word: "Men", short: "M" }])).toBe("MT");
    expect(teamShort("Damen", [])).toBe("D");
    expect(SPORTS.football.teamShorts?.some((w) => w.word === "Senioren")).toBe(true);
  });
});

describe("order around the large card", () => {
  it("what starts before the card goes above it, the rest below, in time order", () => {
    const today = todayLocal();
    const card = { startsAt: `${today}T18:00`, id: 5 };
    const optional = { startsAt: `${today}T10:00`, id: 9 };
    const sameTime = { startsAt: `${today}T18:00`, id: 7 };
    const tomorrow = { startsAt: `${addDays(today, 1)}T09:00`, id: 1 };
    expect(splitAtCard([tomorrow, sameTime, optional], card)).toEqual({ before: [optional], after: [sameTime, tomorrow] });
    expect(splitAtCard([tomorrow, optional], undefined)).toEqual({ before: [], after: [optional, tomorrow] });
  });
});
