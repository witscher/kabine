// Helferplan-Benachrichtigungen: Erinnerungen, Helfer gesucht, offene Plätze, Kanäle. Namen erfunden.
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureEventDuties } from "../worker/domain/duties";
import { sendDutyNotifications } from "../worker/domain/duty-notify";
import { type MailMessage, mailer } from "../worker/domain/email-login";
import type { PushJob } from "../worker/domain/notify";
import { addDays, localToInstant, todayLocal } from "../worker/lib/time";
import { exec, freshDb, guardian, loginAs, member, one, person, rows, season, team } from "./helpers";

let mails: MailMessage[] = [];
let pushes: PushJob[] = [];
const testEnv = () =>
  ({
    ...env,
    MAIL_FROM: "no-reply@example.org",
    PUSH_QUEUE: { sendBatch: async (jobs: { body: PushJob }[]) => void pushes.push(...jobs.map((j) => j.body)) },
  }) as unknown as Env;

/** 9 Uhr Berliner Zeit heute */
const nine = () => localToInstant(`${todayLocal()}T09:00`);

let wd: number;
let coach: number;
let kim: number;
let mona: number;
let max: number;

async function game(days: number, isHome = 1) {
  const row = await one<{ id: number }>(
    "INSERT INTO events (kind, starts_at, is_home, home_team, guest_team) VALUES ('game', ?, ?, 'SV Musterstadt', 'SG Gegner') RETURNING id",
    `${addDays(todayLocal(), days)}T14:00`,
    isHome,
  );
  await exec("INSERT INTO event_teams (event_id, team_id) VALUES (?, ?)", row.id, wd);
  return row.id;
}

/** Eintrag in den Block einer Dienstart (Blöcke vorher aus der Vorlage erzeugen). */
async function entry(eventId: number, code: string, personId: number, childId: number | null) {
  await ensureEventDuties(env.DB, [eventId], "2000-01-01");
  await exec(
    `INSERT INTO duties (event_id, event_duty_id, duty_type_id, person_id, child_id)
     SELECT ed.event_id, ed.id, ed.duty_type_id, ?, ? FROM event_duties ed JOIN duty_types dt ON dt.id = ed.duty_type_id
      WHERE ed.event_id = ? AND dt.code = ? LIMIT 1`,
    personId,
    childId,
    eventId,
    code,
  );
}

async function withDevice(personId: number) {
  await loginAs(personId);
  const { id } = await one<{ id: number }>("SELECT id FROM accounts WHERE person_id = ?", personId);
  await exec("INSERT INTO push_subscriptions (account_id, endpoint, p256dh, auth) VALUES (?, ?, 'x', 'y')", id, `https://push.example/${id}`);
  await exec("UPDATE accounts SET email = ?, email_verified_at = '2026-01-01T00:00:00Z' WHERE id = ?", `p${personId}@example.org`, id);
  return id;
}

beforeEach(async () => {
  await freshDb();
  await season();
  mails = [];
  pushes = [];
  vi.spyOn(mailer, "send").mockImplementation(async (_env, msg) => void mails.push(msg));
  wd = await team("wD", "wD");
  await exec("UPDATE teams SET helper_plan = 1 WHERE id = ?", wd);
  coach = await person("Tara");
  kim = await person("Kim");
  const kai = await person("Kai");
  mona = await person("Mona", { lastName: "Kaiser" });
  max = await person("Max", { lastName: "Muster" });
  await member(coach, wd, "coach");
  await member(kim, wd);
  await member(kai, wd);
  await guardian(mona, kim);
  await guardian(max, kai);
});

afterEach(() => vi.restoreAllMocks());

describe("Helferplan-Benachrichtigungen", () => {
  it("erinnert Eingetragene 3 und 1 Tag vorher, genau einmal, nach gewähltem Kanal", async () => {
    const monaAccount = await withDevice(mona);
    const in3 = await game(3);
    const in1 = await game(1);
    await entry(in3, "kuchen", mona, kim);
    await entry(in1, "trikots", mona, kim);
    // 1 Tag vorher zusätzlich per Mail
    await exec("INSERT INTO notification_channels (account_id, topic, push, mail) VALUES (?, 'duty_remind_1d', 1, 1)", monaAccount);

    // Vor 8 Uhr passiert nichts
    expect(await sendDutyNotifications(testEnv(), localToInstant(`${todayLocal()}T06:00`))).toBe(0);

    await sendDutyNotifications(testEnv(), nine());
    const reminders = pushes.filter((p) => p.payload.title.startsWith("Dein Helferdienst"));
    expect(reminders.map((p) => p.payload.title).sort()).toEqual(["Dein Helferdienst in 3 Tagen", "Dein Helferdienst morgen"]);
    expect(reminders.every((p) => p.accountIds.includes(monaAccount))).toBe(true);
    expect(mails).toHaveLength(1);
    expect(mails[0]).toMatchObject({ to: `p${mona}@example.org`, subject: "Erinnerung: Trikots waschen morgen", fromName: "Kabine Helferplan" });
    expect(mails[0]!.text).toContain("(für Kim)");

    pushes = [];
    mails = [];
    await sendDutyNotifications(testEnv(), nine() + 3_600_000);
    expect(pushes.filter((p) => p.payload.title.startsWith("Dein Helferdienst"))).toEqual([]);
    expect(mails).toEqual([]);
  });

  it("Helfer gesucht nur an passende Eltern, offene Plätze an Trainer und Admins", async () => {
    const monaAccount = await withDevice(mona);
    const maxAccount = await withDevice(max);
    const coachAccount = await withDevice(coach);
    const admin = await person("Ada", { admin: true });
    const adminAccount = await withDevice(admin);
    const in3 = await game(3);
    // Mona hat schon einen Dienst, Max hat Zeitnehmer nicht unter „Das kann ich“
    await entry(in3, "kuchen", mona, kim);

    await sendDutyNotifications(testEnv(), nine());
    const wanted = pushes.filter((p) => p.payload.title === "Helfer gesucht · wD");
    expect(wanted.flatMap((p) => p.accountIds)).toEqual([maxAccount]);
    expect(wanted[0]!.payload.body).toContain("Noch frei: Kuchen & Theke, Trikots waschen");
    expect(wanted[0]!.payload.body).not.toContain("Zeitnehmer");
    expect(wanted.flatMap((p) => p.accountIds)).not.toContain(monaAccount);

    // 5 Tage vorher: Trainer und Admin (ohne eigenen Bezug, also alle Mannschaften)
    pushes = [];
    await game(5);
    await sendDutyNotifications(testEnv(), nine() + 7_200_000);
    const coachMsgs = pushes.filter((p) => p.payload.title === "Noch offene Helferplätze · wD");
    expect(coachMsgs.flatMap((p) => p.accountIds).sort()).toEqual([coachAccount, adminAccount].sort());
    expect(await rows("SELECT kind FROM duty_notifications WHERE kind LIKE 'coach%'")).toHaveLength(2);
  });

  it("Admin, die nur Trainerin von Mannschaften ohne Helferplan ist, bekommt keine offenen Plätze anderer Mannschaften", async () => {
    const coachAccount = await withDevice(coach);
    const other = await team("mC", "wC");
    const admin = await person("Sina", { admin: true });
    await member(admin, other, "coach");
    const adminAccount = await withDevice(admin);
    await game(5);
    await sendDutyNotifications(testEnv(), nine());
    const coachMsgs = pushes.filter((p) => p.payload.title === "Noch offene Helferplätze · wD");
    expect(coachMsgs.flatMap((p) => p.accountIds)).toEqual([coachAccount]);
    expect(coachMsgs.flatMap((p) => p.accountIds)).not.toContain(adminAccount);
  });

  it("Zeitnehmer mit Vorkenntnissen: Helfer gesucht nur an Eltern mit Freigabe", async () => {
    const maxAccount = await withDevice(max);
    const monaAccount = await withDevice(mona);
    await exec("INSERT INTO skill_consents (account_id, duty_type_id) SELECT ?, id FROM duty_types WHERE code = 'zeitnehmer'", monaAccount);
    const in3 = await game(3);
    await entry(in3, "kuchen", coach, null);
    await entry(in3, "kuchen", await person("Helga"), null);
    await entry(in3, "trikots", coach, null);
    await sendDutyNotifications(testEnv(), nine());
    const wanted = pushes.filter((p) => p.payload.title === "Helfer gesucht · wD");
    // Nur noch Zeitnehmer frei: Mona (mit Freigabe) ja, Max nicht
    expect(wanted.flatMap((p) => p.accountIds)).toEqual([monaAccount]);
    expect(wanted[0]!.payload.body).toContain("Noch frei: Zeitnehmer");
    expect(maxAccount).toBeGreaterThan(0);
  });

  it("Sondertermin mit Zeitblöcken: Erinnerung mit Dienstname", async () => {
    const monaAccount = await withDevice(mona);
    const row = await one<{ id: number }>("INSERT INTO events (kind, title, starts_at, ends_at) VALUES ('special', 'Saisonabschluss', ?, ?) RETURNING id", `${addDays(todayLocal(), 1)}T15:00`, `${addDays(todayLocal(), 1)}T19:00`);
    await exec("INSERT INTO event_teams (event_id, team_id) VALUES (?, ?)", row.id, wd);
    const t = await one<{ id: number }>("INSERT INTO duty_types (name, event_id) VALUES ('Grill', ?) RETURNING id", row.id);
    const b = await one<{ id: number }>("INSERT INTO event_duties (event_id, duty_type_id, starts_at, ends_at, slots) VALUES (?, ?, ?, ?, 2) RETURNING id", row.id, t.id, `${addDays(todayLocal(), 1)}T15:00`, `${addDays(todayLocal(), 1)}T17:00`);
    await exec("INSERT INTO duties (event_id, event_duty_id, duty_type_id, person_id, child_id) VALUES (?, ?, ?, ?, ?)", row.id, b.id, t.id, mona, kim);
    await sendDutyNotifications(testEnv(), nine());
    const reminder = pushes.find((p) => p.payload.title === "Dein Helferdienst morgen");
    expect(reminder?.accountIds).toEqual([monaAccount]);
    expect(reminder?.payload.body).toContain("Grill (für Kim)");
  });

  it("ohne Helferplan, abgesagt oder ausgeblendet: keine Benachrichtigung", async () => {
    await withDevice(max);
    const hidden = await game(3);
    await exec("UPDATE events SET duty_hidden = 1 WHERE id = ?", hidden);
    await sendDutyNotifications(testEnv(), nine());
    expect(pushes).toEqual([]);
    await exec("UPDATE teams SET helper_plan = 0");
    await exec("UPDATE events SET duty_hidden = 0");
    await sendDutyNotifications(testEnv(), nine());
    expect(pushes).toEqual([]);
  });
});
