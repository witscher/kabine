import { t } from "@lingui/core/macro";
import { appOrigin, enterClubContext } from "./domain/club";
import { recordAttendance } from "./domain/attendance";
import { sendCarpoolChatReminders } from "./domain/carpool";
import { syncAutoSquads } from "./domain/auto-squad";
import { sendDutyNotifications } from "./domain/duty-notify";
import { deadlineInstant, type EventRow, EVENT_SELECT, eventTeams, eventTitle, loadEventContext } from "./domain/events";
import { ensureGenerated } from "./domain/generate";
import { syncAutoGroups } from "./domain/groups";
import { notifyCoaches, notifyPersons, shortDate, shortTime } from "./domain/notify";
import { all, run } from "./lib/db";
import { maintenanceState } from "./lib/maintenance";
import { addDays, addMinutesLocal, localToInstant, nowLocal, todayLocal, toLocal, utcIso } from "./lib/time";

/** Reasons for declines are deleted 60 days after the event. */
export const REASON_RETENTION_DAYS = 60;
const REMIND_BEFORE_DEADLINE_MS = 24 * 3_600_000;
/** This many days before a game the nominees are reminded. */
export const GAME_REMINDER_DAYS = 3;

/** Hourly run. What is due depends on the Berlin time. */
export async function handleScheduled(baseEnv: Env, scheduledTime: number): Promise<void> {
  // Links in e-mails and push messages need the app address; without ORIGIN the one the app was last opened at
  const env = { ...baseEnv, ORIGIN: await appOrigin(baseEnv) } as Env;
  await enterClubContext(env.DB);
  // Maintenance: generate or send nothing; the next run afterwards catches up
  if (await maintenanceState(env.KV)) {
    console.log("Maintenance mode active, cron run skipped");
    return;
  }
  const tasks: [string, () => Promise<unknown>][] = [
    ["Generate events", () => ensureGenerated(env.DB, scheduledTime)],
    ["Automatic squads", () => syncAutoSquads(env.DB, null, scheduledTime)],
    ["Reminders", () => sendDeadlineReminders(env, scheduledTime)],
    ["Game reminders", () => sendGameReminders(env, scheduledTime)],
    ["Helper plan", () => sendDutyNotifications(env, scheduledTime)],
    ["Attendance", () => recordAttendance(env.DB, scheduledTime)],
    ["Meeting point", () => sendMeetingReminders(env, scheduledTime)],
    ["Carpools", () => sendCarpoolChatReminders(env, scheduledTime)],
  ];
  const hour = Number(toLocal(scheduledTime).slice(11, 13));
  if (hour === 3) tasks.push(["Cleanup", () => cleanup(env.DB, scheduledTime)]);
  // Safety net: the KiHaSL/JuHaSL group follows role and admins (otherwise synced on every change)
  if (hour === 3) tasks.push(["Groups", () => syncAutoGroups(env.DB)]);
  for (const [name, task] of tasks) {
    try {
      await task();
    } catch (err) {
      console.error(`Cron: ${name} failed`, err);
    }
  }
}

/** Reminder 24 hours before the decline deadline to everyone without a response. */
export async function sendDeadlineReminders(env: Env, now = Date.now()): Promise<number> {
  const nowL = nowLocal(now);
  const events = await all<EventRow>(
    env.DB,
    `${EVENT_SELECT} WHERE e.cancelled_at IS NULL AND e.reminder_sent_at IS NULL AND e.starts_at > ? AND e.starts_at < ?
       AND (e.kind <> 'game' OR e.squad_published_at IS NOT NULL)`,
    nowL,
    addMinutesLocal(nowL, 9 * 24 * 60),
  );
  if (!events.length) return 0;
  const ctx = await loadEventContext(env.DB, events);
  let sent = 0;
  for (const e of events) {
    const deadline = deadlineInstant(e, eventTeams(e, ctx));
    if (deadline <= now || deadline - now > REMIND_BEFORE_DEADLINE_MS) continue;
    const open = (ctx.participants.get(e.id) ?? []).filter((p) => p.status === "open").map((p) => p.person.id);
    const teams = eventTeams(e, ctx).map((tm) => ({ id: tm.id, name: tm.name }));
    if (open.length) {
      const deadlineLocal = toLocal(deadline);
      sent += await notifyPersons(
        env,
        open,
        "reminders",
        () => {
          const label = e.kind === "training" ? t`Training` : eventTitle(e, teams);
          const date = shortDate(e.starts_at);
          const time = shortTime(e.starts_at);
          const untilDate = shortDate(deadlineLocal);
          const untilTime = deadlineLocal.slice(11);
          return {
            title: t`Are you coming?`,
            body: t`${label} on ${date}, ${time}. You can still decline until ${untilDate}, ${untilTime}.`,
            url: `/termine/${e.id}`,
            tag: `remind-${e.id}`,
          };
        },
        { teamIds: teams.map((tm) => tm.id) },
      );
    }
    await run(env.DB, "UPDATE events SET reminder_sent_at = ? WHERE id = ?", utcIso(now), e.id);
  }
  return sent;
}

/**
 * Reminder to all nominees who have not declined, a few days before the
 * game. For automatic squads it replaces the nomination push. If a squad was
 * only just published by hand (push already sent), the reminder waits 24 hours.
 */
export async function sendGameReminders(env: Env, now = Date.now()): Promise<number> {
  const nowL = nowLocal(now);
  const events = await all<EventRow>(
    env.DB,
    `${EVENT_SELECT} WHERE e.kind = 'game' AND e.cancelled_at IS NULL AND e.game_reminder_sent_at IS NULL
       AND e.squad_published_at IS NOT NULL AND e.starts_at > ? AND e.starts_at <= ?
       AND (e.squad_manual = 0 OR e.squad_published_at < ?)`,
    nowL,
    addMinutesLocal(nowL, GAME_REMINDER_DAYS * 24 * 60),
    utcIso(now - 24 * 3_600_000),
  );
  if (!events.length) return 0;
  const ctx = await loadEventContext(env.DB, events);
  events.sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  // Whoever is in the squad of two teams at the same time (±3 hours) gets only one reminder
  const remindedAt = new Map<number, string[]>();
  const overlaps = (a: string, b: string) => Math.abs(localToInstant(a) - localToInstant(b)) < 3 * 3_600_000;
  let sent = 0;
  for (const e of events) {
    const teams = eventTeams(e, ctx).map((tm) => ({ id: tm.id, name: tm.name }));
    const persons = (ctx.participants.get(e.id) ?? [])
      .filter((p) => p.status === "yes" || p.status === "open")
      .map((p) => p.person.id)
      .filter((id) => !(remindedAt.get(id) ?? []).some((at) => overlaps(at, e.starts_at)));
    for (const id of persons) remindedAt.set(id, [...(remindedAt.get(id) ?? []), e.starts_at]);
    if (persons.length) {
      sent += await notifyPersons(
        env,
        persons,
        "squad",
        () => {
          const title = eventTitle(e, teams);
          const date = shortDate(e.starts_at);
          const time = shortTime(e.starts_at);
          return {
            title: t`You are in the squad`,
            body: t`${title} on ${date}, ${time}. If you can't make it, please decline.`,
            url: `/termine/${e.id}`,
            tag: `game-${e.id}`,
          };
        },
        { teamIds: teams.map((tm) => tm.id) },
      );
    }
    await run(env.DB, "UPDATE events SET game_reminder_sent_at = ? WHERE id = ?", utcIso(now), e.id);
  }
  return sent;
}

export async function cleanup(db: D1Database, now = Date.now()): Promise<void> {
  const cutoff = `${addDays(todayLocal(now), -REASON_RETENTION_DAYS)}T00:00`;
  await db.batch([
    db.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(utcIso(now)),
    db.prepare("DELETE FROM invites WHERE expires_at < ?").bind(utcIso(now - 30 * 86_400_000)),
    db.prepare("DELETE FROM email_codes WHERE expires_at < ?").bind(utcIso(now - 86_400_000)),
    db.prepare("UPDATE responses SET reason = NULL WHERE reason IS NOT NULL AND event_id IN (SELECT id FROM events WHERE starts_at < ?)").bind(cutoff),
    db.prepare("DELETE FROM standing_absences WHERE valid_to IS NOT NULL AND valid_to < ?").bind(addDays(todayLocal(now), -1)),
  ]);
}

/** This many days before a game the app reminds the coaches of meeting point and time. */
export const MEETING_REMINDER_DAYS = 3;
const MEETING_REMINDER_HOUR = 8;

/**
 * Reminds coaches to enter meeting point and time before the game while the time is missing.
 * Once per game and team, from 8 am, for games in the next 3 days.
 */
export async function sendMeetingReminders(env: Env, now = Date.now()): Promise<number> {
  if (Number(toLocal(now).slice(11, 13)) < MEETING_REMINDER_HOUR) return 0;
  const today = todayLocal(now);
  const games = await all<{ id: number; starts_at: string; is_home: number | null; home_team: string | null; guest_team: string | null; title: string | null; team_id: number; team_name: string }>(
    env.DB,
    `SELECT e.id, e.starts_at, e.is_home, e.home_team, e.guest_team, e.title, t.id AS team_id, t.name AS team_name
       FROM events e JOIN event_teams et ON et.event_id = e.id JOIN teams t ON t.id = et.team_id
      WHERE e.kind = 'game' AND e.cancelled_at IS NULL AND e.meeting_time IS NULL
        AND e.starts_at > ? AND substr(e.starts_at, 1, 10) <= ?`,
    nowLocal(now),
    addDays(today, MEETING_REMINDER_DAYS),
  );
  let sent = 0;
  for (const g of games) {
    const claimed = await run(env.DB, "INSERT OR IGNORE INTO duty_notifications (kind, ref) VALUES ('meeting', ?)", `${g.id}:${g.team_id}`);
    if (!claimed.meta.changes) continue;
    const opponent = g.is_home === 1 ? g.guest_team : g.is_home === 0 ? g.home_team : (g.title ?? g.guest_team);
    const teamName = g.team_name;
    sent += await notifyCoaches(env, [g.team_id], () => {
      const date = shortDate(g.starts_at);
      const time = shortTime(g.starts_at);
      return {
        title: t`Enter meeting point · ${teamName}`,
        body: opponent
          ? t`Game against ${opponent} on ${date}, ${time}: please enter meeting point and time.`
          : t`Game on ${date}, ${time}: please enter meeting point and time.`,
        url: `/termine/${g.id}`,
        tag: `meeting-${g.id}`,
      };
    });
  }
  return sent;
}

