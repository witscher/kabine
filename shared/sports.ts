// Sport profiles: age classes, playing times and default helper duties as data. The setup wizard
// creates the age classes of the season and the duty types from the chosen profile; admins adjust
// them afterwards. Age classes carry no gender: a team is age class + gender + level.
import type { Locale } from "./i18n";

export type SportId = "handball" | "football" | "other";

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
  /** Home games get a youth referee duty block (handball: KiHaSL/JuHaSL). */
  youthReferee?: boolean;
}

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
  id: SportId;
  name: Record<Locale, string>;
  /** Default first day of a season (month, day). */
  seasonStart: { month: number; day: number };
  ageClasses: AgeClassTemplate[];
  dutyTypes: DutyTypeTemplate[];
  /** Duty templates for home and away games: duty code, slots, minutes before kick-off/after the end. */
  homeTemplate: { duty: string; slots: number; before: number; after: number }[];
  awayTemplate: { duty: string; slots: number; before: number; after: number }[];
  /** Fixture connectors available for this sport (module "fixtures"). */
  connectors: string[];
}

const CAKE: DutyTypeTemplate = { code: "kiosk", name: { en: "Cake & kiosk", de: "Kuchen & Theke" }, mode: "onsite", whoParents: true, noteAllowed: true };
const SHIRTS: DutyTypeTemplate = { code: "shirts", name: { en: "Wash shirts", de: "Trikots waschen" }, mode: "task", whoParents: true };

export const SPORTS: Record<SportId, SportProfile> = {
  handball: {
    id: "handball",
    name: { en: "Handball", de: "Handball" },
    seasonStart: { month: 7, day: 1 },
    ageClasses: [
      { code: "Bambini", name: { en: "Bambini", de: "Bambini" }, rank: 0, youth: true, ageFrom: null, ageTo: 5, gameMinutes: 60 },
      { code: "Minis", name: { en: "Minis", de: "Minis" }, rank: 1, youth: true, ageFrom: 6, ageTo: 8, gameMinutes: 60 },
      { code: "E", name: { en: "E youth", de: "E-Jugend" }, rank: 2, youth: true, ageFrom: 9, ageTo: 10, gameMinutes: 75, youthReferee: true },
      { code: "D", name: { en: "D youth", de: "D-Jugend" }, rank: 3, youth: true, ageFrom: 11, ageTo: 12, gameMinutes: 90, youthReferee: true },
      { code: "C", name: { en: "C youth", de: "C-Jugend" }, rank: 4, youth: true, ageFrom: 13, ageTo: 14, gameMinutes: 90, youthReferee: true },
      { code: "B", name: { en: "B youth", de: "B-Jugend" }, rank: 5, youth: true, ageFrom: 15, ageTo: 16, gameMinutes: 90 },
      { code: "A", name: { en: "A youth", de: "A-Jugend" }, rank: 6, youth: true, ageFrom: 17, ageTo: 18, gameMinutes: 120 },
      { code: "Adults", name: { en: "Adults", de: "Aktive" }, rank: 7, youth: false, ageFrom: 19, ageTo: null, gameMinutes: 120 },
    ],
    dutyTypes: [
      CAKE,
      { code: "timekeeper", name: { en: "Timekeeper", de: "Zeitnehmer" }, mode: "onsite", whoParents: true, needsSkill: true },
      { code: "scorer", name: { en: "Scorer", de: "Sekretär" }, mode: "onsite", whoParents: true, needsSkill: true },
      SHIRTS,
      { code: "referee", name: { en: "Youth referee", de: "KiHaSL/JuHaSL" }, mode: "onsite", whoParents: false, whoReferees: true },
    ],
    homeTemplate: [
      { duty: "kiosk", slots: 2, before: 20, after: 20 },
      { duty: "timekeeper", slots: 1, before: 15, after: 0 },
      { duty: "shirts", slots: 1, before: 0, after: 0 },
    ],
    awayTemplate: [
      { duty: "scorer", slots: 1, before: 15, after: 0 },
      { duty: "shirts", slots: 1, before: 0, after: 0 },
    ],
    connectors: ["handball4all"],
  },
  football: {
    id: "football",
    name: { en: "Football", de: "Fußball" },
    seasonStart: { month: 7, day: 1 },
    ageClasses: [
      { code: "U7", name: { en: "U7", de: "G-Jugend (U7)" }, rank: 0, youth: true, ageFrom: null, ageTo: 6, gameMinutes: 60 },
      { code: "U9", name: { en: "U9", de: "F-Jugend (U9)" }, rank: 1, youth: true, ageFrom: 7, ageTo: 8, gameMinutes: 60 },
      { code: "U11", name: { en: "U11", de: "E-Jugend (U11)" }, rank: 2, youth: true, ageFrom: 9, ageTo: 10, gameMinutes: 75 },
      { code: "U13", name: { en: "U13", de: "D-Jugend (U13)" }, rank: 3, youth: true, ageFrom: 11, ageTo: 12, gameMinutes: 90 },
      { code: "U15", name: { en: "U15", de: "C-Jugend (U15)" }, rank: 4, youth: true, ageFrom: 13, ageTo: 14, gameMinutes: 105 },
      { code: "U17", name: { en: "U17", de: "B-Jugend (U17)" }, rank: 5, youth: true, ageFrom: 15, ageTo: 16, gameMinutes: 120 },
      { code: "U19", name: { en: "U19", de: "A-Jugend (U19)" }, rank: 6, youth: true, ageFrom: 17, ageTo: 18, gameMinutes: 135 },
      { code: "Adults", name: { en: "Adults", de: "Aktive" }, rank: 7, youth: false, ageFrom: 19, ageTo: null, gameMinutes: 135 },
    ],
    dutyTypes: [CAKE, { code: "linesman", name: { en: "Assistant referee", de: "Linienrichter" }, mode: "onsite", whoParents: true }, SHIRTS],
    homeTemplate: [
      { duty: "kiosk", slots: 2, before: 30, after: 30 },
      { duty: "shirts", slots: 1, before: 0, after: 0 },
    ],
    awayTemplate: [{ duty: "shirts", slots: 1, before: 0, after: 0 }],
    connectors: [],
  },
  other: {
    id: "other",
    name: { en: "Other sport", de: "Andere Sportart" },
    seasonStart: { month: 8, day: 1 },
    ageClasses: [
      { code: "Kids", name: { en: "Children", de: "Kinder" }, rank: 0, youth: true, ageFrom: null, ageTo: 11, gameMinutes: 90 },
      { code: "Teens", name: { en: "Teenagers", de: "Jugendliche" }, rank: 1, youth: true, ageFrom: 12, ageTo: 17, gameMinutes: 120 },
      { code: "Adults", name: { en: "Adults", de: "Erwachsene" }, rank: 2, youth: false, ageFrom: 18, ageTo: null, gameMinutes: 120 },
    ],
    dutyTypes: [CAKE, SHIRTS],
    homeTemplate: [{ duty: "kiosk", slots: 2, before: 30, after: 30 }],
    awayTemplate: [],
    connectors: [],
  },
};

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
