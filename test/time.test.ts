import { describe, expect, it } from "vitest";
import { addDays, addMinutesLocal, isoWeekday, localToInstant, toLocal } from "../worker/lib/time";

describe("Zeit in Europe/Berlin", () => {
  it("rechnet Winter- und Sommerzeit korrekt um", () => {
    expect(new Date(localToInstant("2027-01-15T18:00")).toISOString()).toBe("2027-01-15T17:00:00.000Z");
    expect(new Date(localToInstant("2027-07-15T18:00")).toISOString()).toBe("2027-07-15T16:00:00.000Z");
  });

  it("überspringt die Umstellung im März und Oktober sauber", () => {
    // Letzter Sonntag im März 2027: 28.03., 02:00 -> 03:00
    expect(new Date(localToInstant("2027-03-28T10:00")).toISOString()).toBe("2027-03-28T08:00:00.000Z");
    expect(new Date(localToInstant("2027-03-27T10:00")).toISOString()).toBe("2027-03-27T09:00:00.000Z");
    // Letzter Sonntag im Oktober 2026: 25.10., 03:00 -> 02:00
    expect(new Date(localToInstant("2026-10-25T18:00")).toISOString()).toBe("2026-10-25T17:00:00.000Z");
    expect(new Date(localToInstant("2026-10-24T18:00")).toISOString()).toBe("2026-10-24T16:00:00.000Z");
  });

  it("ist Umkehrfunktion von toLocal", () => {
    for (const local of ["2026-10-03T07:30", "2026-12-31T23:59", "2027-03-28T03:30", "2027-06-01T00:00"]) {
      expect(toLocal(localToInstant(local))).toBe(local);
    }
  });

  it("Frist 6 Stunden vor einem Termin am Umstellungstag", () => {
    const start = localToInstant("2027-03-28T10:00");
    expect(toLocal(start - 6 * 3_600_000)).toBe("2027-03-28T04:00");
  });

  it("Datumshilfen", () => {
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
    expect(isoWeekday("2026-10-03")).toBe(6);
    expect(isoWeekday("2026-10-04")).toBe(7);
    expect(isoWeekday("2026-10-05")).toBe(1);
    expect(addMinutesLocal("2026-10-24T23:30", 90)).toBe("2026-10-25T01:00");
  });
});
