// __NAME__. TODO: describe which association's rules the age classes follow (country, federation).
// Guide: docs/dev/sports.md. Names are not machine-translated at runtime: write every language here.
import { defineSport, DUTY_KIOSK, DUTY_SHIRTS } from "../shared/sport-api";

export default defineSport({
  id: "__ID__",
  name: { en: "__NAME__", de: "__NAME_DE__" },
  // TODO: first day of a season in this sport
  seasonStart: { month: 8, day: 1 },
  // TODO: the age classes of the federation. Ages are those reached in the calendar year the season
  // starts in; only the youngest class is open downwards (ageFrom: null), only the oldest upwards.
  ageClasses: [
    { code: "U12", name: { en: "Under 12", de: "U12" }, rank: 0, youth: true, ageFrom: null, ageTo: 11, gameMinutes: 60 },
    { code: "U18", name: { en: "Under 18", de: "U18" }, rank: 1, youth: true, ageFrom: 12, ageTo: 17, gameMinutes: 90 },
    { code: "Adults", name: { en: "Adults", de: "Erwachsene" }, rank: 2, youth: false, ageFrom: 18, ageTo: null, gameMinutes: 120 },
  ],
  // TODO: typical helper duties at a home game (scorers' table, referees, …)
  dutyTypes: [DUTY_KIOSK, DUTY_SHIRTS],
  homeTemplate: [{ duty: "kiosk", slots: 2, before: 30, after: 30 }],
  awayTemplate: [{ duty: "shirts", slots: 1, before: 0, after: 0 }],
});
