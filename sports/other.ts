// Fallback for sports without a profile of their own: three broad age groups, cake and shirts.
import { defineSport, DUTY_KIOSK, DUTY_SHIRTS } from "../shared/sport-api";

export default defineSport({
  id: "other",
  name: { en: "Other sport", de: "Andere Sportart" },
  seasonStart: { month: 8, day: 1 },
  ageClasses: [
    { code: "Kids", name: { en: "Children", de: "Kinder" }, rank: 0, youth: true, ageFrom: null, ageTo: 11, gameMinutes: 90 },
    { code: "Teens", name: { en: "Teenagers", de: "Jugendliche" }, rank: 1, youth: true, ageFrom: 12, ageTo: 17, gameMinutes: 120 },
    { code: "Adults", name: { en: "Adults", de: "Erwachsene" }, rank: 2, youth: false, ageFrom: 18, ageTo: null, gameMinutes: 120 },
  ],
  dutyTypes: [DUTY_KIOSK, DUTY_SHIRTS],
  homeTemplate: [{ duty: "kiosk", slots: 2, before: 30, after: 30 }],
  awayTemplate: [],
});
