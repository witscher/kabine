// Attendance after an event: present, excused, unexcused (shared/attendance.ts). Names invented.
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { recordAttendance } from "../worker/domain/attendance";
import { addDays } from "../worker/lib/time";
import { api, eventIn, exec, freshDb, guardian, loginAs, member, migrateRest, one, person, rows, season, team, upgradeFrom } from "./helpers";

let wd: number;
let coach: number;
let mia: number;
let ella: number;
let parent: number;
let yesterday: number;
let coachCookie: string;
let adminCookie: string;

const mark = (event: number, personId: number, value: string | null, cookie = coachCookie) =>
  api(`/events/${event}/attendance/${personId}`, { method: "PUT", cookie, body: { mark: value } });

async function decline(event: number, personId: number, isLate = 0) {
  await exec(
    "INSERT INTO responses (event_id, person_id, status, reason, is_late, responded_at) VALUES (?, ?, 'no', 'Schule', ?, '2026-01-01T00:00:00Z')",
    event,
    personId,
    isLate,
  );
}

const record = async (event: number) =>
  Object.fromEntries((await rows<{ person_id: number; status: string; is_late: number }>("SELECT person_id, status, is_late FROM attendance WHERE event_id = ?", event)).map((r) => [r.person_id, [r.status, r.is_late]]));

beforeEach(async () => {
  await freshDb();
  await season();
  wd = await team("wD", "wD");
  coach = await person("Tina");
  mia = await person("Mia", { birthYear: 2014 });
  ella = await person("Ella", { birthYear: 2014 });
  parent = await person("Paula");
  await member(coach, wd, "coach");
  await member(mia, wd);
  await member(ella, wd);
  await guardian(parent, mia);
  yesterday = await eventIn(wd, -1);
  coachCookie = await loginAs(coach);
  adminCookie = await loginAs(await person("Anna", { admin: true }));
});

describe("attendance", () => {
  it("the response decides until the coach records something else; an entry equal to it is not stored", async () => {
    await decline(yesterday, ella, 1);
    // Mia accepted (implicitly): present is the default and not stored
    expect((await mark(yesterday, mia, "present")).body).toEqual({ ok: true, attendance: null });
    // Ella declined late but came anyway
    expect((await mark(yesterday, ella, "present")).body).toEqual({ ok: true, attendance: "present" });
    expect(await rows("SELECT person_id, status, marked_by FROM attendance_marks")).toEqual([{ person_id: ella, status: "present", marked_by: coach }]);

    const detail = (await api(`/events/${yesterday}`, { cookie: coachCookie })).body;
    expect(detail.attendanceEditable).toBe(true);
    expect(detail.attendanceUntil).toBe(`${addDays(detail.startsAt.slice(0, 10), 1)}T23:59`);
    const byId = Object.fromEntries(detail.participants.map((p: { person: { id: number }; status: string; attendance: string | null }) => [p.person.id, [p.status, p.attendance]]));
    // The player's own response stays as it was
    expect(byId).toEqual({ [mia]: ["yes", null], [ella]: ["no", "present"] });

    // The record follows: present, and a late decline is not late if she came
    await recordAttendance(env.DB);
    expect(await record(yesterday)).toEqual({ [mia]: ["present", 0], [ella]: ["present", 0] });
    await mark(yesterday, mia, "excused");
    await mark(yesterday, ella, null);
    expect(await record(yesterday)).toEqual({ [mia]: ["declined", 0], [ella]: ["declined", 1] });
  });

  it("unexcused only without a decline; optional participants only present or not there", async () => {
    await decline(yesterday, ella);
    expect((await mark(yesterday, ella, "unexcused")).status).toBe(409);
    expect((await mark(yesterday, mia, "unexcused")).status).toBe(200);
    expect((await one("SELECT status FROM attendance_marks WHERE person_id = ?", mia))).toEqual({ status: "unexcused" });

    const other = await team("wD2", "wD", { level: 2 });
    const kim = await person("Kim", { birthYear: 2014 });
    await member(kim, other);
    const joint = await eventIn(wd, -1, { time: "10:00" });
    await exec("INSERT INTO event_teams (event_id, team_id, optional) VALUES (?, ?, 1)", joint, other);
    expect((await mark(joint, kim, "unexcused")).body.error.code).toBe("optional");
    expect((await mark(joint, kim, "present")).body.attendance).toBe("present");
    await recordAttendance(env.DB);
    expect((await record(joint))[kim]).toEqual(["present", 0]);
    // "Not there" is the default for an optional participant without acceptance: no row in the record
    expect((await mark(joint, kim, "excused")).body.attendance).toBeNull();
    expect((await record(joint))[kim]).toBeUndefined();
  });

  it("coaches until the end of the day after the event, admins the whole season; not before the start", async () => {
    const older = await eventIn(wd, -3);
    expect((await mark(older, mia, "unexcused")).body.error.code).toBe("attendance_closed");
    const forCoach = (await api(`/events/${older}`, { cookie: coachCookie })).body;
    expect(forCoach.attendanceEditable).toBe(false);
    const forAdmin = (await api(`/events/${older}`, { cookie: adminCookie })).body;
    expect(forAdmin).toMatchObject({ attendanceEditable: true, attendanceUntil: null });
    expect((await mark(older, mia, "unexcused", adminCookie)).status).toBe(200);

    const tomorrow = await eventIn(wd, 1);
    expect((await mark(tomorrow, mia, "present")).status).toBe(409);
    expect((await api(`/events/${tomorrow}`, { cookie: coachCookie })).body.attendanceEditable).toBe(false);
    // Players and parents cannot record
    expect((await mark(yesterday, mia, "present", await loginAs(mia))).status).toBe(403);
  });

  it("the player and their parents see their own entry, nobody else's", async () => {
    await decline(yesterday, mia);
    await mark(yesterday, mia, "present");
    for (const cookie of [await loginAs(mia), await loginAs(parent)]) {
      const detail = (await api(`/events/${yesterday}`, { cookie })).body;
      expect(detail.mine.find((m: { person: { id: number } }) => m.person.id === mia).attendance).toBe("present");
      expect(detail.participants).toBeNull();
    }
    const asElla = (await api(`/events/${yesterday}`, { cookie: await loginAs(ella) })).body;
    expect(asElla.mine.map((m: { attendance: string | null }) => m.attendance)).toEqual([null]);
  });
});

describe("migration 202610192200_core_attendance-marks.sql", () => {
  it("copies every unexcused mark with who and when, and keeps the old table for the previous release", async () => {
    await upgradeFrom("202610192200_core_attendance-marks.sql");
    const wd = await team("wD", "wD");
    const coach = await person("Tina");
    const mia = await person("Mia");
    await member(mia, wd);
    const event = await eventIn(wd, -5);
    await exec("INSERT INTO unexcused_absences (event_id, person_id, marked_by, marked_at) VALUES (?, ?, ?, '2026-10-01T19:30:00.000Z')", event, mia, coach);
    await migrateRest();
    expect(await rows("SELECT event_id, person_id, status, marked_by, marked_at FROM attendance_marks")).toEqual([
      { event_id: event, person_id: mia, status: "unexcused", marked_by: coach, marked_at: "2026-10-01T19:30:00.000Z" },
    ]);
    expect(await rows("SELECT person_id FROM unexcused_absences")).toEqual([{ person_id: mia }]);
  });
});
