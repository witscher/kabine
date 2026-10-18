// Game schedule from CSV: header detection, formats, problems. Invented clubs.
import { describe, expect, it } from "vitest";
import { parseGameCsv } from "../shared/game-csv";

describe("Spielplan aus CSV", () => {
  it("liest Kopfzeile auf Deutsch, Semikolon, deutsche Formate", () => {
    const { games, problems } = parseGameCsv("Datum;Uhrzeit;Gegner;Heim;Halle\n07.11.2026;14:00;HSG Gegnerstadt;H;Sporthalle Nord\n14.11.26;16.30;TV Beispiel;A;\n");
    expect(problems).toEqual([]);
    expect(games).toEqual([
      { line: 2, date: "2026-11-07", time: "14:00", opponent: "HSG Gegnerstadt", isHome: true, venue: "Sporthalle Nord" },
      { line: 3, date: "2026-11-14", time: "16:30", opponent: "TV Beispiel", isHome: false, venue: null },
    ]);
  });

  it("ohne Kopfzeile: Datum, Zeit, Gegner, Heim, Ort; Komma und Anführungszeichen", () => {
    const { games } = parseGameCsv('2026-11-07,14:00,"FC Komma, e.V.",home,"Halle ""Süd"""');
    expect(games[0]).toMatchObject({ opponent: "FC Komma, e.V.", isHome: true, venue: 'Halle "Süd"' });
  });

  it("andere Reihenfolge in der Kopfzeile auf Englisch", () => {
    const { games } = parseGameCsv("Opponent\tDate\tTime\tHome/Away\nSC Test\t2026-12-01\t18:00\taway");
    expect(games).toEqual([{ line: 2, date: "2026-12-01", time: "18:00", opponent: "SC Test", isHome: false, venue: null }]);
  });

  it("meldet fehlerhafte Zeilen", () => {
    const { games, problems } = parseGameCsv("Datum;Uhrzeit;Gegner;Heim\n31.02.2026;14:00;X;H\n01.03.2026;25:00;X;H\n02.03.2026;10:00;;H\n03.03.2026;10:00;Y;vielleicht\n04.03.2026;10:00;Z;H");
    expect(games.map((g) => g.opponent)).toEqual(["Z"]);
    expect(problems.map((p) => [p.line, p.field])).toEqual([
      [2, "date"],
      [3, "time"],
      [4, "opponent"],
      [5, "home"],
    ]);
    expect(parseGameCsv("Datum;Halle\n01.03.2026;X").problems[0]).toMatchObject({ field: "columns" });
  });
});

describe("Spielplan-Import über die API", () => {
  it("Vorschau, Anlegen, Dubletten und Vergangenheit übersprungen, nur Trainer", async () => {
    const { api, freshDb, loginAs, member, person, rows, season, team } = await import("./helpers");
    const { addDays, todayLocal } = await import("../worker/lib/time");
    await freshDb();
    await season();
    const wd = await team("wD", "wD");
    const coach = await person("Tara");
    await member(coach, wd, "coach");
    const cookie = await loginAs(coach);
    const d1 = addDays(todayLocal(), 10);
    const csv = `Datum;Uhrzeit;Gegner;Heim;Halle\n${d1};14:00;HSG Gegnerstadt;H;Halle Nord\n2020-01-01;10:00;Alt;A;\n${d1};kaputt;X;H;`;
    const preview = await api(`/teams/${wd}/game-import`, { cookie, body: { csv } });
    expect(preview.body.created).toBe(0);
    expect(preview.body.games.map((g: any) => [g.opponent, g.past, g.duplicate])).toEqual([
      ["HSG Gegnerstadt", false, false],
      ["Alt", true, false],
    ]);
    expect(preview.body.problems).toHaveLength(1);
    expect(await rows("SELECT id FROM events")).toHaveLength(0);
    const done = await api(`/teams/${wd}/game-import`, { cookie, body: { csv, commit: true } });
    expect(done.body.created).toBe(1);
    expect(await rows("SELECT is_home, guest_team, ends_at FROM events")).toEqual([{ is_home: 1, guest_team: "HSG Gegnerstadt", ends_at: `${d1}T15:30` }]);
    expect(await rows("SELECT name, kind FROM locations")).toEqual([{ name: "Halle Nord", kind: "custom" }]);
    // Zweiter Lauf: Dublette
    const again = await api(`/teams/${wd}/game-import`, { cookie, body: { csv, commit: true } });
    expect(again.body.created).toBe(0);
    expect(again.body.games[0].duplicate).toBe(true);
    const other = await loginAs(await person("Pia"));
    expect((await api(`/teams/${wd}/game-import`, { cookie: other, body: { csv } })).status).toBe(403);
  });
});
