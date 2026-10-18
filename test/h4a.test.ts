import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { ownTeamName, parsePortalUrl, parseSchedule } from "../worker/domain/h4a";
import { addDays, todayLocal } from "../worker/lib/time";
import { importGames } from "../worker/routes/games";
import { api, exec, freshDb, loginAs, member, one, person, rows, season, team } from "./helpers";

function ddmmyy(date: string) {
  const [y, m, d] = date.split("-");
  return `${d}.${m}.${y!.slice(2)}`;
}

function game(id: string, date: string, time: string, home: string, guest: string, gymId: string, gymName: string) {
  return {
    gID: id,
    gNo: `7${id}`,
    gDate: ddmmyy(date),
    gWDay: "Sa",
    gTime: time,
    gGymnasiumID: gymId,
    gGymnasiumName: gymName,
    gGymnasiumPostal: "76000",
    gGymnasiumTown: "Musterstadt",
    gGymnasiumStreet: "Hallenweg 1",
    gHomeTeam: home,
    gGuestTeam: guest,
    gHomeGoals: " ",
    gGuestGoals: " ",
  };
}

function payload(games: object[], past: object[] = []) {
  return [
    {
      head: { name: "weibliche D-Jugend Testliga" },
      content: {
        actualGames: [{ gClassID: "555", games: past }],
        futureGames: { gClassID: "555", games },
        teamsList: [{ teamID: "999", teamName: "TV Heimverein" }],
      },
    },
  ];
}

describe("handball4all", () => {
  it("liest Portal- und API-Links", () => {
    expect(parsePortalUrl("https://www.handball4all.de/home/portal/baden-wuerttembergischer-hv#/league?ogId=216&lId=164621&tId=1489086")).toEqual({
      orgId: 216,
      leagueId: 164621,
      teamId: 1489086,
    });
    expect(parsePortalUrl("https://spo.handball4all.de/service/if_g_json.php?cmd=ps&og=1&cl=2&ct=3")).toEqual({ orgId: 1, leagueId: 2, teamId: 3 });
    expect(parsePortalUrl("https://example.org/#/league?ogId=1&lId=2&tId=3")).toBeNull();
    expect(parsePortalUrl("kein link")).toBeNull();
  });

  it("parst Listen- und Objektform und erkennt die eigene Mannschaft", () => {
    const s = parseSchedule(
      payload(
        [game("2", "2026-11-07", "14:00", "SG Gast", "TV Heimverein", "20", "Gasthalle")],
        [game("1", "2026-09-26", "12:45", "TV Heimverein", "HSG Andere", "10", "Heimhalle")],
      ),
    );
    expect(s.leagueId).toBe("555");
    expect(s.games.map((g) => [g.gameId, g.date, g.time])).toEqual([
      ["1", "2026-09-26", "12:45"],
      ["2", "2026-11-07", "14:00"],
    ]);
    expect(ownTeamName(s.games, null, new Set())).toBe("TV Heimverein");
  });

  it("lehnt fremde Formate ab", () => {
    expect(() => parseSchedule({ foo: 1 })).toThrow();
    expect(() => parseSchedule([{ content: {} }])).toThrow();
  });

  describe("Import", () => {
    let wd: number;
    beforeEach(async () => {
      await freshDb();
      await season();
      wd = await team("wD", "wD");
      await exec("UPDATE teams SET h4a_org_id = 1, h4a_league_id = 555, h4a_team_id = 999 WHERE id = ?", wd);
      await exec("INSERT INTO locations (id, name, kind, h4a_gym_id) VALUES (1, 'Vereinshalle', 'hall', 10)");
    });

    async function teamRow() {
      return one<any>("SELECT * FROM teams WHERE id = ?", wd);
    }

    it("Spieltage (Platzhalter „Spieltag gF“): Heimspieltag beim eigenen Verein oder in eigener Halle", async () => {
      const d = (n: number) => addDays(todayLocal(), n);
      const res = await importGames(
        env,
        await teamRow(),
        payload([
          game("1", d(5), "10:00", "HSG Andere", "Spieltag gF", "20", "Gasthalle"),
          game("2", d(12), "10:00", "TV Heimverein", "Spieltag gF", "30", "Ausweichhalle"),
          game("3", d(19), "13:00", "Gastgeber TS", "Spieltag gF", "10", "Vereinshalle"),
        ]),
      );
      expect(res).toMatchObject({ created: 3, skipped: 0 });
      expect(await rows("SELECT h4a_game_id, is_home FROM events ORDER BY h4a_game_id")).toEqual([
        { h4a_game_id: "1", is_home: 0 },
        { h4a_game_id: "2", is_home: 1 },
        { h4a_game_id: "3", is_home: 1 },
      ]);
      const coach = await person("Tina");
      await member(coach, wd, "coach");
      const events = (await api("/events", { cookie: await loginAs(coach) })).body.events;
      expect(events.map((e: any) => e.title)).toEqual(["Spieltag bei HSG Andere", "Heimspieltag K wD", "Heimspieltag K wD"]);
    });

    it("legt Spiele an, ordnet Hallen zu und erkennt Verlegungen und Absagen", async () => {
      const d1 = addDays(todayLocal(), 10);
      const d2 = addDays(todayLocal(), 17);
      const first = await importGames(
        env,
        await teamRow(),
        payload([
          game("1", d1, "14:00", "TV Heimverein", "HSG Andere", "10", "Vereinshalle"),
          game("2", d2, "16:00", "SG Gast", "TV Heimverein", "20", "Gasthalle"),
        ]),
      );
      expect(first).toMatchObject({ created: 2, updated: 0, cancelled: 0 });
      const games = await rows<any>("SELECT h4a_game_id, is_home, location_id, starts_at FROM events ORDER BY h4a_game_id");
      expect(games[0]).toMatchObject({ h4a_game_id: "1", is_home: 1, location_id: 1 });
      expect(games[1]).toMatchObject({ h4a_game_id: "2", is_home: 0 });
      const external = await one<any>("SELECT kind, name, address FROM locations WHERE h4a_gym_id = 20");
      expect(external).toEqual({ kind: "external", name: "Gasthalle", address: "Hallenweg 1, 76000 Musterstadt" });

      // Trainer-Ergänzungen bleiben beim erneuten Import erhalten
      await exec("UPDATE events SET meeting_point = 'Parkplatz' WHERE h4a_game_id = '2'");
      const second = await importGames(env, await teamRow(), payload([game("2", d2, "17:30", "SG Gast", "TV Heimverein", "20", "Gasthalle")]));
      expect(second).toMatchObject({ created: 0, updated: 1, moved: 1, cancelled: 1 });
      const moved = await one<any>("SELECT starts_at, meeting_point FROM events WHERE h4a_game_id = '2'");
      expect(moved).toEqual({ starts_at: `${d2}T17:30`, meeting_point: "Parkplatz" });
      const cancelled = await one<any>("SELECT cancelled_at, cancel_reason FROM events WHERE h4a_game_id = '1'");
      expect(cancelled.cancel_reason).toContain("nicht mehr im Spielplan");

      // Die Spielansicht verlinkt die Ligatabelle bei handball4all
      const id = (await one<{ id: number }>("SELECT id FROM events WHERE h4a_game_id = '2'")).id;
      const coach = await person("Trainerin");
      await member(coach, wd, "coach");
      const detail = await api(`/events/${id}`, { cookie: await loginAs(coach) });
      expect(detail.body.game.tableUrl).toBe("https://www.handball4all.de/home/portal/baden-wuerttembergischer-hv#/league?ogId=1&lId=555&tId=999");
    });

    it("Abruf muss reserviert sein, und nur einmal gleichzeitig", async () => {
      const coach = await person("Coach");
      await member(coach, wd, "coach");
      const cookie = await loginAs(coach);
      const noClaim = await api(`/teams/${wd}/games/import`, { cookie, body: { data: payload([]) } });
      expect(noClaim.status).toBe(409);
      const claim = await api(`/teams/${wd}/games/claim`, { cookie, body: { manual: true } });
      expect(claim.body).toMatchObject({ claimed: true });
      expect(claim.body.fetchUrl).toBe("https://spo.handball4all.de/service/if_g_json.php?cmd=ps&og=1&cl=555&ct=999");
      const again = await api(`/teams/${wd}/games/claim`, { cookie, body: { manual: true } });
      expect(again.body).toMatchObject({ claimed: false, reason: "busy" });
      const imported = await api(`/teams/${wd}/games/import`, { cookie, body: { data: payload([]) } });
      expect(imported.status).toBe(200);
      // Automatische Abrufe gibt es nicht (handball4all ist fair use)
      const auto = await api(`/teams/${wd}/games/claim`, { cookie, body: { manual: false } });
      expect(auto.body).toMatchObject({ claimed: false, reason: "manual_only" });
    });

    it("verknüpft kein Spiel einer fremden Mannschaft und sagt es nicht ab", async () => {
      const d = addDays(todayLocal(), 10);
      const wc = await team("wC", "wC");
      await exec("UPDATE teams SET h4a_org_id = 1, h4a_league_id = 555, h4a_team_id = 998 WHERE id = ?", wc);
      const rowOf = (id: number) => one<any>("SELECT * FROM teams WHERE id = ?", id);
      // Das Spiel gehört schon der wC
      await importGames(env, await rowOf(wc), payload([game("50", d, "14:00", "TV Heimverein", "HSG Andere", "10", "Vereinshalle")]));
      const teamsOf = async () =>
        (await rows<{ team_id: number }>("SELECT team_id FROM event_teams et JOIN events e ON e.id = et.event_id WHERE e.h4a_game_id = '50'")).map((r) => r.team_id);
      // Der Trainer der wD schickt dieselbe Spiel-ID: wird übersprungen
      const res = await importGames(env, await teamRow(), payload([game("50", d, "14:00", "TV Heimverein", "HSG Andere", "10", "Vereinshalle")]), Date.now(), (id) => id === wd);
      expect(res).toMatchObject({ created: 0, updated: 0, foreign: 1 });
      expect(await teamsOf()).toEqual([wc]);
      // Trainer beider Mannschaften (oder Admin) darf verknüpfen
      const both = await importGames(env, await teamRow(), payload([game("50", d, "14:00", "TV Heimverein", "HSG Andere", "10", "Vereinshalle")]), Date.now(), () => true);
      expect(both).toMatchObject({ updated: 1, foreign: 0 });
      expect((await teamsOf()).sort()).toEqual([wd, wc].sort());
      // Ein späterer Import der wD ohne das Spiel sagt das gemeinsame Spiel nicht ab
      const later = await importGames(env, await teamRow(), payload([]));
      expect(later.cancelled).toBe(0);
      expect((await one<any>("SELECT cancelled_at FROM events WHERE h4a_game_id = '50'")).cancelled_at).toBeNull();
    });

    it("verlangt die Liga in den Daten", async () => {
      const none = payload([]);
      delete (none[0]!.content.futureGames as any).gClassID;
      delete (none[0]!.content.actualGames as any)[0].gClassID;
      await expect(importGames(env, await teamRow(), none)).rejects.toThrow("keine Liga");
    });

    it("lehnt Daten einer anderen Liga ab", async () => {
      const wrong = payload([]);
      (wrong[0]!.content.futureGames as any).gClassID = "777";
      (wrong[0]!.content.actualGames as any)[0].gClassID = "777";
      await expect(importGames(env, await teamRow(), wrong)).rejects.toThrow("anderen Liga");
    });
  });
});

describe("Dauer „Läuft gerade“", () => {
  it("richtet sich nach der Spieldauer der Altersklasse, bei mehreren Mannschaften die längste", async () => {
    const { gameLiveMinutes } = await import("../worker/domain/events");
    expect(gameLiveMinutes([90])).toBe(90);
    expect(gameLiveMinutes([90, 120])).toBe(120);
    expect(gameLiveMinutes([])).toBe(120);
  });
});
