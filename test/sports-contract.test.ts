// Contract every sport profile (sports/<id>.ts) must fulfil. A new sport only needs its file and a line
// in sports/index.ts; this test tells what is missing. Guide: docs/dev/sports.md.
import { describe, expect, it } from "vitest";
import { LOCALES } from "../shared/i18n";
import { MODULES } from "../shared/modules";
import { SPORT_LIST, SPORTS } from "../shared/sports";

describe.each(SPORT_LIST.map((s) => [s.id, s] as const))("sport %s", (id, sport) => {
  it("has a lowercase id and a name in every language", () => {
    expect(id).toMatch(/^[a-z][a-z0-9-]*$/);
    for (const l of LOCALES) expect(sport.name[l], `name.${l}`).toBeTruthy();
  });

  it("says where it is played (texts pick hall, pitch or neutral wording)", () => {
    expect(["hall", "pitch", "venue"]).toContain(sport.venue);
  });

  it("has a valid season start", () => {
    const { month, day } = sport.seasonStart;
    expect(month >= 1 && month <= 12).toBe(true);
    expect(day >= 1 && day <= 28).toBe(true);
  });

  it("has age classes from young to old without gaps or overlaps", () => {
    const classes = sport.ageClasses;
    expect(classes.length).toBeGreaterThan(0);
    expect(new Set(classes.map((a) => a.code)).size, "codes unique").toBe(classes.length);
    classes.forEach((a, i) => {
      for (const l of LOCALES) expect(a.name[l], `${a.code}: name.${l}`).toBeTruthy();
      expect(a.gameMinutes, `${a.code}: gameMinutes`).toBeGreaterThan(0);
      if (i > 0) expect(a.rank, `${a.code}: rank ascending`).toBeGreaterThan(classes[i - 1]!.rank);
      // Only the youngest class may be open downwards, only the oldest upwards
      if (i > 0) expect(a.ageFrom, `${a.code}: ageFrom`).not.toBeNull();
      if (i < classes.length - 1) expect(a.ageTo, `${a.code}: ageTo`).not.toBeNull();
      if (a.ageFrom != null && a.ageTo != null) expect(a.ageTo, `${a.code}: ageTo >= ageFrom`).toBeGreaterThanOrEqual(a.ageFrom);
      if (i > 0) expect(a.ageFrom, `${a.code}: follows ${classes[i - 1]!.code} without gap or overlap`).toBe(classes[i - 1]!.ageTo! + 1);
    });
    expect(classes.at(-1)!.youth, "the oldest class is for adults").toBe(false);
  });

  it("has duty types in every language and templates that only use them", () => {
    const codes = new Set(sport.dutyTypes.map((d) => d.code));
    expect(codes.size, "duty codes unique").toBe(sport.dutyTypes.length);
    for (const d of sport.dutyTypes) for (const l of LOCALES) expect(d.name[l], `${d.code}: name.${l}`).toBeTruthy();
    for (const item of [...sport.homeTemplate, ...sport.awayTemplate]) {
      expect(codes.has(item.duty), `template uses unknown duty "${item.duty}"`).toBe(true);
      expect(item.slots).toBeGreaterThan(0);
      expect(item.before).toBeGreaterThanOrEqual(0);
      expect(item.after).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("sport registry", () => {
  it("ids are unique and 'other' comes last", () => {
    const ids = SPORT_LIST.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.at(-1)).toBe("other");
    expect(Object.keys(SPORTS)).toEqual(ids);
  });

  it("modules only name sports that exist", () => {
    for (const m of MODULES) {
      for (const sport of ("sports" in m ? m.sports : undefined) ?? []) expect(Object.keys(SPORTS), `${m.id}: sports`).toContain(sport);
    }
  });
});
