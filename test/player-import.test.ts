// Player list import for coaches and the reach overview of the team. Invented names.
import { describe, expect, it } from "vitest";
import { parsePlayerList } from "../shared/player-list";
import { api, exec, freshDb, guardian, loginAs, member, person, rows, season, team } from "./helpers";

describe("Spielerliste lesen", () => {
  it("Spalten aus der Tabelle, mit und ohne Kopfzeile", () => {
    expect(parsePlayerList("Vorname\tNachname\tJahrgang\nKim\tMuster\t2014\nAlex\tBeispiel\t", 2026).players).toEqual([
      { line: 2, firstName: "Kim", lastName: "Muster", birthYear: 2014 },
      { line: 3, firstName: "Alex", lastName: "Beispiel", birthYear: null },
    ]);
    expect(parsePlayerList("Kim;Muster;2014\nLea Sophie Probe 2015\nTest, Toni\nJo", 2026).players).toEqual([
      { line: 1, firstName: "Kim", lastName: "Muster", birthYear: 2014 },
      { line: 2, firstName: "Lea Sophie", lastName: "Probe", birthYear: 2015 },
      { line: 3, firstName: "Toni", lastName: "Test", birthYear: null },
      { line: 4, firstName: "Jo", lastName: null, birthYear: null },
    ]);
    expect(parsePlayerList("Name;Jahrgang\nKim Muster;03.04.2014", 2026).players).toEqual([{ line: 2, firstName: "Kim", lastName: "Muster", birthYear: 2014 }]);
  });

  it("unplausible Jahrgänge und Zeilen ohne Vornamen werden gemeldet", () => {
    const { players, problems } = parsePlayerList("Kim;Muster;3014\n;Beispiel;2014\nAlex;Probe;2015", 2026);
    expect(players.map((p) => p.firstName)).toEqual(["Alex"]);
    expect(problems).toEqual([
      { line: 1, field: "year", value: "3014" },
      { line: 2, field: "name", value: ";Beispiel;2014" },
    ]);
  });
});

describe("Spielerliste übernehmen", () => {
  it("Vorschau, Anlegen, vorhandene Namen werden übersprungen", async () => {
    await freshDb();
    await season();
    const wd = await team("wD", "D");
    const wd2 = await team("wD2", "D", { level: 2 });
    const coach = await person("Theo");
    await member(coach, wd, "coach");
    await member(await person("Kim", { lastName: "Muster" }), wd);
    await member(await person("Ria", { lastName: "Probe" }), wd2);
    const cookie = await loginAs(coach);
    const players = [
      { firstName: "Kim", lastName: "Muster", birthYear: 2014 },
      { firstName: "Ria", lastName: "Probe", birthYear: 2015 },
      { firstName: "Alex", lastName: "Beispiel", birthYear: 2014 },
      { firstName: "alex", lastName: "beispiel", birthYear: 2014 },
    ];
    const preview = await api(`/teams/${wd}/players/import`, { cookie, body: { players } });
    expect(preview.status).toBe(200);
    expect(preview.body.rows.map((r: { status: string }) => r.status)).toEqual(["in_team", "other_team", "new", "in_team"]);
    expect(preview.body.rows[1].teams).toBe("wD2");
    expect(preview.body.created).toBe(0);
    expect(await rows("SELECT 1 FROM persons WHERE first_name = 'Alex'")).toHaveLength(0);

    const done = await api(`/teams/${wd}/players/import`, { cookie, body: { players, commit: true } });
    expect(done.body.created).toBe(1);
    expect(await rows("SELECT p.first_name, p.last_name, p.birth_year FROM team_memberships tm JOIN persons p ON p.id = tm.person_id WHERE tm.team_id = ? AND tm.role = 'player' ORDER BY p.first_name", wd)).toEqual([
      { first_name: "Alex", last_name: "Beispiel", birth_year: 2014 },
      { first_name: "Kim", last_name: "Muster", birth_year: null },
    ]);
    // Ein zweiter Lauf legt nichts doppelt an
    expect((await api(`/teams/${wd}/players/import`, { cookie, body: { players, commit: true } })).body.created).toBe(0);
  });

  it("nur Trainer der Mannschaft", async () => {
    await freshDb();
    await season();
    const wd = await team("wD", "D");
    const other = await person("Olga");
    const cookie = await loginAs(other);
    expect((await api(`/teams/${wd}/players/import`, { cookie, body: { players: [{ firstName: "Kim" }] } })).status).toBe(403);
  });

  it("Mannschaft zeigt, wer Benachrichtigungen hat, Eltern zählen für ihr Kind", async () => {
    await freshDb();
    await season();
    const wd = await team("wD", "D");
    const coach = await person("Theo");
    await member(coach, wd, "coach");
    const kim = await person("Kim");
    const parent = await person("Pia");
    await member(kim, wd);
    await guardian(parent, kim);
    const cookie = await loginAs(coach);
    await loginAs(parent);
    const before = await api(`/teams/${wd}`, { cookie });
    const row = before.body.players.find((p: { person: { id: number } }) => p.person.id === kim);
    expect(row.hasPush).toBe(false);
    expect(row.guardians[0]).toMatchObject({ hasAccount: true, hasPush: false });
    await exec(
      "INSERT INTO push_subscriptions (account_id, endpoint, p256dh, auth) SELECT id, 'https://push.example/1', 'k', 'a' FROM accounts WHERE person_id = ?",
      parent,
    );
    const after = await api(`/teams/${wd}`, { cookie });
    expect(after.body.players.find((p: { person: { id: number } }) => p.person.id === kim).guardians[0].hasPush).toBe(true);
  });
});
