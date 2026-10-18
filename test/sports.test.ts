// Sport profiles: consistent data, birth years per season.
import { describe, expect, it } from "vitest";
import { birthYears, SPORTS } from "../shared/sports";

describe("Sportarten", () => {
  it("Altersklassen lückenlos, Ränge aufsteigend, Dienste der Vorlagen vorhanden", () => {
    for (const sport of Object.values(SPORTS)) {
      const classes = sport.ageClasses;
      expect(classes.map((c) => c.rank)).toEqual([...classes.map((c) => c.rank)].sort((a, b) => a - b));
      for (let i = 1; i < classes.length; i++) expect(classes[i]!.ageFrom).toBe((classes[i - 1]!.ageTo ?? -1) + 1);
      expect(classes[0]!.ageFrom).toBeNull();
      expect(classes.at(-1)!.ageTo).toBeNull();
      const codes = new Set(sport.dutyTypes.map((d) => d.code));
      for (const item of [...sport.homeTemplate, ...sport.awayTemplate]) expect(codes.has(item.duty)).toBe(true);
      expect(new Set(classes.map((c) => c.code)).size).toBe(classes.length);
    }
  });

  it("Jahrgänge der Handball-D-Jugend 2026/27", () => {
    const d = SPORTS.handball.ageClasses.find((c) => c.code === "D")!;
    expect(birthYears(d, 2026)).toEqual({ min: 2014, max: 2015 });
    expect(birthYears(SPORTS.handball.ageClasses.at(-1)!, 2026)).toEqual({ min: null, max: 2007 });
  });
});
