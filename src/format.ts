// Datums- und Zeitformatierung. Termine kommen als lokale Berliner Zeit
// 'YYYY-MM-DDTHH:MM', technische Zeitstempel als UTC-ISO.

export const TZ = "Europe/Berlin";

const WEEKDAYS_SHORT = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const WEEKDAYS_LONG = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
export const WEEKDAY_NAMES = ["", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];
export const WEEKDAY_SHORT_ISO = ["", "Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
export const WEEKDAY_ADVERB = ["", "montags", "dienstags", "mittwochs", "donnerstags", "freitags", "samstags", "sonntags"];

function parts(local: string) {
  const [y, m, d] = local.slice(0, 10).split("-").map(Number) as [number, number, number];
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return { y, m, d, wd, time: local.slice(11, 16) };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "Freitag, 02.10." */
export function longDate(local: string): string {
  const p = parts(local);
  return `${WEEKDAYS_LONG[p.wd]}, ${pad(p.d)}.${pad(p.m)}.`;
}

/** "Fr 02.10." */
export function shortDate(local: string): string {
  const p = parts(local);
  return `${WEEKDAYS_SHORT[p.wd]} ${pad(p.d)}.${pad(p.m)}.`;
}

/** "02.10.2026" */
export function fullDate(dateOrLocal: string): string {
  const p = parts(dateOrLocal);
  return `${pad(p.d)}.${pad(p.m)}.${p.y}`;
}

export function weekdayShort(local: string): string {
  return WEEKDAYS_SHORT[parts(local).wd]!;
}

export function dayOfMonth(local: string): string {
  return pad(parts(local).d);
}

const MONTHS_SHORT = ["JAN", "FEB", "MÄR", "APR", "MAI", "JUN", "JUL", "AUG", "SEP", "OKT", "NOV", "DEZ"];

/** "OKT" für den Datumsblock in Listen. */
export function monthShort(local: string): string {
  return MONTHS_SHORT[parts(local).m - 1]!;
}

export function monthLabel(local: string): string {
  const p = parts(local);
  return `${MONTHS[p.m - 1]} ${p.y}`;
}

export function time(local: string | null | undefined): string {
  return local ? local.slice(11, 16) : "";
}

export function timeRange(start: string, end: string | null): string {
  return end ? `${time(start)} – ${time(end)}` : `${time(start)} Uhr`;
}

const nowParts = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** Jetzt als lokale Berliner Zeit. */
export function nowLocal(): string {
  const o: Record<string, string> = {};
  for (const p of nowParts.formatToParts(new Date())) o[p.type] = p.value;
  return `${o.year}-${o.month}-${o.day}T${o.hour}:${o.minute}`;
}

export function todayLocal(): string {
  return nowLocal().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

export function daysBetween(a: string, b: string): number {
  const [y1, m1, d1] = a.split("-").map(Number) as [number, number, number];
  const [y2, m2, d2] = b.split("-").map(Number) as [number, number, number];
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}

/** "heute", "morgen", "in 3 Tagen", "vor 2 Tagen" */
export function relativeDay(local: string): string {
  const diff = daysBetween(todayLocal(), local.slice(0, 10));
  if (diff === 0) return "heute";
  if (diff === 1) return "morgen";
  if (diff === -1) return "gestern";
  if (diff > 1) return diff < 14 ? `in ${diff} Tagen` : `in ${Math.round(diff / 7)} Wochen`;
  return `vor ${-diff} Tagen`;
}

const stampFormat = new Intl.DateTimeFormat("de-DE", {
  timeZone: TZ,
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

/** UTC-Zeitstempel → "Fr., 02.10., 14:05" */
export function stamp(iso: string): string {
  return stampFormat.format(new Date(iso)).replace(/\.,/, ".,");
}

const timeOnly = new Intl.DateTimeFormat("de-DE", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
const dayOnly = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });

export function clock(iso: string): string {
  return timeOnly.format(new Date(iso));
}

export function isoToLocalDate(iso: string): string {
  return dayOnly.format(new Date(iso));
}

export function dayLabel(iso: string): string {
  const day = isoToLocalDate(iso);
  const diff = daysBetween(day, todayLocal());
  if (diff === 0) return "Heute";
  if (diff === 1) return "Gestern";
  return `${shortDate(`${day}T00:00`)}${day.slice(0, 4) !== todayLocal().slice(0, 4) ? day.slice(0, 4) : ""}`;
}

/** "vor 3 Std." für UTC-Zeitstempel */
export function ago(iso: string | null): string {
  if (!iso) return "noch nie";
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (mins < 1) return "gerade eben";
  if (mins < 60) return `vor ${mins} Min.`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `vor ${hours} Std.`;
  return `vor ${Math.round(hours / 24)} Tagen`;
}

export function personName(p: { firstName: string; lastName: string | null }): string {
  return p.lastName ? `${p.firstName} ${p.lastName}` : p.firstName;
}

/** "Lina B." */
export function shortName(p: { firstName: string; lastName: string | null }): string {
  return p.lastName ? `${p.firstName} ${p.lastName.charAt(0)}.` : p.firstName;
}

