// Results of played games (docs/dev/decisions.md, "Results in the event list"): the outcome from the own team's view,
// the outcome word only where the league has a table (GameInfo.inTable) in the event list, on the game page and for
// fans, and `me.young` for the mascot faces without the birth year. Invented names only.
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_MODULES } from "../shared/modules";
import { isYoung, outcome } from "../shared/result";
import type { EventPage, EventSummary } from "../shared/types";
import type { FanGamePage, FansPage } from "../modules/fans/types";
import { saveClub } from "../worker/domain/club";
import { todayLocal } from "../worker/lib/time";
import { api, eventIn, exec, freshDb, loginAs, member, person, season, team } from "./helpers";

describe("outcome from the own team's view", () => {
  it("win, draw, close and clear loss, as home and as away team; none without a known side", () => {
    expect(outcome(27, 25, true)).toBe("win");
    expect(outcome(25, 27, false)).toBe("win");
    expect(outcome(20, 20, true)).toBe("draw");
    expect(outcome(20, 20, false)).toBe("draw");
    expect(outcome(27, 31, true)).toBe("close");
    expect(outcome(26, 30, true)).toBe("close");
    expect(outcome(25, 30, true)).toBe("clear");
    expect(outcome(30, 12, false)).toBe("clear");
    expect(outcome(30, 12, null)).toBeNull();
  });

  it("young: under 14 by birth year, never without one", () => {
    expect(isYoung(2015, 2026)).toBe(true);
    expect(isYoung(2013, 2026)).toBe(true);
    expect(isYoung(2012, 2026)).toBe(false);
    expect(isYoung(null, 2026)).toBe(false);
  });
});

describe("me.young for the mascot faces", () => {
  it("by birth year in the club's year, without sending the birth year", async () => {
    await freshDb();
    const year = Number(todayLocal().slice(0, 4));
    const kid = await person("Kira", { birthYear: year - 11 });
    const teen = await person("Tara", { birthYear: year - 14 });
    const adult = await person("Mona");
    const me = async (p: number) => (await api("/session", { cookie: await loginAs(p) })).body.me;
    expect((await me(kid)).young).toBe(true);
    expect((await me(teen)).young).toBe(false);
    expect((await me(adult)).young).toBe(false);
    expect(JSON.stringify(await me(kid))).not.toContain(String(year - 11));
  });
});

describe("outcome word only where the league has a table", () => {
  let wd: number;
  let mc: number;
  let kid: number;
  let fan: number;

  /** A played game of the team n days ago, as home team, with this score. */
  async function played(teamId: number, days: number, goals: [number, number] | null) {
    const id = await eventIn(teamId, -days, { kind: "game", time: "11:00" });
    await exec(
      "UPDATE events SET ends_at = starts_at, is_home = 1, home_team = 'SV Musterstadt', guest_team = 'TSV Beispieldorf', home_goals = ?, guest_goals = ? WHERE id = ?",
      goals?.[0] ?? null,
      goals?.[1] ?? null,
      id,
    );
    return id;
  }

  beforeEach(async () => {
    await freshDb();
    await season();
    wd = await team("wD", "wD");
    mc = await team("mC", "mC");
    // wD takes its games from handball4all, which brought a table; mC plays without one
    await exec("UPDATE teams SET fixture_connector = 'handball4all', fixture_source = '{}' WHERE id = ?", wd);
    await exec("INSERT INTO league_tables (team_id, connector, league_name, rows, fetched_at) VALUES (?, 'handball4all', 'Testliga', '[]', '2026-01-01T00:00:00Z')", wd);
    kid = await person("Kira", { birthYear: 2015 });
    fan = await person("Fina");
    await member(kid, wd);
    await member(kid, mc);
  });

  it("in the event list and on the game page", async () => {
    const withTable = await played(wd, 2, [27, 25]);
    const without = await played(mc, 3, [20, 30]);
    const open = await played(wd, 4, null);
    const cookie = await loginAs(kid);
    const page = (await api("/events?limit=20&past=1&teams=all", { cookie })).body as EventPage;
    const game = (id: number) => page.events.find((e: EventSummary) => e.id === id)!.game!;
    expect(game(withTable).inTable).toBe(true);
    expect(game(without).inTable).toBe(false);
    // No result: nothing to say
    expect(game(open).inTable).toBeUndefined();

    expect((await api(`/events/${withTable}`, { cookie })).body.game.inTable).toBe(true);
    expect((await api(`/events/${without}`, { cookie })).body.game.inTable).toBe(false);

    // The module of the source switched off: its table no longer counts
    await saveClub(env.DB, { modules: { ...DEFAULT_MODULES, handball4all: false } });
    const off = (await api("/events?limit=20&past=1&teams=all", { cookie })).body as EventPage;
    expect(off.events.find((e) => e.id === withTable)!.game!.inTable).toBe(false);
  });

  it("for fans in the list and on the fan game page", async () => {
    await saveClub(env.DB, { modules: { ...DEFAULT_MODULES, fans: true } });
    const withTable = await played(wd, 2, [27, 25]);
    const without = await played(mc, 3, [20, 30]);
    const cookie = await loginAs(fan);
    await api(`/fans/follows/${wd}`, { method: "PUT", cookie, body: { follow: true } });
    await api(`/fans/follows/${mc}`, { method: "PUT", cookie, body: { follow: true } });
    const page = (await api("/events?limit=20&past=1&teams=none&fans.games=1", { cookie })).body as EventPage;
    const games = (page.modules.fans as FansPage).games;
    expect(games.find((g) => g.id === withTable)!.game!.inTable).toBe(true);
    expect(games.find((g) => g.id === without)!.game!.inTable).toBe(false);
    expect(((await api(`/fans/games/${withTable}`, { cookie })).body as FanGamePage).game!.inTable).toBe(true);
    expect(((await api(`/fans/games/${without}`, { cookie })).body as FanGamePage).game!.inTable).toBe(false);
  });
});
