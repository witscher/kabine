// Cache per Worker instance (worker/lib/cache.ts): triggers bump the versions, so after every change, also one made
// directly in D1, the app shows the new state. Names invented.
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { ensureEventDuties } from "../worker/domain/duties";
import { todayLocal } from "../worker/lib/time";
import { api, eventIn, exec, freshDb, guardian, loginAs, member, migrateRest, one, person, rows, season, team, upgradeFrom } from "./helpers";

const version = async (name: string) => (await one<{ version: number }>("SELECT version FROM cache_versions WHERE name = ?", name)).version;

let wd: number;
let coachCookie: string;

beforeEach(async () => {
  await freshDb();
  await season();
  wd = await team("wD", "wD");
  const coach = await person("Tara");
  await member(coach, wd, "coach");
  coachCookie = await loginAs(coach);
});

describe("cache", () => {
  it("triggers bump the versions only on relevant changes", async () => {
    const kim = await person("Kim");
    let roster = await version("roster");
    await member(kim, wd);
    expect(await version("roster")).toBe(roster + 1);
    roster = await version("roster");
    await exec("UPDATE persons SET birth_year = 2014 WHERE id = ?", kim);
    expect(await version("roster")).toBe(roster);
    await exec("UPDATE persons SET is_active = 0 WHERE id = ?", kim);
    expect(await version("roster")).toBe(roster + 1);

    // The hourly schedule sync writes these columns: no reload of the cache
    const ref = await version("ref");
    await exec("UPDATE teams SET fixture_synced_at = '2026-11-18T10:00:00Z', fixture_claimed_at = NULL, fixture_error = NULL WHERE id = ?", wd);
    expect(await version("ref")).toBe(ref);
    await exec("UPDATE teams SET name = 'wD1' WHERE id = ?", wd);
    expect(await version("ref")).toBe(ref + 1);
  });

  it("after changes made directly in D1 the app shows the new state", async () => {
    const kim = await person("Kim");
    await member(kim, wd);
    const id = await eventIn(wd, 2);
    const detail = async () => (await api(`/events/${id}`, { cookie: coachCookie })).body;
    const names = async () => (await detail()).participants.map((p: any) => p.person.firstName);
    expect(await names()).toEqual(["Kim"]);
    // New member, renamed, inactive: all visible at once, although the state was cached
    const lea = await person("Lea");
    await exec("INSERT INTO team_memberships (person_id, team_id, role) VALUES (?, ?, 'player')", lea, wd);
    expect(await names()).toEqual(["Kim", "Lea"]);
    await exec("UPDATE persons SET first_name = 'Kira' WHERE id = ?", kim);
    expect(await names()).toEqual(["Kira", "Lea"]);
    await exec("UPDATE persons SET is_active = 0 WHERE id = ?", lea);
    expect((await detail()).participants.find((p: any) => p.person.id === lea).status).toBe("inactive");
    // Team name and parent link
    await exec("UPDATE teams SET name = 'wD1' WHERE id = ?", wd);
    expect(JSON.stringify((await detail()).teams)).toContain("wD1");
    const mona = await person("Mona");
    await guardian(mona, kim);
    const monaView = (await api(`/events/${id}`, { cookie: await loginAs(mona) })).body;
    expect(monaView.mine.map((m: any) => m.person.id)).toEqual([kim]);
  });

  it("limits of age groups apply at once", async () => {
    const we = await team("wE", "wE");
    const kid = await person("Kim", { birthYear: 2017 });
    const mona = await person("Mona");
    await member(kid, we);
    await guardian(mona, kid);
    const id = await eventIn(we, 2);
    const kidCookie = await loginAs(kid);
    const mine = async () => (await api(`/events/${id}`, { cookie: kidCookie })).body.mine[0];
    expect((await mine()).canDecline).toBe(true);
    await exec("UPDATE age_classes SET child_respond = 0 WHERE code = 'wE'");
    expect((await mine()).canDecline).toBe(false);
    await exec("UPDATE age_classes SET child_respond = 1 WHERE code = 'wE'");
    expect((await mine()).canDecline).toBe(true);
  });

  it("helper duties of games: skipped while nothing changes, generated at once afterwards", async () => {
    const game = await eventIn(wd, 5, { kind: "game" });
    await exec("UPDATE events SET is_home = 1 WHERE id = ?", game);
    const blocks = async () => (await one<{ n: number }>("SELECT count(*) AS n FROM event_duties WHERE event_id = ?", game)).n;
    // Without a helper plan at most the required duties; a second run changes nothing
    await ensureEventDuties(env.DB, [game], todayLocal());
    const before = await blocks();
    await ensureEventDuties(env.DB, [game], todayLocal());
    expect(await blocks()).toBe(before);
    // Helper plan on (directly in D1): the next run creates the blocks of the template
    await exec("UPDATE teams SET helper_plan = 1 WHERE id = ?", wd);
    await ensureEventDuties(env.DB, [game], todayLocal());
    expect(await blocks()).toBeGreaterThan(before);
  });
});

describe("migration 202611191400_core_cache-versions.sql", () => {
  it("starts with three versions; changes of a club's data bump them", async () => {
    await upgradeFrom("202611191400_core_cache-versions.sql");
    await season();
    const wc = await team("wC", "wC");
    await migrateRest();
    expect((await rows<{ name: string }>("SELECT name FROM cache_versions ORDER BY name")).map((r) => r.name)).toEqual(["duties", "ref", "roster"]);
    const ref = await version("ref");
    await exec("UPDATE teams SET max_squad = 16 WHERE id = ?", wc);
    expect(await version("ref")).toBe(ref + 1);
  });
});
