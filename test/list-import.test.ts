// Reading the club's lists in the setup wizard: columns, names, years, roles, one person across lists. Invented names.
import { describe, expect, it } from "vitest";
import {
  cellText,
  guessMapping,
  mergeRows,
  mergeTwo,
  resolveSame,
  parseDelimited,
  parseRole,
  parseYear,
  rowsOfSheet,
  sheetFromRows,
  splitName,
  suggestTeams,
  type ImportAgeClass,
} from "../shared/list-import";
import { api, freshDb, loginAs, person, rows, season, team } from "./helpers";

const now = new Date(2026, 9, 21);

describe("Listen lesen", () => {
  it("eingefügte Tabellen und CSV mit Anführungszeichen", () => {
    expect(parseDelimited("Name\tJg.\nKim Muster\t2014\n\n")).toEqual([
      ["Name", "Jg."],
      ["Kim Muster", "2014"],
    ]);
    expect(parseDelimited('Name;Mannschaft\n"Muster; Kim";wD1\r\n')).toEqual([
      ["Name", "Mannschaft"],
      ["Muster; Kim", "wD1"],
    ]);
  });

  it("Kopfzeile unter Titelzeilen, Spalten erkannt, Rest ignoriert", () => {
    const sheet = sheetFromRows("s1", "kader.xlsx", "Tabelle1", [
      ["Kader Saison 26/27", "", "", ""],
      ["Mannschaft", "Name", "Jg.", "Telefon"],
      ["wD1", "Muster, Kim", "14", "0123"],
    ]);
    expect(sheet.headerRow).toBe(2);
    expect(sheet.mapping).toEqual(["team", "name", "birthYear", "ignore"]);
    expect(rowsOfSheet(sheet)).toEqual([
      {
        firstName: "Kim",
        lastName: "Muster",
        birthYear: 2014,
        team: "wD1",
        role: "player",
        source: { file: "kader.xlsx", sheet: "Tabelle1", row: 3 },
        doubts: ["birthYear"],
        rawName: null,
      },
    ]);
    const coaches = sheetFromRows("s2", "Trainer.xlsx", "wD1", [["Vorname", "Nachname"], ["Alex", "Probe"]]);
    expect(coaches).toMatchObject({ team: "wD1", role: "coach" });
    expect(rowsOfSheet(coaches)[0]).toMatchObject({ team: "wD1", role: "coach" });
    expect(sheetFromRows("s3", "liste.csv", "Tabelle1", [["Name"], ["Kim"]])).toMatchObject({ team: "", role: "player" });
    expect(guessMapping(["Vorname", "Nachname", "Name", "Geburtsdatum"])).toEqual(["firstName", "lastName", "ignore", "birthDate"]);
  });

  it("Namen, Jahrgänge und Rollen", () => {
    expect(splitName("Becker, Ben")).toMatchObject({ firstName: "Ben", lastName: "Becker", doubt: null });
    expect(splitName("Ben Becker (2012)")).toMatchObject({ firstName: "Ben", lastName: "Becker", year: 2012 });
    expect(splitName("Lisa-Marie van der Probe")).toMatchObject({ firstName: "Lisa-Marie", lastName: "van der Probe", doubt: null });
    expect(splitName("Anna Lena Beispiel")).toMatchObject({ firstName: "Anna Lena", lastName: "Beispiel", doubt: "name" });
    expect(splitName("Toni (TW)")).toMatchObject({ firstName: "Toni", lastName: "", doubt: "name" });
    expect(cellText(new Date(Date.UTC(2014, 0, 1)))).toBe("01.01.2014");
    expect(parseYear("03.05.2014", now)).toBe(2014);
    expect(parseYear("2014-05-03", now)).toBe(2014);
    expect(parseYear("Jg. 15", now)).toBe(2015);
    expect(parseYear("85", now)).toBe(1985);
    expect(parseYear("41760", now)).toBe(2014);
    expect(parseYear("unbekannt", now)).toBeNull();
    expect(["Trainer", "Co-Trainerin", "Betreuer", "Physio", "TW", ""].map(parseRole)).toEqual(["coach", "coach", "staff", "staff", "player", "player"]);
  });
});

describe("Personen zusammenführen", () => {
  const source = { file: "a.xlsx", sheet: "S", row: 2 };
  const row = (firstName: string, lastName: string, extra: Partial<Parameters<typeof mergeRows>[0][number]> = {}) => ({
    firstName,
    lastName,
    birthYear: null,
    team: null,
    role: "player" as const,
    source,
    doubts: [],
    rawName: null,
    ...extra,
  });

  it("eine Person über mehrere Listen, Angaben ergänzen sich", () => {
    const { persons, questions } = mergeRows([
      row("Kim", "Müller", { team: "wD1" }),
      row("Kim", "Mueller", { birthYear: 2014, source: { ...source, file: "b.xlsx" } }),
      row("Alex", "Probe", { team: "wD1", role: "coach" }),
      row("Alex", "Probe", { team: "Damen 1" }),
    ]);
    expect(persons).toHaveLength(2);
    expect(persons[0]).toMatchObject({ firstName: "Kim", birthYear: 2014, memberships: [{ team: "wD1", role: "player" }] });
    expect(persons[0]!.sources).toHaveLength(2);
    expect(persons[1]!.memberships).toEqual([
      { team: "wD1", role: "coach" },
      { team: "Damen 1", role: "player" },
    ]);
    expect(questions).toEqual([]);
  });

  it("Rolle aus einer Liste ohne Mannschaft gilt für die Mannschaften der Person", () => {
    const { persons } = mergeRows([row("Alex", "Probe", { team: "mC" }), row("Alex", "Probe", { role: "coach" })]);
    expect(persons[0]!.memberships).toEqual([
      { team: "mC", role: "player" },
      { team: "mC", role: "coach" },
    ]);
  });

  it("Widersprüche und ähnliche Namen werden zu Fragen", () => {
    const { persons, questions } = mergeRows([
      row("Kim", "Muster", { team: "wD1", birthYear: 2014 }),
      row("Kim", "Muster", { birthYear: 2015 }),
      row("Jonas", "Beispiel", { team: "mC" }),
      row("Jonah", "Beispiel", { team: "mC" }),
      row("Toni", "Test"),
    ]);
    expect(questions).toEqual(
      expect.arrayContaining([
        { kind: "birth-year", key: "kim|muster", years: [2014, 2015] },
        { kind: "maybe-same", keys: ["jonah|beispiel", "jonas|beispiel"] },
        { kind: "no-team", key: "toni|test" },
      ]),
    );
    expect(questions).toHaveLength(3);
    const merged = mergeTwo(persons, "jonas|beispiel", "jonah|beispiel");
    expect(merged).toHaveLength(3);
    expect(merged.find((p) => p.key === "jonas|beispiel")!.memberships).toEqual([{ team: "mC", role: "player" }]);
    // Merging decides the open questions about the two and asks for the birth year if they disagree
    const kim2 = mergeRows([row("Kim", "Muster", { team: "wD1", birthYear: 2014 }), row("Kimi", "Muster")]);
    expect(kim2.questions).toEqual([
      { kind: "no-team", key: "kimi|muster" },
      { kind: "maybe-same", keys: ["kim|muster", "kimi|muster"] },
    ]);
    expect(resolveSame(kim2.persons, kim2.questions, "kim|muster", "kimi|muster").questions).toEqual([]);
    const two = mergeRows([row("Kim", "Muster", { team: "wD1", birthYear: 2014 }), row("Kimi", "Muster", { team: "wD1", birthYear: 2015 })]);
    expect(two.questions).toEqual([]);
    expect(resolveSame(two.persons, two.questions, "kim|muster", "kimi|muster").questions).toEqual([{ kind: "birth-year", key: "kim|muster", years: [2014, 2015] }]);
  });
});

describe("Mannschaften vorschlagen", () => {
  const ageClasses: ImportAgeClass[] = [
    { code: "D", name: "D-Jugend", birthYearMin: 2014, birthYearMax: 2015 },
    { code: "C", name: "C-Jugend", birthYearMin: 2012, birthYearMax: 2013 },
    { code: "SEN", name: "Erwachsene", birthYearMin: null, birthYearMax: null },
  ];
  const person = (team: string, birthYear: number | null = null) => ({
    key: `${team}|${birthYear}`,
    firstName: "Kim",
    lastName: "Muster",
    birthYear,
    birthYears: birthYear ? [birthYear] : [],
    memberships: [{ team, role: "player" as const }],
    sources: [],
    doubts: [],
    rawName: null,
    excluded: false,
  });

  it("Altersklasse aus dem Namen oder den Jahrgängen, Geschlecht aus dem Namen", () => {
    expect(suggestTeams([person("wD1"), person("C-Jugend männlich"), person("Minis", 2013), person("Herren 1")], ageClasses, ["herren 1"])).toEqual([
      { name: "C-Jugend männlich", ageClassCode: "C", gender: "m", existing: false },
      { name: "Herren 1", ageClassCode: "SEN", gender: "m", existing: true },
      { name: "Minis", ageClassCode: "C", gender: "x", existing: false },
      { name: "wD1", ageClassCode: "D", gender: "f", existing: false },
    ]);
  });
});

describe("Listen übernehmen", () => {
  const body = {
    teams: [
      { name: "wD1", ageClassCode: "wD", gender: "f" },
      { name: "Damen", ageClassCode: "F", gender: "f" },
      { name: "Unbenutzt", ageClassCode: "wD", gender: "x" },
    ],
    persons: [
      { firstName: "Kim", lastName: "Müller", birthYear: 2014, memberships: [{ team: "wD1", role: "player" }] },
      { firstName: "Alex", lastName: "Probe", birthYear: null, memberships: [{ team: "wD1", role: "coach" }, { team: "Damen", role: "player" }] },
      { firstName: "Ria", lastName: "Beispiel", birthYear: null, memberships: [{ team: "Damen", role: "staff" }] },
    ],
  };

  it("legt Mannschaften und Personen an, ein zweiter Lauf findet alles wieder", async () => {
    await freshDb();
    await season();
    const existing = await team("Damen", "F");
    await person("Kim", { lastName: "Mueller" });
    const admin = await person("Ada", { admin: true });
    const cookie = await loginAs(admin);
    const first = await api("/admin/import/commit", { cookie, body });
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ teamsCreated: 1, personsCreated: 2, personsFound: 1, membershipsAdded: 4 });
    expect(await rows("SELECT name, age_class_code, gender, parents_enabled FROM teams ORDER BY name")).toEqual([
      { name: "Damen", age_class_code: "F", gender: "f", parents_enabled: 1 },
      { name: "wD1", age_class_code: "wD", gender: "f", parents_enabled: 1 },
    ]);
    expect(
      await rows(
        "SELECT p.first_name, p.last_name, p.birth_year, t.name AS team, tm.role FROM team_memberships tm JOIN persons p ON p.id = tm.person_id JOIN teams t ON t.id = tm.team_id ORDER BY p.first_name, t.name",
      ),
    ).toEqual([
      { first_name: "Alex", last_name: "Probe", birth_year: null, team: "Damen", role: "player" },
      { first_name: "Alex", last_name: "Probe", birth_year: null, team: "wD1", role: "coach" },
      { first_name: "Kim", last_name: "Mueller", birth_year: 2014, team: "wD1", role: "player" },
      { first_name: "Ria", last_name: "Beispiel", birth_year: null, team: "Damen", role: "staff" },
    ]);
    expect((await rows("SELECT id FROM teams WHERE name = 'Damen'"))[0]).toEqual({ id: existing });
    const again = await api("/admin/import/commit", { cookie, body });
    expect(again.body).toEqual({ teamsCreated: 0, personsCreated: 0, personsFound: 3, membershipsAdded: 0 });
  });

  it("nur Admins, Altersklasse muss es geben", async () => {
    await freshDb();
    await season();
    const coach = await person("Theo");
    expect((await api("/admin/import/commit", { cookie: await loginAs(coach), body })).status).toBe(403);
    const cookie = await loginAs(await person("Ada", { admin: true }));
    const bad = await api("/admin/import/commit", { cookie, body: { ...body, teams: [{ name: "wD1", ageClassCode: "XYZ", gender: "f" }] } });
    expect(bad.status).toBe(400);
    expect(await rows("SELECT 1 FROM teams")).toEqual([]);
  });
});
