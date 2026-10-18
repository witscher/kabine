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

/** Begründungen von Absagen werden 60 Tage nach dem Termin gelöscht. */
export const REASON_RETENTION_DAYS = 60;
const REMIND_BEFORE_DEADLINE_MS = 24 * 3_600_000;
/** So viele Tage vor einem Spiel werden die Nominierten erinnert. */
export const GAME_REMINDER_DAYS = 3;

/** Stündlicher Lauf. Was ansteht, hängt von der Berliner Uhrzeit ab. */
export async function handleScheduled(baseEnv: Env, scheduledTime: number): Promise<void> {
  // Links in e-mails and push messages need the app address; without ORIGIN the one the app was last opened at
  const env = { ...baseEnv, ORIGIN: await appOrigin(baseEnv) } as Env;
  await enterClubContext(env.DB);
  // Wartung: nichts erzeugen oder verschicken, der nächste Lauf danach holt alles nach
  if (await maintenanceState(env.KV)) {
    console.log("Wartungsmodus aktiv, Cron-Lauf ausgelassen");
    return;
  }
  const tasks: [string, () => Promise<unknown>][] = [
    ["Termine erzeugen", () => ensureGenerated(env.DB, scheduledTime)],
    ["Automatische Kader", () => syncAutoSquads(env.DB, null, scheduledTime)],
    ["Erinnerungen", () => sendDeadlineReminders(env, scheduledTime)],
    ["Spielerinnerungen", () => sendGameReminders(env, scheduledTime)],
    ["Helferplan", () => sendDutyNotifications(env, scheduledTime)],
    ["Anwesenheit", () => recordAttendance(env.DB, scheduledTime)],
    ["Treffpunkt", () => sendMeetingReminders(env, scheduledTime)],
    ["Fahrgemeinschaften", () => sendCarpoolChatReminders(env, scheduledTime)],
  ];
  const hour = Number(toLocal(scheduledTime).slice(11, 13));
  if (hour === 3) tasks.push(["Aufräumen", () => cleanup(env.DB, scheduledTime)]);
  // Sicherheitsnetz: KiHaSL/JuHaSL-Gruppe folgt Rolle und Admins (sonst bei jeder Änderung abgeglichen)
  if (hour === 3) tasks.push(["Gruppen", () => syncAutoGroups(env.DB)]);
  for (const [name, task] of tasks) {
    try {
      await task();
    } catch (err) {
      console.error(`Cron: ${name} fehlgeschlagen`, err);
    }
  }
}

/** Erinnerung 24 Stunden vor Ablauf der Absagefrist an alle ohne Rückmeldung. */
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
    const teams = eventTeams(e, ctx).map((t) => ({ id: t.id, name: t.name }));
    const label = e.kind === "training" ? "Training" : eventTitle(e, teams);
    if (open.length) {
      sent += await notifyPersons(
        env,
        open,
        "reminders",
        {
          title: "Bist du dabei?",
          body: `${label} am ${shortDate(e.starts_at)}, ${shortTime(e.starts_at)} Uhr. Absagen noch bis ${shortDate(toLocal(deadline))}, ${toLocal(deadline).slice(11)} Uhr.`,
          url: `/termine/${e.id}`,
          tag: `remind-${e.id}`,
        },
        { teamIds: teams.map((t) => t.id) },
      );
    }
    await run(env.DB, "UPDATE events SET reminder_sent_at = ? WHERE id = ?", utcIso(now), e.id);
  }
  return sent;
}

/**
 * Erinnerung an alle Nominierten, die nicht abgesagt haben, einige Tage vor
 * dem Spiel. Ersetzt bei automatischen Kadern die Push zur Nominierung. Wurde
 * ein Kader von Hand gerade erst veröffentlicht (Push schon verschickt),
 * wartet die Erinnerung 24 Stunden.
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
  // Wer in zwei Mannschaften zeitgleich (±3 Stunden) im Kader steht, bekommt nur eine Erinnerung
  const remindedAt = new Map<number, string[]>();
  const overlaps = (a: string, b: string) => Math.abs(localToInstant(a) - localToInstant(b)) < 3 * 3_600_000;
  let sent = 0;
  for (const e of events) {
    const teams = eventTeams(e, ctx).map((t) => ({ id: t.id, name: t.name }));
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
        {
          title: "Du bist im Kader",
          body: `${eventTitle(e, teams)} am ${shortDate(e.starts_at)}, ${shortTime(e.starts_at)} Uhr. Falls du nicht kannst, sag bitte ab.`,
          url: `/termine/${e.id}`,
          tag: `game-${e.id}`,
        },
        { teamIds: teams.map((t) => t.id) },
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

/** So viele Tage vor einem Spiel erinnert die App die Trainer an Treffpunkt und Uhrzeit. */
export const MEETING_REMINDER_DAYS = 3;
const MEETING_REMINDER_HOUR = 8;

/**
 * Trainer erinnern, Treffpunkt und Uhrzeit vor dem Spiel einzutragen, solange die Uhrzeit fehlt.
 * Einmal pro Spiel und Mannschaft, ab 8 Uhr, für Spiele in den nächsten 3 Tagen.
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
    sent += await notifyCoaches(env, [g.team_id], {
      title: `Treffpunkt eintragen · ${g.team_name}`,
      body: `Spiel${opponent ? ` gegen ${opponent}` : ""} am ${shortDate(g.starts_at)}, ${shortTime(g.starts_at)} Uhr: Bitte Treffpunkt und Uhrzeit eintragen.`,
      url: `/termine/${g.id}`,
      tag: `meeting-${g.id}`,
    });
  }
  return sent;
}

