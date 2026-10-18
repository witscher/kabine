// Holiday periods: freely editable list (name, from, to). School holidays and public holidays of the
// club's country and subdivision (club profile) come from OpenHolidays (ODbL) once per season at the
// season change. No trainings are generated on public holidays.
import { t } from "@lingui/core/macro";
import { all } from "../lib/db";

export const OPENHOLIDAYS_API = "https://openholidaysapi.org";

/** Country and subdivision as OpenHolidays codes ("DE", "DE-BW"); language of the names. */
export interface HolidayRegion {
  country: string;
  subdivision: string | null;
  language: string;
}
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

/**
 * School or public holidays of the region in the range, only read and checked (for the season change).
 * Public holidays without subdivision are the nationwide ones; with it, nationwide and regional.
 */
export async function fetchHolidays(
  kind: "school" | "public",
  region: HolidayRegion,
  from: string,
  to: string,
  fetcher: typeof fetch = fetch,
): Promise<HolidayInput[]> {
  const params = new URLSearchParams({ countryIsoCode: region.country, languageIsoCode: region.language.toUpperCase(), validFrom: from, validTo: to });
  if (region.subdivision) params.set("subdivisionCode", region.subdivision);
  const url = `${OPENHOLIDAYS_API}/${kind === "school" ? "SchoolHolidays" : "PublicHolidays"}?${params}`;
  const res = await fetcher(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`OpenHolidays responded with ${res.status}`);
  const data: unknown = await res.json();
  if (!Array.isArray(data) || !data.every(isEntry)) throw new Error("OpenHolidays: unexpected response format");
  return data
    .filter((e) => e.endDate >= from && e.startDate <= to)
    .map((e) => ({
      name: (e.name.find((n) => n.language === region.language.toUpperCase())?.text ?? e.name[0]?.text ?? t`Holidays`).slice(0, 60),
      startsOn: e.startDate,
      endsOn: e.endDate,
    }))
    .sort((a, b) => a.startsOn.localeCompare(b.startsOn));
}

/** Replaceable in tests (like `mailer` for sending e-mail). */
export const holidaySource = {
  regions: (country: string | null, language: string) => fetchRegions(country, language),
  school: (region: HolidayRegion, from: string, to: string): Promise<HolidayInput[]> => fetchHolidays("school", region, from, to),
  public: (region: HolidayRegion, from: string, to: string): Promise<HolidayInput[]> => fetchHolidays("public", region, from, to),
};

/** Days (YYYY-MM-DD) that are public holidays in the range; no trainings are generated on them. */
export async function publicHolidayDays(db: D1Database, from: string, to: string): Promise<Set<string>> {
  const rows = await all<{ day: string }>(db, "SELECT day FROM public_holidays WHERE day BETWEEN ? AND ?", from, to);
  return new Set(rows.map((r) => r.day));
}

/** Each day of a period as a separate public holiday row (OpenHolidays returns single days anyway). */
export function holidayDays(h: HolidayInput): string[] {
  const days: string[] = [];
  for (let d = h.startsOn; d <= h.endsOn && days.length < 7; ) {
    days.push(d);
    const [y, m, dd] = d.split("-").map(Number) as [number, number, number];
    const next = new Date(Date.UTC(y, m - 1, dd + 1));
    d = next.toISOString().slice(0, 10);
  }
  return days;
}

export interface RegionOption {
  code: string;
  name: string;
}

function localName(names: unknown, language: string): string | null {
  if (!Array.isArray(names)) return null;
  const list = names as { language?: string; text?: string }[];
  return (list.find((n) => n.language === language.toUpperCase())?.text ?? list[0]?.text ?? null) || null;
}

/** Countries and subdivisions OpenHolidays knows, for choosing the club's region (setup, club profile). */
export async function fetchRegions(country: string | null, language: string, fetcher: typeof fetch = fetch): Promise<{ countries: RegionOption[]; subdivisions: RegionOption[] }> {
  const lang = language.toUpperCase();
  const get = async (path: string) => {
    const res = await fetcher(`${OPENHOLIDAYS_API}/${path}`, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`OpenHolidays responded with ${res.status}`);
    return (await res.json()) as unknown;
  };
  const countriesRaw = await get(`Countries?languageIsoCode=${lang}`);
  const countries = (Array.isArray(countriesRaw) ? countriesRaw : [])
    .map((c: { isoCode?: unknown; name?: unknown }) => ({ code: String(c.isoCode ?? ""), name: localName(c.name, lang) ?? String(c.isoCode ?? "") }))
    .filter((c) => /^[A-Z]{2}$/.test(c.code))
    .sort((a, b) => a.name.localeCompare(b.name));
  let subdivisions: RegionOption[] = [];
  if (country && /^[A-Z]{2}$/.test(country)) {
    const raw = await get(`Subdivisions?countryIsoCode=${country}&languageIsoCode=${lang}`);
    subdivisions = (Array.isArray(raw) ? raw : [])
      .map((s: { code?: unknown; name?: unknown }) => ({ code: String(s.code ?? ""), name: localName(s.name, lang) ?? String(s.code ?? "") }))
      .filter((s) => /^[A-Z]{2}-[A-Z0-9]{1,4}$/.test(s.code))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  return { countries, subdivisions };
}
