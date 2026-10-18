// Date and time formats in the app's language. Events come as local club time 'YYYY-MM-DDTHH:MM',
// technical timestamps as UTC ISO.
import { t } from "@lingui/core/macro";
import {
  clockTimeIn,
  dateParts,
  fullDateIn,
  intlTag,
  isoWeekdayName,
  isoWeekdayPlural,
  isoWeekdayShort,
  longDateIn,
  shortDateIn,
  words,
} from "../shared/dates";
import { currentLocale } from "./i18n";

export const TZ = "Europe/Berlin";

const pad = (n: number) => String(n).padStart(2, "0");

/** de "Freitag, 02.10.", en "Friday 2 Oct" */
export function longDate(local: string): string {
  return longDateIn(currentLocale(), local);
}

/** de "Fr 02.10.", en "Fri 2 Oct" */
export function shortDate(local: string): string {
  return shortDateIn(currentLocale(), local);
}

/** de "02.10.2026", en "2 Oct 2026" */
export function fullDate(dateOrLocal: string): string {
  return fullDateIn(currentLocale(), dateOrLocal);
}

export function weekdayShort(local: string): string {
  return words(currentLocale()).weekdaysShort[dateParts(local).wd]!;
}

/** ISO weekday (1 = Monday): "Montag" / "Monday" */
export function weekdayName(isoWeekday: number): string {
  return isoWeekdayName(currentLocale(), isoWeekday);
}

/** ISO weekday (1 = Monday): "Mo" / "Mon" */
export function weekdayShortIso(isoWeekday: number): string {
  return isoWeekdayShort(currentLocale(), isoWeekday);
}

/** ISO weekday (1 = Monday): "montags" / "Mondays" */
export function weekdayPlural(isoWeekday: number): string {
  return isoWeekdayPlural(currentLocale(), isoWeekday);
}

export function dayOfMonth(local: string): string {
  return pad(dateParts(local).d);
}

/** "OKT" for the date block in lists. */
export function monthShort(local: string): string {
  return words(currentLocale()).monthsShort[dateParts(local).m - 1]!;
}

export function monthLabel(local: string): string {
  const p = dateParts(local);
  return `${words(currentLocale()).months[p.m - 1]} ${p.y}`;
}

export function time(local: string | null | undefined): string {
  return local ? local.slice(11, 16) : "";
}

export function timeRange(start: string, end: string | null): string {
  return end ? `${time(start)} – ${time(end)}` : clockTimeIn(currentLocale(), time(start));
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

/** Now as local club time. */
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

/** "today", "tomorrow", "in 3 days", "2 days ago" */
export function relativeDay(local: string): string {
  const diff = daysBetween(todayLocal(), local.slice(0, 10));
  if (diff === 0) return t`today`;
  if (diff === 1) return t`tomorrow`;
  if (diff === -1) return t`yesterday`;
  if (diff > 1) {
    const weeks = Math.round(diff / 7);
    return diff < 14 ? t`in ${diff} days` : t`in ${weeks} weeks`;
  }
  const days = -diff;
  return t`${days} days ago`;
}

function stampFormat() {
  return new Intl.DateTimeFormat(intlTag(currentLocale()), {
    timeZone: TZ,
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** UTC timestamp → de "Fr., 02.10., 14:05" */
export function stamp(iso: string): string {
  return stampFormat().format(new Date(iso)).replace(/\.,/, ".,");
}

const dayOnly = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });

export function clock(iso: string): string {
  return new Intl.DateTimeFormat(intlTag(currentLocale()), { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
}

export function isoToLocalDate(iso: string): string {
  return dayOnly.format(new Date(iso));
}

export function dayLabel(iso: string): string {
  const day = isoToLocalDate(iso);
  const diff = daysBetween(day, todayLocal());
  if (diff === 0) return t`Today`;
  if (diff === 1) return t`Yesterday`;
  return `${shortDate(`${day}T00:00`)}${day.slice(0, 4) !== todayLocal().slice(0, 4) ? day.slice(0, 4) : ""}`;
}

/** "3 hrs ago" for UTC timestamps */
export function ago(iso: string | null): string {
  if (!iso) return t`never`;
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (mins < 1) return t`just now`;
  if (mins < 60) return t`${mins} min. ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return t`${hours} hrs ago`;
  const days = Math.round(hours / 24);
  return t`${days} days ago`;
}

export function personName(p: { firstName: string; lastName: string | null }): string {
  return p.lastName ? `${p.firstName} ${p.lastName}` : p.firstName;
}

/** "Lina B." */
export function shortName(p: { firstName: string; lastName: string | null }): string {
  return p.lastName ? `${p.firstName} ${p.lastName.charAt(0)}.` : p.firstName;
}
