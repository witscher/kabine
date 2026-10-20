// Training venues: admins add the club's halls or pitches, coaches other venues. Invented names.
import { beforeEach, describe, expect, it } from "vitest";
import { api, freshDb, loginAs, member, person, season, team } from "./helpers";

let adminCookie: string;
let coachCookie: string;

beforeEach(async () => {
  await freshDb();
  await season();
  const wd = await team("wD", "wD");
  const coach = await person("Tina");
  await member(coach, wd, "coach");
  adminCookie = await loginAs(await person("Ada", { admin: true }));
  coachCookie = await loginAs(coach);
});

describe("training venues", () => {
  it("a new installation starts empty; admins add club halls, coaches other venues", async () => {
    expect((await api("/locations?all=1", { cookie: adminCookie })).body.locations).toEqual([]);
    const hall = await api("/locations", { cookie: adminCookie, body: { kind: "hall", name: "Sporthalle Schulzentrum", address: "Schulweg 1, 12345 Musterstadt" } });
    expect(hall.status).toBe(201);
    expect((await api("/locations", { cookie: coachCookie, body: { kind: "hall", name: "Halle 2" } })).status).toBe(403);
    expect((await api("/locations", { cookie: coachCookie, body: { name: "Sportplatz am See" } })).status).toBe(201);
    const list = (await api("/locations", { cookie: coachCookie })).body.locations;
    expect(list.map((l: { name: string; kind: string }) => [l.name, l.kind])).toEqual([
      ["Sporthalle Schulzentrum", "hall"],
      ["Sportplatz am See", "custom"],
    ]);
  });
});
