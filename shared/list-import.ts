// Teams, coaches and players from the club's existing lists (setup wizard, src/list-import.tsx): several
// spreadsheets or pasted tables, each sheet with its own column mapping, one person per name across all of them.
// Pure functions, used by the app; the worker only receives the confirmed result (worker/routes/list-import.ts).
// Only name, birth year, team and role are read: other columns (phone, address, remarks) are dropped right away.

/** What a column holds. Everything else is "ignore". A date of birth counts as birthYear: only the year is kept. */
export const IMPORT_FIELDS = ["ignore", "name", "firstName", "lastName", "birthYear", "team", "role"] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];

export type ImportRole = "player" | "coach" | "staff";

/** One sheet of an uploaded file, or one pasted table. */
export interface ImportSheet {
  id: string;
  /** File name, or "Pasted list n" */
  file: string;
  sheet: string;
  header: string[];
  /** Rows below the header, cells as text */
  rows: string[][];
  /** Spreadsheet row number of the header (1 = first row), for pointing at the source of a person */
  headerRow: number;
  mapping: ImportField[];
  /** Team of rows without a team column or value: one sheet per team is common */
  team: string;
  /** Role of rows without a role column or value: a list of coaches, say */
  role: ImportRole;
}

export interface ImportSource {
  file: string;
  sheet: string;
  /** Row number as in the spreadsheet (1 = first row) */
  row: number;
}

/** A row read with its sheet's mapping. */
export interface ImportRow {
  firstName: string;
  lastName: string;
  birthYear: number | null;
  team: string | null;
  role: ImportRole;
  source: ImportSource;
  /** Why this row needs a look: the name could not be split surely, the year was guessed, … */
  doubts: string[];
}

export interface ImportMembership {
  team: string;
  role: ImportRole;
}

/** One person after merging all lists. */
export interface ImportPerson {
  key: string;
  firstName: string;
  lastName: string;
  birthYear: number | null;
  /** Years the lists disagree on (more than one: a question for the admin) */
  birthYears: number[];
  memberships: ImportMembership[];
  sources: ImportSource[];
  doubts: string[];
  excluded: boolean;
}

/**
 * Help a module offers the list import (src/module-api.ts, listImport), such as an AI that reads columns with
 * unusual headers. Only what the arguments hold leaves the browser: see assistInput, nothing readable of a person.
 */
export interface ImportAssist {
  /** A field for each column; "ignore" if unsure. */
  columns(header: string[], samples: string[][]): Promise<ImportField[]>;
}

/** Letters become X or x, digits and punctuation stay: "Müller, Anna (2014)" → "Xxxxxx, Xxxx (2014)", "wD1" → "xX1". */
export function maskCell(text: string): string {
  return text.replace(/\p{L}/gu, (ch) => (ch === ch.toLowerCase() && ch !== ch.toUpperCase() ? "x" : "X"));
}

/**
 * What a helper may see of a sheet: the headers, and masked samples of columns without one. A sheet without a
 * recognisable header row may have a person in its "header", so then the headers are masked as well.
 */
export function assistInput(sheet: ImportSheet): { header: string[]; samples: string[][] } {
  const headerKnown = sheet.header.filter((h) => guessField(h) !== "ignore").length >= 2;
  const header = sheet.header.map((h) => (headerKnown ? h : h && maskCell(h)));
  const samples = sheet.rows.slice(0, 3).map((r) => r.map((c, i) => (headerKnown && sheet.header[i]?.trim() ? "" : maskCell(c))));
  return { header, samples };
}

/** Something the admin decides before the import: maybe the same person, or which birth year is right. */
export type ImportQuestion =
  | { kind: "maybe-same"; keys: [string, string] }
  | { kind: "birth-year"; key: string; years: number[] }
  | { kind: "no-team"; key: string };

// Reading -----------------------------------------------------------------------------------------------------

/** Text of a cell as the spreadsheet reader returns it; it gives dates as midnight UTC, so read them in UTC. */
export function cellText(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date) {
    const d = value;
    return `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.${d.getUTCFullYear()}`;
  }
  return String(value).replace(/\s+/g, " ").trim();
}

/** A pasted table (from Excel: tabs) or CSV (semicolons or commas, quotes allowed). */
export function parseDelimited(text: string): string[][] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const first = lines.find((l) => l.trim()) ?? "";
  const delimiter = ["\t", ";", ","].map((d) => [d, first.split(d).length] as const).sort((a, b) => b[1] - a[1])[0]![0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const input = text.replace(/\r\n?/g, "\n");
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (quoted) {
      if (ch === '"' && input[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && !cell) quoted = true;
    else if (ch === delimiter) {
      row.push(cell.trim());
      cell = "";
    } else if (ch === "\n") {
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell.trim());
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c));
}

const FIELD_PATTERNS: [ImportField, RegExp][] = [
  ["firstName", /^(vor ?name|first ?name|given ?name|rufname)$/i],
  ["lastName", /^(nach ?name|familien ?name|last ?name|surname|family ?name)$/i],
  // "Geb.-Datum", "Geburtsdatum", "Jg.", "Jahrgang": dates and years alike, only the year is kept
  ["birthYear", /^(jg\.?|jhg\.?|jahrgang|geb(urts)?[.\s-]*(datum|dat\.?|jahr)|geb\.?|geboren( am)?|date of birth|birth ?(date|year)|year of birth|dob|year)$/i],
  ["team", /^(mannschaft|team|altersklasse|klasse|gruppe|kader|squad)$/i],
  ["role", /^(funktion|rolle|position|role|function|aufgabe)$/i],
  ["name", /^(name|spieler(in)?|spieler\/in|person|teilnehmer(in)?|teilnehmer\/in|akteur(in)?|akteur\/in|mitglied|player|full ?name|trainer ?name)$/i],
];

/** The field a column header suggests ("ignore" if none). */
export function guessField(header: string): ImportField {
  const h = header.trim().replace(/[:*]+$/, "");
  return FIELD_PATTERNS.find(([, re]) => re.test(h))?.[0] ?? "ignore";
}

/** Mapping for a sheet from its headers; each field only once (first match wins). */
export function guessMapping(header: string[]): ImportField[] {
  const used = new Set<ImportField>();
  const mapping = header.map((h) => {
    const f = guessField(h);
    if (f === "ignore" || used.has(f)) return "ignore";
    used.add(f);
    return f;
  });
  // A full name and separate first/last name columns: the separate ones win
  if (used.has("firstName") && used.has("lastName")) return mapping.map((f) => (f === "name" ? "ignore" : f));
  return mapping;
}

/** The header row: the first of the first ten rows that names at least two known fields (else the first row). */
export function findHeaderRow(rows: string[][]): number {
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    if (rows[i]!.filter((c) => guessField(c) !== "ignore").length >= 2) return i;
  }
  return 0;
}

/** A sheet from raw rows: header found, empty columns and rows dropped, mapping guessed. */
export function sheetFromRows(id: string, file: string, sheet: string, raw: string[][]): ImportSheet {
  const headerIndex = findHeaderRow(raw);
  const width = Math.max(0, ...raw.map((r) => r.length));
  const header = Array.from({ length: width }, (_, i) => raw[headerIndex]?.[i] ?? "");
  const rows = raw.slice(headerIndex + 1).map((r) => Array.from({ length: width }, (_, i) => r[i] ?? ""));
  const mapping = guessMapping(header);
  const generic = /^(tabelle|sheet|blatt|table|liste?|list)\s*\d*$/i.test(sheet.trim()) || !sheet.trim();
  const team = mapping.includes("team") || generic ? "" : sheet.trim().slice(0, 30);
  const role: ImportRole = mapping.includes("role") ? "player" : parseRole(`${sheet} ${file.replace(/\.[a-z]+$/i, "")}`);
  return { id, file, sheet, header, rows, headerRow: headerIndex + 1, mapping, team, role };
}

// Normalising ------------------------------------------------------------------------------------------------

const PARTICLES = new Set(["van", "von", "de", "der", "den", "da", "di", "del", "zu", "zur", "ten", "ter", "le", "la", "du", "mc"]);

/** "Müller, Anna" / "Anna Müller" / "Lisa-Marie van der Berg" / "Ben Becker (2012)" into first and last name. */
export function splitName(raw: string): { firstName: string; lastName: string; year: number | null; doubt: string | null } {
  let text = raw.replace(/\s+/g, " ").trim();
  let year: number | null = null;
  const inBrackets = /\s*[([]\s*(?:jg\.?\s*)?((?:19|20)?\d{2})\s*[)\]]\s*$/i.exec(text);
  if (inBrackets) {
    year = parseYear(inBrackets[1]!);
    text = text.slice(0, inBrackets.index).trim();
  }
  // Remarks like "(TW)" or "(C)" go
  text = text.replace(/\s*[([][^)\]]*[)\]]\s*/g, " ").trim();
  if (text.includes(",")) {
    const [last, first] = text.split(",", 2).map((s) => s.trim());
    return { firstName: first ?? "", lastName: last ?? "", year, doubt: first ? null : "name" };
  }
  const parts = text.split(" ").filter(Boolean);
  if (parts.length <= 1) return { firstName: parts[0] ?? "", lastName: "", year, doubt: "name" };
  const particle = parts.findIndex((p, i) => i > 0 && PARTICLES.has(p.toLowerCase()));
  if (particle > 0) return { firstName: parts.slice(0, particle).join(" "), lastName: parts.slice(particle).join(" "), year, doubt: null };
  // "Anna Lena Müller": two first names or a double last name? Taken as first names, but the admin checks
  return {
    firstName: parts.slice(0, -1).join(" "),
    lastName: parts[parts.length - 1]!,
    year,
    doubt: parts.length > 2 ? "name" : null,
  };
}

/** A year from "2014", "14", "Jg. 2014", a date "03.05.2014" / "2014-05-03", or an Excel day number. */
export function parseYear(raw: string, now = new Date()): number | null {
  const text = raw.trim();
  if (!text) return null;
  const iso = /((?:19|20)\d{2})-\d{1,2}-\d{1,2}/.exec(text);
  if (iso) return Number(iso[1]);
  const date = /(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/.exec(text);
  if (date) return fullYear(date[3]!, now);
  const four = /\b((?:19|20)\d{2})\b/.exec(text);
  if (four) return Number(four[1]);
  // Excel stores dates as days since 1900 when a cell is not formatted as a date
  if (/^\d{5}(\.\d+)?$/.test(text)) {
    const days = Number(text);
    if (days > 10000 && days < 80000) return new Date(Date.UTC(1899, 11, 30) + days * 86_400_000).getUTCFullYear();
  }
  const two = /^\D*(\d{2})\D*$/.exec(text);
  if (two) return fullYear(two[1]!, now);
  return null;
}

function fullYear(digits: string, now: Date): number | null {
  const n = Number(digits);
  if (digits.length === 4) return n >= 1900 && n <= 2100 ? n : null;
  if (digits.length !== 2) return null;
  const century = now.getFullYear() % 100;
  return n <= century ? 2000 + n : 1900 + n;
}

/** Role from a cell; empty or unknown counts as player. */
export function parseRole(raw: string): ImportRole {
  const text = raw.toLowerCase();
  if (/trainer|coach|übungsleiter|uebungsleiter|\bcotr|\bco\b|\bübl\b/.test(text)) return "coach";
  if (/betreuer|physio|team ?manager|mannschaftsverantwortlich|staff|zeugwart/.test(text)) return "staff";
  return "player";
}

/** The rows of a sheet with its mapping; rows without a name are skipped. */
export function rowsOfSheet(sheet: ImportSheet): ImportRow[] {
  const col = (f: ImportField) => sheet.mapping.indexOf(f);
  const name = col("name");
  const first = col("firstName");
  const last = col("lastName");
  const year = col("birthYear");
  const team = col("team");
  const role = col("role");
  const out: ImportRow[] = [];
  sheet.rows.forEach((cells, i) => {
    const doubts: string[] = [];
    let firstName = first >= 0 ? cells[first]!.trim() : "";
    let lastName = last >= 0 ? cells[last]!.trim() : "";
    let birthYear: number | null = null;
    if (name >= 0 && (!firstName || !lastName)) {
      const split = splitName(cells[name]!);
      firstName ||= split.firstName;
      lastName ||= split.lastName;
      birthYear = split.year;
      if (split.doubt) doubts.push(split.doubt);
    }
    if (!firstName && !lastName) return;
    const yearCell = year >= 0 ? cells[year]! : "";
    if (yearCell) {
      const y = parseYear(yearCell);
      if (y) birthYear = y;
      else doubts.push("birthYear");
      if (/^\D*\d{2}\D*$/.test(yearCell.trim())) doubts.push("birthYear");
    }
    out.push({
      firstName,
      lastName,
      birthYear,
      team: (team >= 0 && cells[team]!.trim()) || sheet.team.trim() || null,
      role: role >= 0 && cells[role]!.trim() ? parseRole(cells[role]!) : sheet.role,
      source: { file: sheet.file, sheet: sheet.sheet, row: sheet.headerRow + i + 1 },
      doubts: [...new Set(doubts)],
    });
  });
  return out;
}

// Merging ----------------------------------------------------------------------------------------------------

/** Name for comparing: lower case, umlauts and ß spelled out, accents, hyphens and spaces unified. */
export function nameKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[-\s.]+/g, " ")
    .trim();
}

export const personKey = (firstName: string, lastName: string) => `${nameKey(firstName)}|${nameKey(lastName)}`;

function distance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 1) return 2;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)] as number[]);
  for (let j = 1; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length]![b.length]!;
}

/**
 * One person per name across all lists: memberships and sources combined, the birth year taken from whichever list
 * has it. Disagreeing years, similar names and people without a team become questions instead of silent decisions.
 */
export function mergeRows(rows: ImportRow[]): { persons: ImportPerson[]; questions: ImportQuestion[] } {
  const byKey = new Map<string, ImportPerson>();
  for (const r of rows) {
    const key = personKey(r.firstName, r.lastName);
    let p = byKey.get(key);
    if (!p) {
      p = { key, firstName: r.firstName, lastName: r.lastName, birthYear: null, birthYears: [], memberships: [], sources: [], doubts: [], excluded: false };
      byKey.set(key, p);
    }
    if (r.birthYear && !p.birthYears.includes(r.birthYear)) p.birthYears.push(r.birthYear);
    if (r.team && !p.memberships.some((m) => m.team === r.team && m.role === r.role)) p.memberships.push({ team: r.team, role: r.role });
    // A role without a team (e.g. a list of coaches without teams) still counts once a team is known
    if (!r.team && r.role !== "player") p.doubts.push(`role:${r.role}`);
    p.sources.push(r.source);
    for (const d of r.doubts) if (!p.doubts.includes(d)) p.doubts.push(d);
  }
  const persons = [...byKey.values()];
  const questions: ImportQuestion[] = [];
  for (const p of persons) {
    p.birthYears.sort();
    p.birthYear = p.birthYears.length === 1 ? p.birthYears[0]! : null;
    // Roles from lists without teams apply to the teams the person has
    for (const d of p.doubts.filter((x) => x.startsWith("role:"))) {
      const role = d.slice(5) as ImportRole;
      for (const team of [...new Set(p.memberships.map((m) => m.team))]) {
        if (!p.memberships.some((m) => m.team === team && m.role === role)) p.memberships.push({ team, role });
      }
    }
    p.doubts = p.doubts.filter((x) => !x.startsWith("role:"));
    if (p.birthYears.length > 1) questions.push({ kind: "birth-year", key: p.key, years: p.birthYears });
    if (!p.memberships.length) questions.push({ kind: "no-team", key: p.key });
  }
  // Similar names: same last name and first names one letter apart or one a prefix of the other, or the reverse
  const sorted = [...persons].sort((a, b) => a.key.localeCompare(b.key));
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const a = sorted[i]!;
      const b = sorted[j]!;
      const [af, al] = a.key.split("|") as [string, string];
      const [bf, bl] = b.key.split("|") as [string, string];
      const sameLast = al === bl;
      const firstClose = af !== bf && (distance(af, bf) <= 1 || af.startsWith(`${bf} `) || bf.startsWith(`${af} `) || af.startsWith(bf) || bf.startsWith(af));
      const lastClose = af === bf && al !== bl && distance(al, bl) <= 1;
      const yearsClash = a.birthYear && b.birthYear && a.birthYear !== b.birthYear;
      if (((sameLast && firstClose) || lastClose) && !yearsClash) questions.push({ kind: "maybe-same", keys: [a.key, b.key] });
    }
  }
  return { persons, questions };
}

/** Two persons become one: the first keeps its name, takes the other's memberships, years and sources. */
export function mergeTwo(persons: ImportPerson[], keep: string, drop: string): ImportPerson[] {
  const a = persons.find((p) => p.key === keep);
  const b = persons.find((p) => p.key === drop);
  if (!a || !b) return persons;
  const merged: ImportPerson = {
    ...a,
    birthYears: [...new Set([...a.birthYears, ...b.birthYears])].sort(),
    memberships: [...a.memberships, ...b.memberships.filter((m) => !a.memberships.some((x) => x.team === m.team && x.role === m.role))],
    sources: [...a.sources, ...b.sources],
    doubts: [...new Set([...a.doubts, ...b.doubts])],
  };
  merged.birthYear = merged.birthYears.length === 1 ? merged.birthYears[0]! : (a.birthYear ?? b.birthYear);
  return persons.filter((p) => p.key !== drop).map((p) => (p.key === keep ? merged : p));
}

/**
 * The admin says two persons are one: merged as in mergeTwo, and the open questions follow (the dropped key becomes
 * the kept one, questions that no longer apply go, disagreeing birth years become a question).
 */
export function resolveSame(
  persons: ImportPerson[],
  questions: ImportQuestion[],
  keep: string,
  drop: string,
): { persons: ImportPerson[]; questions: ImportQuestion[] } {
  const merged = mergeTwo(persons, keep, drop);
  const person = merged.find((p) => p.key === keep);
  if (!person) return { persons, questions };
  const seen = new Set<string>();
  const next: ImportQuestion[] = [];
  for (const q of questions) {
    let x: ImportQuestion;
    if (q.kind === "maybe-same") {
      const keys = q.keys.map((k) => (k === drop ? keep : k)) as [string, string];
      if (keys[0] === keys[1]) continue;
      x = { kind: "maybe-same", keys };
    } else if (q.key === drop || q.key === keep) {
      if (q.kind === "no-team" && person.memberships.length) continue;
      if (q.kind === "birth-year") continue;
      x = { ...q, key: keep };
    } else x = q;
    const id = JSON.stringify(x);
    if (!seen.has(id)) next.push(x);
    seen.add(id);
  }
  if (person.birthYears.length > 1) next.push({ kind: "birth-year", key: keep, years: person.birthYears });
  return { persons: merged, questions: next };
}

// Teams ------------------------------------------------------------------------------------------------------

export interface ImportAgeClass {
  code: string;
  name: string;
  birthYearMin: number | null;
  birthYearMax: number | null;
}

export interface ImportTeam {
  name: string;
  ageClassCode: string;
  gender: "f" | "m" | "x";
  /** The team exists already and is reused */
  existing: boolean;
}

// "wD1", "mC": the lower-case letter right before the age class code, so case matters there
const FEMALE = /(^|[^a-zäöü])(weiblich|damen|frauen|mädchen|maedchen|girls?|women|ladies)([^a-zäöü]|$)|^w$/i;
const MALE = /(^|[^a-zäöü])(männlich|maennlich|herren|männer|maenner|jungen|jungs|boys?|men)([^a-zäöü]|$)|^m$/i;
const genderOf = (name: string): "f" | "m" | "x" =>
  FEMALE.test(name) || /(^|[\s-])w[A-Z]/.test(name) || /\sw$/.test(name) ? "f" : MALE.test(name) || /(^|[\s-])m[A-Z]/.test(name) || /\sm$/.test(name) ? "m" : "x";

/**
 * The teams named in the lists, with an age class: from the name (code "D" in "wD1", "U13", the class name), else
 * from the birth years of its players. Gender from the name (wD, Damen, Herren), else mixed.
 */
export function suggestTeams(persons: ImportPerson[], ageClasses: ImportAgeClass[], existingNames: string[]): ImportTeam[] {
  const names = [...new Set(persons.filter((p) => !p.excluded).flatMap((p) => p.memberships.map((m) => m.team)))].sort((a, b) => a.localeCompare(b, "de"));
  const existing = new Set(existingNames.map((n) => n.toLowerCase()));
  return names.map((name) => {
    const fromName =
      ageClasses.find((a) => new RegExp(`(^|[^A-Za-z])[wmg]?${a.code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\d|$|[^A-Za-z])`).test(name)) ??
      ageClasses.find((a) => name.toLowerCase().includes(a.name.toLowerCase()));
    let ageClassCode = fromName?.code ?? "";
    if (!ageClassCode) {
      const years = persons.filter((p) => p.birthYear && p.memberships.some((m) => m.team === name && m.role === "player")).map((p) => p.birthYear!);
      const count = new Map<string, number>();
      for (const y of years) {
        const a = ageClasses.find((c) => (c.birthYearMin == null || y >= c.birthYearMin) && (c.birthYearMax == null || y <= c.birthYearMax));
        if (a) count.set(a.code, (count.get(a.code) ?? 0) + 1);
      }
      ageClassCode = [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? ageClasses[ageClasses.length - 1]?.code ?? "";
    }
    return { name: name.slice(0, 30), ageClassCode, gender: genderOf(name), existing: existing.has(name.toLowerCase()) };
  });
}
