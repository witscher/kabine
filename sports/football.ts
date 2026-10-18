// Football (soccer) with the German youth classes G to A (U7 to U19).
import { defineSport, DUTY_KIOSK, DUTY_SHIRTS } from "../shared/sport-api";

export default defineSport({
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
  dutyTypes: [DUTY_KIOSK, { code: "linesman", name: { en: "Assistant referee", de: "Linienrichter" }, mode: "onsite", whoParents: true }, DUTY_SHIRTS],
  homeTemplate: [
    { duty: "kiosk", slots: 2, before: 30, after: 30 },
    { duty: "shirts", slots: 1, before: 0, after: 0 },
  ],
  awayTemplate: [{ duty: "shirts", slots: 1, before: 0, after: 0 }],
});
