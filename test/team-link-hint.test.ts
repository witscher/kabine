// Team links in a team that is already set up: the team view counts the people of each link's kind who have an
// access, so the app can suggest personal links. Creating a team link stays allowed. Names are invented.
import { beforeEach, describe, expect, it } from "vitest";
import { teamSetUp } from "../shared/invites";
import { api, exec, freshDb, guardian, loginAs, member, person, season, team } from "./helpers";

let wd: number;
let wc: number;
let coachCookie: string;

beforeEach(async () => {
  await freshDb();
  await season();
  wd = await team("wD", "wD");
  wc = await team("wC", "wC");
  const doris = await person("Doris");
  await member(doris, wd, "coach");
  coachCookie = await loginAs(doris);
});

const withAccess = async () => (await api(`/teams/${wd}`, { cookie: coachCookie })).body.withAccess as { player: number; parent: number };

describe("team links in a set-up team", () => {
  it("counts players with an access and the parents with an access of the team's players", async () => {
    const names = ["Ida", "Jana", "Kim", "Lina", "Mia", "Nele", "Ola"];
    const kids: number[] = [];
    for (const name of names) {
      const id = await person(name, { birthYear: 2014 });
      await member(id, wd);
      kids.push(id);
    }
    // Five players with an access, one more whose access is switched off: not set up yet
    for (const id of kids.slice(0, 6)) await loginAs(id);
    await exec("UPDATE accounts SET disabled_at = '2026-01-01T00:00:00Z' WHERE person_id = ?", kids[5]);
    expect(await withAccess()).toEqual({ player: 5, parent: 0 });
    expect(teamSetUp(5)).toBe(false);
    await loginAs(kids[6]!);
    expect((await withAccess()).player).toBe(6);
    expect(teamSetUp(6)).toBe(true);

    // Parents: one with two children counts once; a parent without an access or of a child in another team does not count
    const mara = await person("Mara");
    await guardian(mara, kids[0]!);
    await guardian(mara, kids[1]!);
    await loginAs(mara);
    await guardian(await person("Paul"), kids[2]!);
    const other = await person("Otto");
    const wcKid = await person("Wanda");
    await member(wcKid, wc);
    await guardian(other, wcKid);
    await loginAs(other);
    expect(await withAccess()).toEqual({ player: 6, parent: 1 });

    // The hint changes nothing on the server: the team link is still created
    expect((await api(`/teams/${wd}/invites`, { cookie: coachCookie, body: { kind: "player" } })).status).toBe(201);
    expect((await api(`/teams/${wd}/invites`, { cookie: coachCookie, body: { kind: "parent" } })).status).toBe(201);
  });
});
