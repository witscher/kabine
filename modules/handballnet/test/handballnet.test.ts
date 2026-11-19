// handball.net: what is special about this source. The general checks run for every connector in
// test/fixtures-contract.test.ts with the files in ../samples/. Invented names only.
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_MODULES } from "../../../shared/modules";
import { saveClub } from "../../../worker/domain/club";
import { importGames } from "../../../worker/domain/fixtures";
import { addDays, todayLocal, utcIso } from "../../../worker/lib/time";
import { api, exec, freshDb, loginAs, member, one, person, rows, season, team } from "../../../test/helpers";
import schedule from "../samples/schedule.json";
import { connector, parseCalendar, parseTeamLink } from "../worker/connector";

const compact = (date: string) => date.replaceAll("-", "");

/** A team calendar of handball.net with the given games. */
function calendar(name: string, games: { id: string; date: string; time: string; summary: string; location?: string; status?: string }[]) {
  const events = games.map((g) =>
    [
      "BEGIN:VEVENT",
      `UID:spiel-${g.id}@mmcc-news`,
      `DTSTART:${compact(g.date)}T${g.time.replace(":", "")}00`,
      `SUMMARY:${g.summary}`,
      `DESCRIPTION:Spieltag 1\\nSpielnummer 2627TEST${g.id}\\nProgramado`,
      `STATUS:${g.status ?? "CONFIRMED"}`,
      ...(g.location ? [`LOCATION:${g.location}`] : []),
      "END:VEVENT",
    ].join("\r\n"),
  );
  return ["BEGIN:VCALENDAR", "VERSION:2.0", `X-WR-CALNAME:${name}`, ...events, "END:VCALENDAR", ""].join("\r\n");
}

describe("handball.net", () => {
  it("reads team and calendar links", () => {
    expect(parseTeamLink("https://www.handball.net/team/70533?season_id=2627&phaseId=15125")).toEqual({ teamId: "70533" });
    expect(parseTeamLink("webcal://www.handball.net/kalender/team/70533.ics?t=1793864891722")).toEqual({ teamId: "70533" });
    expect(parseTeamLink("https://www.handball.net/match/469777")).toBeNull();
    expect(parseTeamLink("https://www.handball.net.example.org/team/70533")).toBeNull();
    expect(connector.request({ teamId: "70533" }).url).toBe("https://www.handball.net/kalender/team/70533.ics");
  });

  it("reads the calendar: folded lines, result, hall and address, games without a time or cancelled", () => {
    const parsed = parseCalendar(schedule);
    expect(parsed.name).toBe("TV Heimverein");
    expect(parsed.skipped).toBe(1);
    expect(parsed.games).toEqual([
      {
        externalId: "900001",
        number: "2627XXBKROBJMA0101",
        date: "2026-09-13",
        time: "12:00",
        home: "SG BEISPIELSTADT",
        guest: "TV Heimverein",
        venue: { externalId: expect.any(String), name: "GASTHALLE", address: "AM SPORTPLATZ 3, 76001 BEISPIELSTADT" },
        homeGoals: 15,
        guestGoals: 19,
      },
      {
        externalId: "900002",
        number: "2627XXBKROBJMA0501",
        date: "2026-11-07",
        time: "12:15",
        home: "TV Heimverein",
        guest: "HSG NACHBARORT II",
        venue: { externalId: expect.any(String), name: "MUSTERSTADT, SCHULZENTRUM", address: "HALLENWEG 1, 76000 MUSTERSTADT" },
        homeGoals: null,
        guestGoals: null,
      },
    ]);
  });

  it("rejects what is not a calendar of the team", () => {
    expect(() => connector.parse({ games: [] }, { teamId: "1" })).toThrow();
    expect(() => connector.parse("<html></html>", { teamId: "1" })).toThrow();
    const other = calendar("TV Heimverein", [{ id: "1", date: "2026-11-07", time: "14:00", summary: "SG Fremd - HSG Andere" }]);
    expect(() => connector.parse(other, { teamId: "1" })).toThrow();
  });

  describe("sync", () => {
    let wd: number;
    beforeEach(async () => {
      await freshDb();
      await season();
      await saveClub(env.DB, { modules: { ...DEFAULT_MODULES, handballnet: true } });
      wd = await team("wD", "wD");
      await exec("UPDATE teams SET fixture_connector = 'handballnet', fixture_source = ? WHERE id = ?", JSON.stringify({ teamId: "999" }), wd);
    });

    const teamRow = () => one<any>("SELECT * FROM teams WHERE id = ?", wd);

    it("creates the games from the calendar, home and away by the team's name, halls shared", async () => {
      const d = (n: number) => addDays(todayLocal(), n);
      const hall = "VEREINSHALLE\\, HALLENWEG 1\\, 76000 MUSTERSTADT\\, 76000 MUSTERSTADT";
      const res = await importGames(
        env,
        await teamRow(),
        calendar("TV Heimverein", [
          { id: "11", date: d(5), time: "14:00", summary: "TV Heimverein - HSG Andere", location: hall },
          { id: "12", date: d(12), time: "16:30", summary: "SG Gast - TV Heimverein", location: "GASTHALLE\\, AM SPORTPLATZ 3\\, 76001 GASTORT" },
          { id: "13", date: d(19), time: "18:00", summary: "TV Heimverein - SG Gast", location: hall },
        ]),
      );
      expect(res).toMatchObject({ created: 3, skipped: 0 });
      expect(await rows("SELECT external_ref, is_home FROM events ORDER BY external_ref")).toEqual([
        { external_ref: "handballnet:11", is_home: 1 },
        { external_ref: "handballnet:12", is_home: 0 },
        { external_ref: "handballnet:13", is_home: 1 },
      ]);
      const halls = await rows<{ n: number }>("SELECT COUNT(DISTINCT location_id) AS n FROM events");
      expect(halls[0]!.n).toBe(2);
    });

    it("the coach's device fetches the calendar as text, only reserved and at the press of a button", async () => {
      const coach = await person("Coach");
      await member(coach, wd, "coach");
      const cookie = await loginAs(coach);
      const claim = await api(`/teams/${wd}/games/claim`, { cookie, body: { manual: true } });
      expect(claim.body).toEqual({ claimed: true, fetchUrl: "https://www.handball.net/kalender/team/999.ics", fetchFormat: "text" });
      const d = addDays(todayLocal(), 10);
      const data = calendar("TV Heimverein", [{ id: "21", date: d, time: "15:00", summary: "TV Heimverein - HSG Andere" }]);
      const imported = await api(`/teams/${wd}/games/import`, { cookie, body: { data } });
      expect(imported.status).toBe(200);
      expect(imported.body).toMatchObject({ created: 1 });
      // Just synced: not due by itself
      const auto = await api(`/teams/${wd}/games/claim`, { cookie, body: { manual: false } });
      expect(auto.body).toMatchObject({ claimed: false, reason: "not_due" });
    });

    it("syncs by itself once the last sync is 7 days old, never twice at the same time", async () => {
      const coach = await person("Coach");
      await member(coach, wd, "coach");
      const cookie = await loginAs(coach);
      const claimAuto = async () => (await api(`/teams/${wd}/games/claim`, { cookie, body: { manual: false } })).body;
      const syncedDaysAgo = (n: number) => exec("UPDATE teams SET fixture_synced_at = ? WHERE id = ?", utcIso(Date.now() - n * 86_400_000), wd);
      await syncedDaysAgo(6);
      expect(await claimAuto()).toEqual({ claimed: false, reason: "not_due" });
      await syncedDaysAgo(7);
      expect(await claimAuto()).toEqual({ claimed: true, fetchUrl: "https://www.handball.net/kalender/team/999.ics", fetchFormat: "text" });
      // A second device (or a button) while the first one fetches
      expect(await claimAuto()).toMatchObject({ claimed: false, reason: "busy" });
      expect((await api(`/teams/${wd}/games/claim`, { cookie, body: { manual: true } })).body).toMatchObject({ claimed: false, reason: "busy" });
      // The fetch failed: the error stays on the team, the next app start tries again
      await api(`/teams/${wd}/games/release`, { cookie, body: { error: "HTTP 503" } });
      expect(await teamRow()).toMatchObject({ fixture_error: expect.stringContaining("HTTP 503"), fixture_claimed_at: null });
      expect(await claimAuto()).toMatchObject({ claimed: true });
      const data = calendar("TV Heimverein", [{ id: "31", date: addDays(todayLocal(), 4), time: "11:00", summary: "SG Gast - TV Heimverein" }]);
      expect((await api(`/teams/${wd}/games/import`, { cookie, body: { data } })).body).toMatchObject({ created: 1 });
      expect(await teamRow()).toMatchObject({ fixture_error: null, fixture_claimed_at: null });
      expect(await claimAuto()).toEqual({ claimed: false, reason: "not_due" });
    });
  });
});
