// Training groups: the special events of a group such as the goalkeeper training count as trainings for the kind chips
// on home (docs/dev/decisions.md, "Training groups"). Names invented.
import { beforeEach, describe, expect, it } from "vitest";
import type { EventPage, EventSummary } from "../shared/types";
import { fitsListFilter } from "../worker/domain/events";
import { api, eventIn, exec, freshDb, guardian, loginAs, member, migrateRest, one, person, season, team, upgradeFrom } from "./helpers";

let wc: number;
let keepers: number;
let kid: number;
let dad: number;
let keeperCoach: number;
let admin: number;

beforeEach(async () => {
  await freshDb();
  await season();
  wc = await team("wC", "wC");
  keepers = await team("Goalkeepers", "wC");
  await exec("UPDATE teams SET kind = 'group', parents_enabled = 1 WHERE id = ?", keepers);
  kid = await person("Kira", { birthYear: 2013 });
  dad = await person("Theo");
  keeperCoach = await person("Gerd");
  admin = await person("Ada", { admin: true });
  await member(kid, wc);
  await member(kid, keepers);
  await guardian(dad, kid);
  await member(keeperCoach, keepers, "coach");
});

const page = async (cookie: string, q = "") => (await api<EventPage>(`/events?limit=30&teams=all${q}`, { cookie })).body;
const ids = (list: EventSummary[]) => list.map((e) => e.id);
const version = async () => (await one<{ version: number }>("SELECT version FROM cache_versions WHERE name = 'ref'")).version;

describe("training group", () => {
  it("special events of the group are under the chip 'Training' instead of 'Other'; the switch is for admins and groups only", async () => {
    const session = await eventIn(keepers, 1, { kind: "special", title: "Goalkeeper training", time: "18:30" });
    const party = await eventIn(wc, 2, { kind: "special", title: "Season party" });
    const training = await eventIn(wc, 3);
    const cookie = await loginAs(dad);
    expect(ids((await page(cookie, "&show=training")).events)).toEqual([training]);
    expect(ids((await page(cookie, "&show=other")).events)).toEqual([session, party]);
    expect((await page(cookie)).events.find((e) => e.id === session)?.asTraining).toBe(false);

    expect((await api(`/teams/${keepers}`, { method: "PATCH", cookie: await loginAs(keeperCoach), body: { trainingGroup: true } })).status).toBe(403);
    const adminCookie = await loginAs(admin);
    const notGroup = await api(`/teams/${wc}`, { method: "PATCH", cookie: adminCookie, body: { trainingGroup: true } });
    expect(notGroup.body.error.code).toBe("group_only");
    expect((await api(`/teams/${keepers}`, { method: "PATCH", cookie: adminCookie, body: { trainingGroup: true } })).status).toBe(200);
    expect((await api(`/teams/${keepers}`, { cookie: adminCookie })).body.trainingGroup).toBe(true);

    // The cached team info follows at once (trigger on teams)
    expect(ids((await page(cookie, "&show=training")).events)).toEqual([session, training]);
    expect(ids((await page(cookie, "&show=other")).events)).toEqual([party]);
    const all = await page(cookie);
    expect(ids(all.events)).toEqual([session, party, training]);
    const summary = all.events.find((e) => e.id === session)!;
    // Nothing else changes: still a special event with its title
    expect(summary).toMatchObject({ kind: "special", asTraining: true, title: "Goalkeeper training" });
    expect(all.events.find((e) => e.id === party)?.asTraining).toBe(false);
    // Games and trainings are never "as training"
    expect(all.events.find((e) => e.id === training)?.asTraining).toBe(false);

    // Switched off again: back under "Other"
    expect((await api(`/teams/${keepers}`, { method: "PATCH", cookie: adminCookie, body: { trainingGroup: false } })).status).toBe(200);
    expect(ids((await page(cookie, "&show=training")).events)).toEqual([training]);
  });

  it("the large card finds the group's next session beyond the page with the chip 'Training'", async () => {
    await exec("UPDATE teams SET training_group = 1 WHERE id = ?", keepers);
    // Many trainings of another team the father sees as a coach fill the page; the child's goalkeeper session comes later
    const other = await team("mB", "mB");
    await member(dad, other, "coach");
    for (let d = 1; d <= 8; d++) await eventIn(other, d);
    const session = await eventIn(keepers, 20, { kind: "special", title: "Goalkeeper training" });
    const cookie = await loginAs(dad);
    const res = (await api<EventPage>("/events?limit=3&teams=all&show=training", { cookie })).body;
    expect(ids(res.next)).toEqual([session]);
    expect(res.next[0]!.asTraining).toBe(true);
    expect((await api<EventPage>("/events?limit=3&teams=all&show=other", { cookie })).body.next).toEqual([]);
  });

  it("a change of the column bumps the cache version, other updates of the hourly sync do not", async () => {
    const before = await version();
    await exec("UPDATE teams SET training_group = 1 WHERE id = ?", keepers);
    expect(await version()).toBe(before + 1);
    await exec("UPDATE teams SET fixture_synced_at = '2026-11-27T10:00' WHERE id = ?", keepers);
    expect(await version()).toBe(before + 1);
  });

  it("fitsListFilter uses the same rule as the query", () => {
    const s = { kind: "special" as const, asTraining: true, clubWide: false, teams: [{ id: 1 }] };
    expect(fitsListFilter(s, { teamIds: null, kinds: ["training"] })).toBe(true);
    expect(fitsListFilter(s, { teamIds: null, kinds: ["special"] })).toBe(false);
    expect(fitsListFilter({ ...s, asTraining: false }, { teamIds: null, kinds: ["special"] })).toBe(true);
    expect(fitsListFilter(s, undefined)).toBe(true);
  });

  it("the export contains the switch", async () => {
    await exec("UPDATE teams SET training_group = 1 WHERE id = ?", keepers);
    const res = await api("/admin/export", { cookie: await loginAs(admin) });
    expect(res.status).toBe(200);
    expect(res.body.data.teams.find((t: { id: number }) => t.id === keepers).training_group).toBe(1);
  });
});

describe("migration 202611270300_core_training-groups.sql", () => {
  it("existing groups stay as they were; the cache trigger includes the column", async () => {
    await upgradeFrom("202611270300_core_training-groups.sql");
    const id = (await one<{ id: number }>("INSERT INTO teams (name, age_class_code, kind) VALUES ('Coaches', 'Adults', 'group') RETURNING id")).id;
    await migrateRest();
    expect(await one("SELECT training_group FROM teams WHERE id = ?", id)).toEqual({ training_group: 0 });
    const before = await version();
    await exec("UPDATE teams SET training_group = 1 WHERE id = ?", id);
    expect(await version()).toBe(before + 1);
    await exec("UPDATE teams SET max_squad = 15 WHERE id = ?", id);
    expect(await version()).toBe(before + 2);
  });
});
