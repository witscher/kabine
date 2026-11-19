// Special events: without attendance, optional attendance, registration per family (docs/dev/decisions.md,
// Special events: attendance modes). Names invented.
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isRelevantEvent } from "../shared/relevance";
import { sendDeadlineReminders } from "../worker/cron";
import type { PushJob } from "../worker/domain/notify";
import { addDays, localToInstant, todayLocal } from "../worker/lib/time";
import { api, exec, freshDb, guardian, loginAs, member, migrateRest, one, person, rows, season, team, upgradeFrom } from "./helpers";

let wd: number;
let coach: number;
let coachCookie: string;
let pushes: PushJob[];

const accountOf = async (personId: number) => (await one<{ id: number }>("SELECT id FROM accounts WHERE person_id = ?", personId)).id;
const pushesFor = async (personId: number) => {
  const id = await accountOf(personId);
  return pushes.filter((p) => p.accountIds.includes(id)).map((p) => p.payload);
};

async function special(body: Record<string, unknown>, days = 2) {
  const date = addDays(todayLocal(), days);
  return api("/events", { cookie: coachCookie, body: { title: "Sommerfest", startsAt: `${date}T16:00`, endsAt: `${date}T19:00`, teamIds: [wd], ...body } });
}

const patch = (id: number, body: Record<string, unknown>) => api(`/events/${id}`, { method: "PATCH", cookie: coachCookie, body });

beforeEach(async () => {
  await freshDb();
  await season();
  wd = await team("wD", "wD");
  coach = await person("Tara", { lastName: "Lind" });
  await member(coach, wd, "coach");
  coachCookie = await loginAs(coach);
  pushes = [];
  vi.spyOn(env.PUSH_QUEUE, "sendBatch").mockImplementation(async (jobs) => {
    pushes.push(...[...jobs].map((j) => j.body as PushJob));
    return { metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } } } as unknown as QueueSendBatchResponse;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("without attendance and optional attendance", () => {
  let kim: number;
  let mona: number;
  let monaCookie: string;

  beforeEach(async () => {
    kim = await person("Kim", { lastName: "Kraus", birthYear: 2014 });
    mona = await person("Mona", { lastName: "Kraus" });
    await member(kim, wd);
    await guardian(mona, kim);
    monaCookie = await loginAs(mona);
    await exec("INSERT INTO push_subscriptions (account_id, endpoint, p256dh, auth) SELECT id, 'https://push.example/' || id, 'k', 'a' FROM accounts");
  });

  it("without attendance: visible to the team, no responses, counts or reminders; told without a request", async () => {
    const res = await special({ noAttendance: true });
    expect(res.status).toBe(201);
    const id = res.body.id as number;
    expect(await pushesFor(mona)).toEqual([expect.objectContaining({ body: expect.stringContaining("Keine Zu- oder Absage nötig.") })]);

    const ev = (await api("/events", { cookie: monaCookie })).body.events.find((e: any) => e.id === id);
    expect(ev).toMatchObject({ noAttendance: true, optionalAttendance: false, familyAttendance: false, counts: null });
    expect(ev.mine.length).toBeGreaterThan(0);
    expect(ev.mine.every((m: any) => !m.participant && !m.canAccept && !m.canDecline)).toBe(true);
    expect(isRelevantEvent(ev)).toBe(true);
    expect((await api(`/events/${id}/responses`, { cookie: monaCookie, body: { personId: kim, status: "no", reason: "Schule" } })).body.error.code).toBe("no_attendance");
    expect((await api(`/events/${id}`, { cookie: coachCookie })).body).toMatchObject({ counts: null, participants: [] });

    // No deadline reminder
    pushes.length = 0;
    await exec("UPDATE events SET decline_hours = 30 WHERE id = ?", id);
    await sendDeadlineReminders(env, localToInstant(`${todayLocal()}T08:00`));
    expect(pushes).toEqual([]);

    // Cancelling still reaches the team
    pushes.length = 0;
    expect((await api(`/events/${id}/cancel`, { cookie: coachCookie, body: { reason: "Regen" } })).status).toBe(200);
    expect((await pushesFor(mona)).map((p) => p.url)).toEqual([`/termine/${id}`]);
  });

  it("without attendance can be switched later; stored responses count again when switched off; only special events", async () => {
    const id = (await special({})).body.id as number;
    await api(`/events/${id}/responses`, { cookie: monaCookie, body: { personId: kim, status: "no", reason: "Schule" } });
    expect((await patch(id, { noAttendance: true })).status).toBe(200);
    expect((await api(`/events/${id}`, { cookie: coachCookie })).body).toMatchObject({ noAttendance: true, counts: null });
    expect((await patch(id, { noAttendance: false })).status).toBe(200);
    expect((await api(`/events/${id}`, { cookie: coachCookie })).body.participants).toEqual([expect.objectContaining({ status: "no", reason: "Schule" })]);

    const date = addDays(todayLocal(), 2);
    const training = (await one<{ id: number }>("INSERT INTO events (kind, starts_at) VALUES ('training', ?) RETURNING id", `${date}T18:00`)).id;
    await exec("INSERT INTO event_teams (event_id, team_id) VALUES (?, ?)", training, wd);
    expect((await patch(training, { noAttendance: true })).body.error.code).toBe("not_special");
    expect(await rows("SELECT no_attendance, optional_attendance, family_attendance FROM events WHERE id = ?", training)).toEqual([
      { no_attendance: 0, optional_attendance: 0, family_attendance: 0 },
    ]);
  });

  it("optional attendance: nobody counts as accepted; join and withdraw without a reason; no reminder", async () => {
    const res = await special({ optionalAttendance: true });
    expect(res.status).toBe(201);
    const id = res.body.id as number;
    // The parent reads the child's name
    expect(await pushesFor(mona)).toEqual([expect.objectContaining({ body: expect.stringContaining("Wenn Kim mitmachen möchte, sag bitte zu.") })]);
    const ev = (await api("/events", { cookie: monaCookie })).body.events.find((e: any) => e.id === id);
    expect(ev).toMatchObject({ optionalAttendance: true, noAttendance: false });
    expect(ev.mine[0]).toMatchObject({ participant: true, optional: true, status: "open", canAccept: true });
    expect(isRelevantEvent(ev)).toBe(true);
    expect((await api(`/events/${id}`, { cookie: coachCookie })).body.counts).toMatchObject({ yes: 0, optional: 1 });

    expect((await api(`/events/${id}/responses`, { cookie: monaCookie, body: { personId: kim, status: "yes" } })).status).toBe(200);
    expect((await api(`/events/${id}`, { cookie: coachCookie })).body.counts).toMatchObject({ yes: 1, optional: 0 });
    expect((await api(`/events/${id}/responses`, { cookie: monaCookie, body: { personId: kim, status: "no" } })).status).toBe(200);
    expect(await rows("SELECT status, is_late FROM responses WHERE event_id = ? AND person_id = ?", id, kim)).toEqual([{ status: "no", is_late: 0 }]);

    await exec("DELETE FROM responses WHERE event_id = ?", id);
    await exec("UPDATE events SET decline_hours = 30 WHERE id = ?", id);
    pushes.length = 0;
    await sendDeadlineReminders(env, localToInstant(`${todayLocal()}T08:00`));
    expect(pushes).toEqual([]);
  });

  it("optional attendance: organisers without coach rights see who said yes as “First L.”, never the reasons; parents do not", async () => {
    const id = (await special({ optionalAttendance: true })).body.id as number;
    await api(`/events/${id}/responses`, { cookie: monaCookie, body: { personId: kim, status: "yes" } });
    const olga = await person("Olga", { lastName: "Stein" });
    await member(olga, wd);
    await exec("INSERT INTO event_organizers (event_id, person_id) VALUES (?, ?)", id, olga);
    const organizer = (await api(`/events/${id}`, { cookie: await loginAs(olga) })).body;
    expect(organizer).toMatchObject({ optionalYes: ["Kim K."], participants: null, families: null });
    expect((await api(`/events/${id}`, { cookie: monaCookie })).body.optionalYes).toBeNull();
    // Coaches see the participants anyway
    expect((await api(`/events/${id}`, { cookie: coachCookie })).body.optionalYes).toBeNull();
  });

  it("at most one mode: two at once answer 400 attendance_conflict, turning one on turns the others off", async () => {
    expect((await special({ optionalAttendance: true, noAttendance: true })).body.error.code).toBe("attendance_conflict");
    expect((await special({ familyAttendance: true, noAttendance: true })).status).toBe(400);
    const id = (await special({ noAttendance: true })).body.id as number;
    const modes = () => one("SELECT no_attendance, optional_attendance, family_attendance FROM events WHERE id = ?", id);
    expect((await patch(id, { optionalAttendance: true })).status).toBe(200);
    expect(await modes()).toEqual({ no_attendance: 0, optional_attendance: 1, family_attendance: 0 });
    expect((await patch(id, { familyAttendance: true })).status).toBe(200);
    expect(await modes()).toEqual({ no_attendance: 0, optional_attendance: 0, family_attendance: 1 });
    expect((await patch(id, { noAttendance: true, optionalAttendance: true })).body.error.code).toBe("attendance_conflict");
    expect((await patch(id, { noAttendance: true, familyAttendance: true })).body.error.code).toBe("attendance_conflict");
    expect(await modes()).toEqual({ no_attendance: 0, optional_attendance: 0, family_attendance: 1 });
    // A title alone keeps the mode
    expect((await patch(id, { title: "Herbstfest" })).status).toBe(200);
    expect(await modes()).toEqual({ no_attendance: 0, optional_attendance: 0, family_attendance: 1 });
    // All off: accepted again until declining
    await patch(id, { familyAttendance: false });
    expect((await api("/events", { cookie: monaCookie })).body.events.find((e: any) => e.id === id).mine[0]).toMatchObject({ optional: false, status: "yes" });
  });
});

describe("registration per family", () => {
  let kim: number;
  let lea: number;
  let tom: number;
  let ada: number;
  let olga: number;
  let mona: number;
  let paul: number;
  let nina: number;
  let ben: number;

  beforeEach(async () => {
    kim = await person("Kim", { lastName: "Kraus", birthYear: 2014 });
    lea = await person("Lea", { lastName: "Kraus", birthYear: 2015 });
    tom = await person("Tom", { lastName: "Berg", birthYear: 2014 });
    ben = await person("Ben", { lastName: "Wolf", birthYear: 2014 });
    ada = await person("Ada", { lastName: "Stein" });
    olga = await person("Olga", { lastName: "Lind" });
    mona = await person("Mona", { lastName: "Kraus" });
    paul = await person("Paul", { lastName: "Berg" });
    nina = await person("Nina", { lastName: "Wolf" });
    for (const p of [kim, lea, tom, ben, ada, olga]) await member(p, wd);
    // Patchwork: Mona is the mother of Kim and Lea, Paul the father of Lea and Tom; all five are one family
    await guardian(mona, kim);
    await guardian(mona, lea);
    await guardian(paul, lea);
    await guardian(paul, tom);
    await guardian(nina, ben);
  });

  it("one number per family; any member changes it; coaches and organisers see the overview, other parents do not", async () => {
    const res = await special({ familyAttendance: true });
    expect(res.status).toBe(201);
    const id = res.body.id as number;
    const monaCookie = await loginAs(mona);
    const paulCookie = await loginAs(paul);
    const ev = (await api(`/events/${id}`, { cookie: monaCookie })).body;
    expect(ev).toMatchObject({ familyAttendance: true, optionalAttendance: false, noAttendance: false, families: null, participants: null, counts: null });
    expect(ev.myFamily).toEqual({ label: "Kim K., Lea K., Tom B., Mona K. und Paul B.", members: 5, count: null, updatedBy: null, updatedAt: null });

    // Mona registers 4, Paul changes to 5: one entry for the whole family
    expect((await api(`/events/${id}/family`, { method: "PUT", cookie: monaCookie, body: { count: 4 } })).body.myFamily).toMatchObject({ count: 4, updatedBy: "Mona K." });
    expect((await api(`/events/${id}`, { cookie: paulCookie })).body.myFamily.count).toBe(4);
    await api(`/events/${id}/family`, { method: "PUT", cookie: paulCookie, body: { count: 5 } });
    expect((await api(`/events/${id}`, { cookie: monaCookie })).body.myFamily).toMatchObject({ count: 5, updatedBy: "Paul B." });
    expect(await rows("SELECT count FROM event_family_responses WHERE event_id = ?", id)).toEqual([{ count: 5 }]);

    // Without links: a unit of one's own; Nina says not coming; a child registers its family itself
    await api(`/events/${id}/family`, { method: "PUT", cookie: await loginAs(ada), body: { count: 2 } });
    expect((await api(`/events/${id}`, { cookie: await loginAs(ada) })).body.myFamily).toMatchObject({ label: "Ada S.", members: 1, count: 2 });
    await api(`/events/${id}/family`, { method: "PUT", cookie: await loginAs(nina), body: { count: 0 } });
    expect((await api(`/events/${id}/family`, { method: "PUT", cookie: monaCookie, body: { count: 31 } })).status).toBe(400);
    expect((await api(`/events/${id}/family`, { method: "PUT", cookie: await loginAs(kim), body: { count: 5 } })).status).toBe(200);

    // No yes/no per person
    expect((await api(`/events/${id}/responses`, { cookie: monaCookie, body: { personId: kim, status: "no", reason: "krank" } })).body.error.code).toBe("family_attendance");

    // Coach: overview, and the participants' status follows their family
    const coachView = (await api(`/events/${id}`, { cookie: coachCookie })).body;
    expect(coachView.families).toEqual({
      persons: 7,
      registered: 2,
      declined: 1,
      open: 1,
      units: [
        { label: "Kim K., Lea K., Tom B., Mona K. und Paul B.", count: 5 },
        { label: "Ada S.", count: 2 },
      ],
    });
    const status = (pid: number) => coachView.participants.find((p: any) => p.person.id === pid).status;
    expect([status(kim), status(ada), status(olga)]).toEqual(["yes", "yes", "open"]);

    // Organiser without coach rights sees the overview; other parents do not
    await exec("INSERT INTO event_organizers (event_id, person_id) VALUES (?, ?)", id, olga);
    expect((await api(`/events/${id}`, { cookie: await loginAs(olga) })).body.families).toMatchObject({ persons: 7, registered: 2 });
    expect((await api(`/events/${id}`, { cookie: await loginAs(nina) })).body.families).toBeNull();
  });

  it("who cannot register: strangers, coaches without a family, children their parents restrict, parents not in charge", async () => {
    const id = (await special({ familyAttendance: true })).body.id as number;
    const put = async (personId: number, count = 1) => api(`/events/${id}/family`, { method: "PUT", cookie: await loginAs(personId), body: { count } });
    expect((await put(await person("Fritzi"))).status).toBe(404);
    expect((await api(`/events/${id}/family`, { method: "PUT", cookie: coachCookie, body: { count: 1 } })).status).toBe(403);
    // Lea may not accept herself: her parents register
    await exec("INSERT INTO child_permissions (child_id, may_accept) VALUES (?, 0)", lea);
    expect((await put(lea)).body.error.code).toBe("parents_handle_it");
    expect((await put(mona)).status).toBe(200);
    // Without parents in the team, Nina is not part of Ben's family (and does not see the event)
    await exec("UPDATE teams SET parents_enabled = 0 WHERE id = ?", wd);
    expect((await put(nina)).status).toBe(404);
    expect((await api(`/events/${id}`, { cookie: await loginAs(ben) })).body.myFamily).toMatchObject({ label: "Ben W.", members: 1 });
    // Not a family event
    await patch(id, { noAttendance: true });
    expect((await put(ada)).body.error.code).toBe("not_family_attendance");
  });

  it("switching an existing event: earlier responses no longer count, everyone invited is told once; switching back restores them", async () => {
    const id = (await special({})).body.id as number;
    const monaCookie = await loginAs(mona);
    expect((await api(`/events/${id}/responses`, { cookie: monaCookie, body: { personId: kim, status: "no", reason: "krank" } })).status).toBe(200);
    await exec("INSERT INTO push_subscriptions (account_id, endpoint, p256dh, auth) SELECT id, 'https://push.example/' || id, 'k', 'a' FROM accounts");
    pushes.length = 0;
    expect((await patch(id, { familyAttendance: true })).status).toBe(200);
    expect(await pushesFor(mona)).toEqual([
      expect.objectContaining({ title: "Anmeldung je Familie: Sommerfest", body: expect.stringContaining("Bisherige Zusagen zählen nicht mehr."), url: `/termine/${id}` }),
    ]);
    expect(await pushesFor(coach)).toEqual([]);
    expect((await api(`/events/${id}`, { cookie: monaCookie })).body.myFamily.count).toBeNull();
    // Saving again (already per family): no second push
    pushes.length = 0;
    await patch(id, { familyAttendance: true, title: "Sommerfest" });
    expect(pushes).toEqual([]);
    // Back to yes/no: the old decline counts again
    await patch(id, { familyAttendance: false });
    const back = (await api(`/events/${id}`, { cookie: coachCookie })).body.participants.find((p: any) => p.person.id === kim);
    expect(back).toMatchObject({ status: "no", reason: "krank" });
  });
});

describe("migration 202611200300_core_special-event-attendance.sql", () => {
  it("existing special events keep yes/no per person; family answers can be stored", async () => {
    await upgradeFrom("202611200300_core_special-event-attendance.sql");
    const { id } = await one<{ id: number }>("INSERT INTO events (kind, title, starts_at) VALUES ('special', 'Sommerfest', '2026-12-01T16:00') RETURNING id");
    const p = (await one<{ id: number }>("INSERT INTO persons (first_name, last_name) VALUES ('Kim', 'Kraus') RETURNING id")).id;
    await migrateRest();
    expect(await one("SELECT no_attendance, optional_attendance, family_attendance FROM events WHERE id = ?", id)).toEqual({
      no_attendance: 0,
      optional_attendance: 0,
      family_attendance: 0,
    });
    await exec("INSERT INTO event_family_responses (event_id, anchor_id, count, updated_by, updated_at) VALUES (?, ?, 3, ?, '2026-11-20T10:00:00Z')", id, p, p);
    await exec("DELETE FROM events WHERE id = ?", id);
    expect(await rows("SELECT * FROM event_family_responses")).toEqual([]);
  });
});
