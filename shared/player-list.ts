// Player list for a team, pasted from a spreadsheet or typed: first name, last name, birth year.
// Columns are found by their header (English or German). Without a header each line is read as
// "first name; last name; birth year", "first name last name birth year" or "last name, first name".

export interface ListedPlayer {
  line: number;
  firstName: string;
  lastName: string | null;
  birthYear: number | null;
}

export interface ListProblem {
  line: number;
  /** name: no first name; year: birth year not plausible */
  field: "name" | "year";
  value: string;
}

type Column = "first" | "last" | "year" | "name";

const HEADERS: Record<Column, RegExp> = {
  first: /^(first ?name|given name|vorname)$/i,
  last: /^(last ?name|surname|family name|nachname|name)$/i,
  year: /^(birth ?year|year|year of birth|jahrgang|geburtsjahr|jg\.?)$/i,
  name: /^(full name|player|spieler(in)?|vor- und nachname)$/i,
};

const MAX_LENGTH = 50;

function yearOf(v: string, thisYear: number): number | null | undefined {
  const s = v.trim();
  if (!s) return null;
  let m = /^(\d{4})$/.exec(s);
  if (!m) m = /^\d{1,2}[./]\d{1,2}[./](\d{4})$/.exec(s); // full birth date: only the year is kept
  if (!m) return undefined;
  const y = Number(m[1]);
  return y >= thisYear - 100 && y <= thisYear ? y : undefined;
}

function split(line: string): string[] {
  for (const sep of ["\t", ";"]) if (line.includes(sep)) return line.split(sep).map((c) => c.trim().replace(/^"(.*)"$/, "$1"));
  return [line.trim()];
}

export function parsePlayerList(text: string, thisYear: number): { players: ListedPlayer[]; problems: ListProblem[] } {
  const players: ListedPlayer[] = [];
  const problems: ListProblem[] = [];
  let order = null as (Column | null)[] | null;
  let first = true;
  text
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .forEach((raw, i) => {
      const line = i + 1;
      if (!raw.trim()) return;
      let cells = split(raw);
      if (first) {
        first = false;
        const mapped = cells.map((c) => (Object.keys(HEADERS) as Column[]).find((k) => HEADERS[k].test(c)) ?? null);
        if (mapped.filter(Boolean).length >= 2 || (mapped.length === 1 && mapped[0])) {
          // A lone "Name" column next to a birth year holds the full name
          order = mapped.includes("first") ? mapped : mapped.map((c) => (c === "last" ? "name" : c));
          return;
        }
      }
      let firstName = "";
      let lastName = "";
      let year = "";
      if (order) {
        const get = (c: Column) => {
          const idx = order!.indexOf(c);
          return idx >= 0 ? (cells[idx] ?? "") : "";
        };
        firstName = get("first");
        lastName = get("last");
        year = get("year");
        if (!firstName && get("name")) [firstName, lastName] = splitName(get("name"));
      } else {
        // A comma separates columns only without tabs and semicolons; "Last, First" keeps working
        if (cells.length === 1 && raw.split(",").length >= 3) cells = raw.split(",").map((c) => c.trim());
        if (cells.length === 1) {
          const words = cells[0]!.split(/\s+/);
          if (words.length > 1 && yearOf(words[words.length - 1]!, thisYear) !== undefined) year = words.pop()!;
          [firstName, lastName] = splitName(words.join(" "));
        } else if (cells.length === 2) {
          if (yearOf(cells[1]!, thisYear) !== undefined) {
            [firstName, lastName] = splitName(cells[0]!);
            year = cells[1]!;
          } else [firstName, lastName] = [cells[0]!, cells[1]!];
        } else [firstName, lastName, year] = [cells[0]!, cells[1]!, cells[2]!];
      }
      firstName = firstName.trim().slice(0, MAX_LENGTH);
      lastName = lastName.trim().slice(0, MAX_LENGTH);
      const birthYear = yearOf(year, thisYear);
      if (!firstName) return void problems.push({ line, field: "name", value: raw.slice(0, 80) });
      if (birthYear === undefined) return void problems.push({ line, field: "year", value: year });
      players.push({ line, firstName, lastName: lastName || null, birthYear });
    });
  return { players, problems };
}

/** "Kim Muster" → Kim, Muster; "Muster, Kim" → Kim, Muster; "Anna Lena Muster" → Anna Lena, Muster */
function splitName(full: string): [string, string] {
  const comma = full.indexOf(",");
  if (comma > 0) return [full.slice(comma + 1).trim(), full.slice(0, comma).trim()];
  const words = full.trim().split(/\s+/);
  if (words.length === 1) return [words[0]!, ""];
  return [words.slice(0, -1).join(" "), words[words.length - 1]!];
}
