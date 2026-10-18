// Dates and times in words, for app and worker. Events are local club time 'YYYY-MM-DDTHH:MM'.
// German keeps the formats the app was built with; English follows British usage (day before month).
import type { Locale } from "./i18n";

const WORDS = {
  de: {
    weekdaysShort: ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"],
    weekdaysLong: ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"],
    weekdaysPlural: ["sonntags", "montags", "dienstags", "mittwochs", "donnerstags", "freitags", "samstags"],
    months: ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"],
    monthsShort: ["JAN", "FEB", "MÄR", "APR", "MAI", "JUN", "JUL", "AUG", "SEP", "OKT", "NOV", "DEZ"],
  },
  en: {
    weekdaysShort: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
    weekdaysLong: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
    weekdaysPlural: ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"],
    months: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
    monthsShort: ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"],
  },
} satisfies Record<Locale, unknown>;

const pad = (n: number) => String(n).padStart(2, "0");

export function dateParts(local: string) {
  const [y, m, d] = local.slice(0, 10).split("-").map(Number) as [number, number, number];
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return { y, m, d, wd, time: local.slice(11, 16) };
}

export function words(locale: Locale) {
  return WORDS[locale];
}

/** de "Freitag, 02.10.", en "Friday 2 Oct" */
export function longDateIn(locale: Locale, local: string): string {
  const p = dateParts(local);
  const w = WORDS[locale];
  return locale === "de" ? `${w.weekdaysLong[p.wd]}, ${pad(p.d)}.${pad(p.m)}.` : `${w.weekdaysLong[p.wd]} ${p.d} ${w.months[p.m - 1]!.slice(0, 3)}`;
}

/** de "Fr 02.10.", en "Fri 2 Oct" */
export function shortDateIn(locale: Locale, local: string): string {
  const p = dateParts(local);
  const w = WORDS[locale];
  return locale === "de" ? `${w.weekdaysShort[p.wd]} ${pad(p.d)}.${pad(p.m)}.` : `${w.weekdaysShort[p.wd]} ${p.d} ${w.months[p.m - 1]!.slice(0, 3)}`;
}

/** de "02.10.2026", en "2 Oct 2026" */
export function fullDateIn(locale: Locale, dateOrLocal: string): string {
  const p = dateParts(dateOrLocal);
  return locale === "de" ? `${pad(p.d)}.${pad(p.m)}.${p.y}` : `${p.d} ${WORDS.en.months[p.m - 1]!.slice(0, 3)} ${p.y}`;
}

/** ISO weekday 1 = Monday … 7 = Sunday: "Montag" / "Monday". */
export function isoWeekdayName(locale: Locale, isoWeekday: number): string {
  return WORDS[locale].weekdaysLong[isoWeekday % 7]!;
}

/** ISO weekday: "montags" / "Mondays". */
export function isoWeekdayPlural(locale: Locale, isoWeekday: number): string {
  return WORDS[locale].weekdaysPlural[isoWeekday % 7]!;
}

/** ISO weekday: "Mo" / "Mon". */
export function isoWeekdayShort(locale: Locale, isoWeekday: number): string {
  return WORDS[locale].weekdaysShort[isoWeekday % 7]!;
}

/** Time of day: de "14:00 Uhr", en "14:00". */
export function clockTimeIn(locale: Locale, hhmm: string): string {
  return locale === "de" ? `${hhmm} Uhr` : hhmm;
}

/** BCP 47 tag for Intl formats. */
export function intlTag(locale: Locale): string {
  return locale === "de" ? "de-DE" : "en-GB";
}
