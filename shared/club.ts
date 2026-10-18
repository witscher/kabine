// Club profile shared by worker and app (GET /api/club).
import type { Locale } from "./i18n";
import type { SportId } from "./sports";

export interface ClubProfile {
  /** Full name, e.g. "SV Musterstadt 1900 Handball". */
  name: string;
  /** Short name for headers, the home screen icon and notifications, e.g. "SVM Handball". */
  shortName: string;
  /** Abbreviation in front of the own team in game titles, e.g. "SVM" in "SVM wD – HSG Gegner". Empty: initials of the short name. */
  abbr: string;
  colors: {
    /** Dark main colour (header, buttons). */
    primary: string;
    /** Bright accent colour (badges, highlights). */
    accent: string;
  };
  /** Version of the uploaded logo, null without logo (GET /api/club/logo?v=…). */
  logoVersion: number | null;
  /** Link to the club's full privacy policy and imprint (optional). */
  privacyUrl: string | null;
  /** Additional privacy notes for this installation (optional, plain text). */
  privacyText: string | null;
  /** Contact for questions about the app, shown under Help (optional). */
  contact: string | null;
  /** Sport profile (shared/sports.ts): age classes, playing times, default duties. */
  sport: SportId;
  /** ISO country code and subdivision (OpenHolidays codes, e.g. "DE-BW") for school and public holidays. */
  country: string;
  subdivision: string | null;
  /** IANA time zone; events are stored and computed in it. */
  timeZone: string;
  /** Language for people who have not chosen one, and for texts outside a request. */
  defaultLocale: Locale;
  /** The installation wizard has been completed. */
  setupDone: boolean;
}

export const DEFAULT_CLUB: ClubProfile = {
  name: "Kabine",
  shortName: "Kabine",
  abbr: "",
  colors: { primary: "#16202b", accent: "#f5b700" },
  logoVersion: null,
  privacyUrl: null,
  privacyText: null,
  contact: null,
  sport: "handball",
  country: "DE",
  subdivision: null,
  timeZone: "Europe/Berlin",
  defaultLocale: "en",
  setupDone: false,
};

const HEX = /^#[0-9a-f]{6}$/i;
export const isHexColor = (v: string) => HEX.test(v);

/** Abbreviation of the club for game titles: the configured one or the initials of the short name. */
export function clubAbbr(club: Pick<ClubProfile, "abbr" | "shortName">): string {
  if (club.abbr.trim()) return club.abbr.trim();
  const words = club.shortName.split(/\s+/).filter(Boolean);
  const first = words[0] ?? "";
  if (first.length <= 4 && first === first.toUpperCase()) return first;
  return words
    .slice(0, 3)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

/** Is this an IANA time zone the runtime knows? */
export function isTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });
    return zone.includes("/") || zone === "UTC";
  } catch {
    return false;
  }
}
