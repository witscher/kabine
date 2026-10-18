// __VENDOR__: what is special about this source. The general checks run for every connector in
// test/fixtures-contract.test.ts with the files in ../samples/. Invented names only.
import { describe, expect, it } from "vitest";
import schedule from "../samples/schedule.json";
import { connector } from "../worker/connector";

describe("__VENDOR__", () => {
  it("reads the sample schedule and recognises the own team", () => {
    const parsed = connector.parse(schedule, { leagueId: "555", teamId: "999" });
    expect(parsed.games.map((g) => g.externalId)).toEqual(["1001", "1002"]);
    expect(parsed.ownTeamHint).toBe("TV Heimverein");
  });

  it("rejects data of another league", () => {
    expect(() => connector.parse(schedule, { leagueId: "777", teamId: "999" })).toThrow();
  });
});
