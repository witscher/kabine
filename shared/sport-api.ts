// What a sport profile is (sports/<id>.ts): age classes, playing times and default helper duties as
// data. The setup wizard creates the age classes of the season and the duty types from the chosen
// profile; admins adjust them afterwards. Age classes carry no gender: a team is age class + gender +
// level. Guide: docs/dev/sports.md.
import type { Locale } from "./i18n";
import type { ChildLimits } from "./types";

export interface AgeClassTemplate {
  code: string;
  name: Record<Locale, string>;
  /** Ascending from young to old; adults highest. */
  rank: number;
  youth: boolean;
  /**
   * Ages reached in the calendar year in which the season starts. null: open. Example handball D youth,
   * season 2026/27: 11–12, i.e. born 2014–2015.
   */
  ageFrom: number | null;
  ageTo: number | null;
  /** How long a game blocks the hall, in minutes (helper duty blocks, "live" window). */
  gameMinutes: number;
  /** Home games get a youth referee duty block . */
  youthReferee?: boolean;
  /**
   * What players of this youth class may do in the app themselves (children in the app); missing: everything.
   * Without an own account they can do nothing themselves, the parents respond and chat.
   */
  child?: Partial<ChildLimits>;
}

/** Youngest classes: no own account, the parents respond and chat for their child. */
export const CHILD_VIA_PARENTS: Partial<ChildLimits> = { account: false };

export interface DutyTypeTemplate {
  code: string;
  name: Record<Locale, string>;
  mode: "onsite" | "task";
  whoParents: boolean;
  whoReferees?: boolean;
  noteAllowed?: boolean;
  needsSkill?: boolean;
}

export interface SportProfile {
  /** Stored in the club profile, lowercase. Never rename it: clubs have it stored. */
  id: string;
  name: Record<Locale, string>;
  /** Default first day of a season (month, day). */
  seasonStart: { month: number; day: number };
  ageClasses: AgeClassTemplate[];
  dutyTypes: DutyTypeTemplate[];
  /** Duty templates for home and away games: duty code, slots, minutes before kick-off/after the end. */
  homeTemplate: { duty: string; slots: number; before: number; after: number }[];
  awayTemplate: { duty: string; slots: number; before: number; after: number }[];
  /**
   * Where the sport is played: the app says "hall" (handball, basketball, volleyball), "pitch" (football,
   * hockey on grass) or, for "venue", a neutral word. Texts pick their wording with ICU select (venueOf).
   */
  venue: VenueKind;
}

export type VenueKind = "hall" | "pitch" | "venue";

/** Declares a sport profile; keeps the literal id (it becomes part of SportId). */
export function defineSport<const S extends SportProfile>(profile: S): S {
  return profile;
}

/** Duty types many sports share. */
export const DUTY_KIOSK: DutyTypeTemplate = { code: "kiosk", name: { en: "Cake & kiosk", de: "Kuchen & Theke" }, mode: "onsite", whoParents: true, noteAllowed: true };
export const DUTY_SHIRTS: DutyTypeTemplate = { code: "shirts", name: { en: "Wash shirts", de: "Trikots waschen" }, mode: "task", whoParents: true };

/** Birth years of an age class for a season starting in startYear. */
export function birthYears(template: Pick<AgeClassTemplate, "ageFrom" | "ageTo">, startYear: number): { min: number | null; max: number | null } {
  return {
    min: template.ageTo == null ? null : startYear - template.ageTo,
    max: template.ageFrom == null ? null : startYear - template.ageFrom,
  };
}

export type TeamGender = "f" | "m" | "x";

/** Short label of a team's age class and gender, e.g. "wD" / "gE" in German, "D girls" in English. */
export function genderPrefix(locale: Locale, gender: TeamGender): string {
  if (locale === "de") return gender === "f" ? "w" : gender === "m" ? "m" : "g";
  return gender === "f" ? "girls/women" : gender === "m" ? "boys/men" : "mixed";
}

/** Season around a day from the sport's season start, e.g. 2026-07-01 – 2027-06-30 "2026/27". */
export function seasonAround(today: string, start: { month: number; day: number }) {
  const year = Number(today.slice(0, 4));
  const pad = (n: number) => String(n).padStart(2, "0");
  const from = today >= `${year}-${pad(start.month)}-${pad(start.day)}` ? year : year - 1;
  const end = new Date(Date.UTC(from + 1, start.month - 1, start.day - 1));
  return {
    name: start.month === 1 && start.day === 1 ? String(from) : `${from}/${pad((from + 1) % 100)}`,
    startsOn: `${from}-${pad(start.month)}-${pad(start.day)}`,
    endsOn: `${end.getUTCFullYear()}-${pad(end.getUTCMonth() + 1)}-${pad(end.getUTCDate())}`,
  };
}
