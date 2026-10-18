// Zeitrechnung in Europe/Berlin.
//
// Termine werden als lokale Wanduhrzeit gespeichert ('YYYY-MM-DDTHH:MM').
// Für Fristen und Vergleiche mit "jetzt" werden sie hier in Instants (ms seit
// Epoche) umgerechnet. Sommer- und Winterzeit übernimmt Intl.

export const TZ = "Europe/Berlin";

const partsFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

type Parts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

function partsAt(ms: number): Parts {
  const out: Record<string, number> = {};
  for (const p of partsFormat.formatToParts(ms)) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  return out as Parts;
}

/** Abstand von Berliner Wanduhrzeit zu UTC in ms zum Zeitpunkt `ms`. */
function offsetAt(ms: number): number {
  const whole = ms - (((ms % 1000) + 1000) % 1000);
  const p = partsAt(whole);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - whole;
}

const pad = (n: number, len = 2) => String(n).padStart(len, "0");

/** Lokale Zeit 'YYYY-MM-DDTHH:MM' für einen Instant. */
export function toLocal(ms: number): string {
  const p = partsAt(ms);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/** Lokales Datum 'YYYY-MM-DD' für einen Instant. */
export function toLocalDate(ms: number): string {
  return toLocal(ms).slice(0, 10);
}

export function nowLocal(now = Date.now()): string {
  return toLocal(now);
}

export function todayLocal(now = Date.now()): string {
  return toLocalDate(now);
}

const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isLocalDateTime(s: string): boolean {
  return LOCAL_RE.test(s) && !Number.isNaN(localToInstant(s));
}

export function isDate(s: string): boolean {
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!));
  return d.getUTCFullYear() === +m[1]! && d.getUTCMonth() === +m[2]! - 1 && d.getUTCDate() === +m[3]!;
}

export function isTime(s: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

/** Instant (ms) für eine lokale Berliner Zeit 'YYYY-MM-DDTHH:MM'. */
export function localToInstant(local: string): number {
  const m = LOCAL_RE.exec(local);
  if (!m) return Number.NaN;
  const guess = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!);
  let t = guess - offsetAt(guess);
  const second = offsetAt(t);
  if (second !== offsetAt(guess)) t = guess - second;
  return t;
}

/** Datumsarithmetik auf 'YYYY-MM-DD' (zeitzonenunabhängig). */
export function addDays(date: string, days: number): string {
  const m = DATE_RE.exec(date);
  if (!m) throw new Error(`Ungültiges Datum: ${date}`);
  const d = new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]! + days));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** ISO-Wochentag (1 = Montag … 7 = Sonntag) für 'YYYY-MM-DD'. */
export function isoWeekday(date: string): number {
  const m = DATE_RE.exec(date);
  if (!m) throw new Error(`Ungültiges Datum: ${date}`);
  const wd = new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!)).getUTCDay();
  return wd === 0 ? 7 : wd;
}

/** Lokale Zeit plus Minuten, über Instants gerechnet. */
export function addMinutesLocal(local: string, minutes: number): string {
  return toLocal(localToInstant(local) + minutes * 60_000);
}

export function daysBetween(from: string, to: string): number {
  const a = DATE_RE.exec(from);
  const b = DATE_RE.exec(to);
  if (!a || !b) throw new Error("Ungültiges Datum");
  return Math.round(
    (Date.UTC(+b[1]!, +b[2]! - 1, +b[3]!) - Date.UTC(+a[1]!, +a[2]! - 1, +a[3]!)) / 86_400_000,
  );
}

export function utcIso(ms = Date.now()): string {
  return new Date(ms).toISOString();
}

export function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}
