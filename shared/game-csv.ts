// Game schedule from a table (CSV), for clubs without a fixture connector: export from the
// association's site or a spreadsheet. Columns are found by their header (English or German);
// without a header the order is date, time, opponent, home/away, venue.

export interface CsvGame {
  line: number;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  opponent: string;
  isHome: boolean;
  venue: string | null;
}

export interface CsvProblem {
  line: number;
  /** date, time, opponent, home or columns */
  field: "date" | "time" | "opponent" | "home" | "columns";
  value: string;
}

type Column = "date" | "time" | "opponent" | "home" | "venue";

const HEADERS: Record<Column, RegExp> = {
  date: /^(date|datum|tag)$/i,
  time: /^(time|zeit|uhrzeit|anwurf|anpfiff|kick-?off|beginn)$/i,
  opponent: /^(opponent|gegner|gegner\/in|team)$/i,
  home: /^(home|heim|home\/away|heim\/auswärts|h\/a|ort\?|spielort)$/i,
  venue: /^(venue|halle|hall|platz|pitch|spielstätte|sportstätte|ort|place|location|adresse|address)$/i,
};

function splitLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function parseDate(v: string): string | null {
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(v);
  let y: number, mo: number, d: number;
  if (m) [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else {
    m = /^(\d{1,2})[./](\d{1,2})[./](\d{2}|\d{4})$/.exec(v);
    if (!m) return null;
    [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (y < 100) y += 2000;
  }
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function parseTime(v: string): string | null {
  const m = /^(\d{1,2})[:.](\d{2})(?:\s*(?:uhr|h))?$/i.exec(v);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? `${String(h).padStart(2, "0")}:${m[2]}` : null;
}

function parseHome(v: string): boolean | null {
  const s = v.trim().toLowerCase();
  if (["h", "home", "heim", "ja", "yes", "y", "j", "1", "x"].includes(s)) return true;
  if (["a", "away", "auswärts", "auswaerts", "gast", "nein", "no", "n", "0", ""].includes(s)) return false;
  return null;
}

export function parseGameCsv(text: string): { games: CsvGame[]; problems: CsvProblem[] } {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  const first = lines.find((l) => l.trim()) ?? "";
  const sep = [";", "\t", ","].map((s) => [s, first.split(s).length] as const).sort((a, b) => b[1] - a[1])[0]![0];
  const games: CsvGame[] = [];
  const problems: CsvProblem[] = [];
  let order: Column[] = ["date", "time", "opponent", "home", "venue"];
  let headerSeen = false;
  lines.forEach((raw, i) => {
    const line = i + 1;
    if (!raw.trim()) return;
    const cells = splitLine(raw, sep);
    if (!headerSeen) {
      headerSeen = true;
      const mapped = cells.map((c) => (Object.keys(HEADERS) as Column[]).find((k) => HEADERS[k].test(c.trim())) ?? null);
      if (mapped.filter(Boolean).length >= 2) {
        if (!mapped.includes("date") || !mapped.includes("opponent")) problems.push({ line, field: "columns", value: raw.slice(0, 80) });
        order = mapped as Column[];
        return;
      }
    }
    const get = (c: Column) => {
      const idx = order.indexOf(c);
      return idx >= 0 ? (cells[idx] ?? "") : "";
    };
    const date = parseDate(get("date"));
    const time = parseTime(get("time") || "00:00");
    const opponent = get("opponent").slice(0, 80);
    const home = parseHome(get("home"));
    if (!date) return void problems.push({ line, field: "date", value: get("date") });
    if (!time) return void problems.push({ line, field: "time", value: get("time") });
    if (!opponent) return void problems.push({ line, field: "opponent", value: "" });
    if (home == null) return void problems.push({ line, field: "home", value: get("home") });
    games.push({ line, date, time, opponent, isHome: home, venue: get("venue").slice(0, 120) || null });
  });
  return { games, problems };
}
