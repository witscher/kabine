// Handball, as played in German associations (age classes A–E, youth referees).
import { CHILD_VIA_PARENTS, defineSport, DUTY_KIOSK, DUTY_SHIRTS } from "../shared/sport-api";

export default defineSport({
  id: "handball",
  name: { en: "Handball", de: "Handball" },
  venue: "hall",
  seasonStart: { month: 7, day: 1 },
  ageClasses: [
    { code: "Bambini", name: { en: "Bambini", de: "Bambini" }, rank: 0, youth: true, ageFrom: null, ageTo: 5, gameMinutes: 60, child: CHILD_VIA_PARENTS },
    { code: "Minis", name: { en: "Minis", de: "Minis" }, rank: 1, youth: true, ageFrom: 6, ageTo: 8, gameMinutes: 60, child: CHILD_VIA_PARENTS },
    { code: "E", name: { en: "E youth", de: "E-Jugend" }, rank: 2, youth: true, ageFrom: 9, ageTo: 10, gameMinutes: 75, youthReferee: true, child: CHILD_VIA_PARENTS },
    { code: "D", name: { en: "D youth", de: "D-Jugend" }, rank: 3, youth: true, ageFrom: 11, ageTo: 12, gameMinutes: 90, youthReferee: true },
    { code: "C", name: { en: "C youth", de: "C-Jugend" }, rank: 4, youth: true, ageFrom: 13, ageTo: 14, gameMinutes: 90, youthReferee: true },
    { code: "B", name: { en: "B youth", de: "B-Jugend" }, rank: 5, youth: true, ageFrom: 15, ageTo: 16, gameMinutes: 90 },
    { code: "A", name: { en: "A youth", de: "A-Jugend" }, rank: 6, youth: true, ageFrom: 17, ageTo: 18, gameMinutes: 120 },
    { code: "Adults", name: { en: "Adults", de: "Aktive" }, rank: 7, youth: false, ageFrom: 19, ageTo: null, gameMinutes: 120 },
  ],
  dutyTypes: [
    DUTY_KIOSK,
    { code: "timekeeper", name: { en: "Timekeeper", de: "Zeitnehmer" }, mode: "onsite", whoParents: true, needsSkill: true },
    { code: "scorer", name: { en: "Scorer", de: "Sekretär" }, mode: "onsite", whoParents: true, needsSkill: true },
    DUTY_SHIRTS,
    { code: "referee", name: { en: "Youth referee", de: "Jugendschiedsrichter" }, mode: "onsite", whoParents: false, whoReferees: true },
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
});
