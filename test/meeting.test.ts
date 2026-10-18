// Erinnerung an Trainer: Treffpunkt und Uhrzeit vor dem Spiel eintragen. Namen erfunden.
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { sendMeetingReminders } from "../worker/cron";
import type { PushJob } from "../worker/domain/notify";
import { addDays, localToInstant, todayLocal } from "../worker/lib/time";
import { exec, freshDb, loginAs, member, one, person, season, team } from "./helpers";

let pushes: PushJob[] = [];
const testEnv = () =>
  ({ ...env, PUSH_QUEUE: { sendBatch: async (jobs: { body: PushJob }[]) => void pushes.push(...jobs.map((j) => j.body)) } }) as unknown as Env;
const at = (hour: string) => localToInstant(`${todayLocal()}T${hour}`);

let wd: number;
let coachAccount: number;

async function game(days: number, meetingTime: string | null = null) {
  const row = await one<{ id: number }>(
    "INSERT INTO events (kind, starts_at, is_home, home_team, guest_team, meeting_time) VALUES ('game', ?, 1, 'SV Musterstadt', 'SG Gegner', ?) RETURNING id",
    `${addDays(todayLocal(), days)}T14:00`,
    meetingTime,
  );
  await exec("INSERT INTO event_teams (event_id, team_id) VALUES (?, ?)", row.id, wd);
  return row.id;
}

beforeEach(async () => {
  await freshDb();
  await season();
  pushes = [];
  wd = await team("wD", "wD");
  const coach = await person("Tina");
  const player = await person("Mia", { birthYear: 2014 });
  await member(coach, wd, "coach");
  await member(player, wd);
  await loginAs(coach);
  await loginAs(player);
  coachAccount = (await one<{ id: number }>("SELECT id FROM accounts WHERE person_id = ?", coach)).id;
  const playerAccount = (await one<{ id: number }>("SELECT id FROM accounts WHERE person_id = ?", player)).id;
  for (const id of [coachAccount, playerAccount]) {
    await exec("INSERT INTO push_subscriptions (account_id, endpoint, p256dh, auth) VALUES (?, ?, 'x', 'y')", id, `https://push.example/${id}`);
  }
});

describe("Treffpunkt-Erinnerung", () => {
  it("3 Tage vorher an die Trainer, einmal, nur ohne Uhrzeit, ab 8 Uhr", async () => {
    const soon = await game(3);
    await game(2, "13:00"); // schon eingetragen
    await game(5); // noch zu weit weg
    expect(await sendMeetingReminders(testEnv(), at("07:30"))).toBe(0);
    await sendMeetingReminders(testEnv(), at("09:00"));
    expect(pushes).toHaveLength(1);
    expect(pushes[0]!.accountIds).toEqual([coachAccount]);
    expect(pushes[0]!.payload).toMatchObject({ title: "Treffpunkt eintragen · wD", url: `/termine/${soon}` });
    expect(pushes[0]!.payload.body).toContain("SG Gegner");
    // Nächster Lauf: keine zweite Erinnerung
    pushes = [];
    await sendMeetingReminders(testEnv(), at("10:00"));
    expect(pushes).toEqual([]);
  });
});
