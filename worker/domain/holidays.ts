// Holiday periods: freely editable list (name, from, to). The school holidays of
// Baden-Württemberg come from OpenHolidays (ODbL) once per season at the season change.
import { t } from "@lingui/core/macro";
import { all } from "../lib/db";

export const OPENHOLIDAYS_URL = "https://openholidaysapi.org/SchoolHolidays";
export const SUBDIVISION = "DE-BW";
/** Source note shown with imported holidays. */
export function holidaySourceLabel(): string {
  return t`OpenHolidays API (openholidaysapi.org), licence ODbL`;
}
/** Longest allowed period (summer holidays plus buffer). */
export const MAX_HOLIDAY_DAYS = 120;

export interface HolidayPeriodView {
  id: number;
  name: string;
  startsOn: string;
  endsOn: string;
  imported: boolean;
}

export interface HolidayInput {
  name: string;
  startsOn: string;
  endsOn: string;
}

interface PeriodRow {
  id: number;
  name: string;
  starts_on: string;
  ends_on: string;
  imported: number;
}

const view = (p: PeriodRow): HolidayPeriodView => ({ id: p.id, name: p.name, startsOn: p.starts_on, endsOn: p.ends_on, imported: p.imported === 1 });

/** Holiday periods touching the range (without a range: all). */
export async function holidayPeriods(db: D1Database, from?: string, to?: string): Promise<HolidayPeriodView[]> {
  const rows =
    from && to
      ? await all<PeriodRow>(db, "SELECT * FROM holiday_periods WHERE ends_on >= ? AND starts_on <= ? ORDER BY starts_on, id", from, to)
      : await all<PeriodRow>(db, "SELECT * FROM holiday_periods ORDER BY starts_on, id");
  return rows.map(view);
}

interface OpenHolidaysEntry {
  id: string;
  startDate: string;
  endDate: string;
  name: { language: string; text: string }[];
}

function isEntry(x: unknown): x is OpenHolidaysEntry {
  const e = x as OpenHolidaysEntry;
  return (
    typeof e === "object" &&
    e !== null &&
    typeof e.id === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(e.startDate) &&
    /^\d{4}-\d{2}-\d{2}$/.test(e.endDate) &&
    e.startDate <= e.endDate &&
    Array.isArray(e.name)
  );
}

/** School holidays of Baden-Württemberg in the range, only read and checked (for the season change). */
export async function fetchBwHolidays(from: string, to: string, fetcher: typeof fetch = fetch): Promise<HolidayInput[]> {
  const url = `${OPENHOLIDAYS_URL}?countryIsoCode=DE&subdivisionCode=${SUBDIVISION}&languageIsoCode=DE&validFrom=${from}&validTo=${to}`;
  const res = await fetcher(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`OpenHolidays responded with ${res.status}`);
  const data: unknown = await res.json();
  if (!Array.isArray(data) || !data.every(isEntry)) throw new Error("OpenHolidays: unexpected response format");
  return data
    .filter((e) => e.endDate >= from && e.startDate <= to)
    .map((e) => ({
      name: (e.name.find((n) => n.language === "DE")?.text ?? e.name[0]?.text ?? t`Holidays`).slice(0, 60),
      startsOn: e.startDate,
      endsOn: e.endDate,
    }))
    .sort((a, b) => a.startsOn.localeCompare(b.startsOn));
}

/** Replaceable in tests (like `mailer` for sending e-mail). */
export const holidaySource = {
  bw: (from: string, to: string): Promise<HolidayInput[]> => fetchBwHolidays(from, to),
};
