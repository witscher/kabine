// Coaches, leads, staff and organisers say "I'm not there" (worker/domain/leaders.ts). Names invented.
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PushJob } from "../worker/domain/notify";
import { EXPORT_TABLES } from "../worker/routes/season";
import { cleanup } from "../worker/cron";
import { api, eventIn, exec, freshDb, guardian, loginAs, member, migrateRest, one, person, rows, season, team, upgradeFrom } from "./helpers";

let wd: number;
let training: number;
let tara: number;
let uwe: number;
let lina: number;
let mama: number;
let taraCookie: string;
let uweCookie: string;
let linaCookie: string;
let mamaCookie: string;
let adminCookie: string;
let pushes: PushJob[];

async function withPush(personId: number) {
  const account = (await one<{ id: number }>("SELECT id FROM accounts WHERE person_id = ?", personId)).id;
  await exec("INSERT INTO push_subscriptions (account_id, endpoint, p256dh, auth) VALUES (?, ?, 'x', 'y')", account, `https://push.example/${account}`);
  return account;
}

/** Pushes go out in waitUntil after the response */
async function pushesFor(account: number, count = 1): Promise<PushJob["payload"][]> {
  await vi.waitFor(() => expect(pushes.filter((p) => p.accountIds.includes(account)).length).toBeGreaterThanOrEqual(count));
  return pushes.filter((p) => p.accountIds.includes(account)).map((p) => p.payload);
}

const settle = () => new Promise((r) => setTimeout(r, 50));

beforeEach(async () => {
  await freshDb();
  await season();
  wd = await team("wD", "wD");
  tara = await person("Tara", { lastName: "Trainer" });
  uwe = await person("Uwe", { lastName: "Co" });
  lina = await person("Lina");
  mama = await person("Maren");
  const admin = await person("Ada", { admin: true });
  await member(tara, wd, "coach");
  await member(uwe, wd, "coach");
  await member(lina, wd);
  await guardian(mama, lina);
  training = await eventIn(wd, 2);
  taraCookie = await loginAs(tara);
  uweCookie = await loginAs(uwe);
  linaCookie = await loginAs(lina);
  mamaCookie = await loginAs(mama);
  adminCookie = await loginAs(admin);
  pushes = [];
  vi.spyOn(env.PUSH_QUEUE, "sendBatch").mockImplementation(async (jobs) => {
    pushes.push(...[...jobs].map((j) => j.body as PushJob));
    return { metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } } } as unknown as QueueSendBatchResponse;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("leader absence", () => {
  it("a coach says she is not there: coaches see it with the note, players only that she is missing", async () => {
    const put = await api(`/events/${training}/absence`, { method: "PUT", cookie: taraCookie, body: { note: "Sam runs the training" } });
    expect(put.status).toBe(200);

    const forCoach = (await api(`/events/${training}`, { cookie: uweCookie })).body;
    expect(forCoach.leaders).toEqual([
      { personId: tara, name: "Tara T.", role: "coach", absent: true, note: "Sam runs the training", teamInformed: false, canChange: false },
      { personId: uwe, name: "Uwe C.", role: "coach", absent: false, note: null, teamInformed: false, canChange: true },
    ]);
    // Leaders are not participants: counts and responses stay as they were
    expect(forCoach.participants.map((p: { person: { id: number } }) => p.person.id)).toEqual([lina]);

    const own = (await api(`/events/${training}`, { cookie: taraCookie })).body;
    expect(own.leaderAbsent).toBe(true);
    expect(own.leaders.find((l: { personId: number }) => l.personId === tara)).toMatchObject({ note: "Sam runs the training", canChange: true });
    const list = (await api("/events", { cookie: taraCookie })).body.events;
    expect(list.find((e: { id: number }) => e.id === training).leaderAbsent).toBe(true);

    // Players and parents: only the absent coach, never the note, also with responses visible to all
    await exec("UPDATE teams SET show_responses = 1 WHERE id = ?", wd);
    for (const cookie of [linaCookie, mamaCookie]) {
      const detail = (await api(`/events/${training}`, { cookie })).body;
      expect(detail.leaders).toEqual([{ personId: tara, name: "Tara T.", role: "coach", absent: true, note: null, teamInformed: false, canChange: false }]);
      expect(detail.leaderAbsent).toBe(false);
    }
  });

  it("only leaders, only for themselves, only before the start of an event that takes place", async () => {
    const body = { note: "x" };
    expect((await api(`/events/${training}/absence`, { method: "PUT", cookie: linaCookie, body })).body.error.code).toBe("not_leader");
    // Admin rights alone make nobody a leader
    expect((await api(`/events/${training}/absence`, { method: "PUT", cookie: adminCookie, body })).status).toBe(403);

    const started = await eventIn(wd, 0, { time: "00:00" });
    expect((await api(`/events/${started}/absence`, { method: "PUT", cookie: taraCookie, body })).status).toBe(409);
    await exec("UPDATE events SET cancelled_at = '2026-10-01T10:00:00Z' WHERE id = ?", training);
    expect((await api(`/events/${training}/absence`, { method: "PUT", cookie: taraCookie, body })).status).toBe(409);

    const clubWide = await eventIn(wd, 3, { kind: "special", title: "Club party" });
    await exec("UPDATE events SET club_wide = 1 WHERE id = ?", clubWide);
    expect((await api(`/events/${clubWide}/absence`, { method: "PUT", cookie: taraCookie, body })).status).toBe(403);
    expect((await api(`/events/${clubWide}`, { cookie: adminCookie })).body.leaders).toEqual([]);
  });

  it("pushes: other coaches with the note; the team only when told, without the note; undo to the same people", async () => {
    const uweAccount = await withPush(uwe);
    const linaAccount = await withPush(lina);
    const mamaAccount = await withPush(mama);
    const taraAccount = await withPush(tara);

    await api(`/events/${training}/absence`, { method: "PUT", cookie: taraCookie, body: { note: "Sam runs the training" } });
    const [toUwe] = await pushesFor(uweAccount);
    expect(toUwe).toMatchObject({ title: "Tara T. ist nicht da", url: `/termine/${training}` });
    expect(toUwe!.body).toContain("Sam runs the training");
    await settle();
    expect(pushes.some((p) => p.accountIds.includes(linaAccount) || p.accountIds.includes(taraAccount))).toBe(false);

    // Editing the note sends nothing; telling the team later reaches only the team
    pushes = [];
    await api(`/events/${training}/absence`, { method: "PUT", cookie: taraCookie, body: { note: "Sam and Kai run it" } });
    await settle();
    expect(pushes).toEqual([]);
    await api(`/events/${training}/absence`, { method: "PUT", cookie: taraCookie, body: { note: "Sam and Kai run it", informTeam: true } });
    const [toLina] = await pushesFor(linaAccount);
    expect(toLina!.body).not.toContain("Sam");
    expect(toLina!.body).toContain("findet wie geplant statt");
    await pushesFor(mamaAccount);
    expect(pushes.some((p) => p.accountIds.includes(uweAccount))).toBe(false);
    expect(await one("SELECT note, team_informed FROM leader_absences WHERE event_id = ? AND person_id = ?", training, tara)).toEqual({
      note: "Sam and Kai run it",
      team_informed: 1,
    });

    pushes = [];
    expect((await api(`/events/${training}/absence`, { method: "DELETE", cookie: taraCookie })).status).toBe(200);
    expect((await pushesFor(uweAccount))[0]).toMatchObject({ title: "Tara T. ist doch da" });
    await pushesFor(linaAccount);
    expect(await rows("SELECT * FROM leader_absences")).toEqual([]);
  });

  it("staff, group leads and organisers of a special event are leaders too", async () => {
    const pia = await person("Pia", { lastName: "Physio" });
    await exec("INSERT INTO team_memberships (person_id, team_id, role) VALUES (?, ?, 'staff')", pia, wd);
    const group = await team("Coaching team", "F");
    await exec("UPDATE teams SET kind = 'group' WHERE id = ?", group);
    await member(uwe, group, "coach");
    const meeting = await eventIn(group, 4, { kind: "special", title: "Coaches' meeting" });
    const party = await eventIn(wd, 5, { kind: "special", title: "Team party" });
    await exec("UPDATE events SET created_by = ? WHERE id = ?", mama, party);

    const piaCookie = await loginAs(pia);
    expect((await api(`/events/${training}/absence`, { method: "PUT", cookie: piaCookie, body: {} })).status).toBe(200);
    expect((await api(`/events/${training}`, { cookie: taraCookie })).body.leaders.map((l: { role: string }) => l.role)).toEqual(["coach", "coach", "staff"]);
    expect((await api(`/events/${meeting}`, { cookie: uweCookie })).body.leaders).toMatchObject([{ personId: uwe, role: "lead" }]);
    const partyLeaders = (await api(`/events/${party}`, { cookie: taraCookie })).body.leaders;
    expect(partyLeaders.map((l: { personId: number; role: string }) => [l.personId, l.role])).toEqual([
      [tara, "coach"],
      [uwe, "coach"],
      [pia, "staff"],
      [mama, "organizer"],
    ]);
    expect((await api(`/events/${party}/absence`, { method: "PUT", cookie: mamaCookie, body: {} })).status).toBe(200);
  });

  it("the note is deleted 60 days after the event, like a decline reason", async () => {
    await api(`/events/${training}/absence`, { method: "PUT", cookie: taraCookie, body: { note: "Sam runs the training" } });
    await cleanup(env.DB, Date.now() + 61 * 86_400_000);
    expect(await one("SELECT note FROM leader_absences WHERE event_id = ?", training)).toEqual({ note: "Sam runs the training" });
    await cleanup(env.DB, Date.now() + 63 * 86_400_000);
    expect(await one("SELECT note FROM leader_absences WHERE event_id = ?", training)).toEqual({ note: null });
  });

  it("is part of the export and goes with the event", async () => {
    expect(EXPORT_TABLES).toContain("leader_absences");
    await api(`/events/${training}/absence`, { method: "PUT", cookie: taraCookie, body: {} });
    await exec("DELETE FROM events WHERE id = ?", training);
    expect(await rows("SELECT * FROM leader_absences")).toEqual([]);
  });
});

describe("migration 202610192140_core_leader-absences.sql", () => {
  it("adds the table to a database with data, everyone counts as present", async () => {
    await upgradeFrom("202610192140_core_leader-absences.sql");
    const wd = await team("wD", "wD");
    const coach = await person("Tara");
    await member(coach, wd, "coach");
    const event = await eventIn(wd, 2);
    await migrateRest();
    expect(await one("SELECT count(*) AS n FROM events WHERE id = ?", event)).toEqual({ n: 1 });
    expect(await rows("SELECT * FROM leader_absences")).toEqual([]);
    await exec("INSERT INTO leader_absences (event_id, person_id) VALUES (?, ?)", event, coach);
    expect(await one("SELECT team_informed, note FROM leader_absences")).toEqual({ team_informed: 0, note: null });
  });
});
