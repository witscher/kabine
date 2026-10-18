// Ferienzeiträume: frei bearbeitbare Liste (Name, von, bis). Die Schulferien
// Baden-Württemberg kommen einmal je Saison beim Saisonwechsel von OpenHolidays (ODbL).
import { all } from "../lib/db";

export const OPENHOLIDAYS_URL = "https://openholidaysapi.org/SchoolHolidays";
export const SUBDIVISION = "DE-BW";
export const HOLIDAY_SOURCE = "OpenHolidays API (openholidaysapi.org), Lizenz ODbL";
/** Längster erlaubter Zeitraum (Sommerferien plus Puffer). */
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

/** Ferienzeiträume, die den Bereich berühren (ohne Bereich: alle). */
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

/** Schulferien Baden-Württemberg im Bereich, nur gelesen und geprüft (für den Saisonwechsel). */
export async function fetchBwHolidays(from: string, to: string, fetcher: typeof fetch = fetch): Promise<HolidayInput[]> {
  const url = `${OPENHOLIDAYS_URL}?countryIsoCode=DE&subdivisionCode=${SUBDIVISION}&languageIsoCode=DE&validFrom=${from}&validTo=${to}`;
  const res = await fetcher(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`OpenHolidays antwortet mit ${res.status}`);
  const data: unknown = await res.json();
  if (!Array.isArray(data) || !data.every(isEntry)) throw new Error("OpenHolidays: unerwartetes Antwortformat");
  return data
    .filter((e) => e.endDate >= from && e.startDate <= to)
    .map((e) => ({
      name: (e.name.find((n) => n.language === "DE")?.text ?? e.name[0]?.text ?? "Ferien").slice(0, 60),
      startsOn: e.startDate,
      endsOn: e.endDate,
    }))
    .sort((a, b) => a.startsOn.localeCompare(b.startsOn));
}

/** Austauschbar für Tests (wie `mailer` beim E-Mail-Versand). */
export const holidaySource = {
  bw: (from: string, to: string): Promise<HolidayInput[]> => fetchBwHolidays(from, to),
};
