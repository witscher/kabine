// Notifications of the helper plan (daily from 8 am, each only once):
// - reminder to those signed up 3 days and 1 day before the event (game or special event)
// - "helpers wanted" 3 days before to everyone in the team who has not signed up yet
//   and could take a free duty (who helps per duty type)
// - "open places" 5 and 2 days before to coaches and admins
// - "KiHaSL/JuHaSL wanted" 3 days before to everyone with this role (or their parents)
// Channel (push, mail) per account and topic, see notification_channels.
// Texts are built per recipient language: pushes once per language, mails per account (withLocale).
import { plural, t } from "@lingui/core/macro";
import { type DutyType, ensureEventDuties, loadAllDutyTypes, opponentOf } from "../../../worker/domain/duties";
import { mailer } from "../../../worker/domain/email-login";
import { enqueuePush, shortDate, shortTime } from "../../../worker/domain/notify";
import { all, list, run } from "../../../worker/lib/db";
import { isModuleOn, ownClubAbbr, ownClubShortName } from "../../../worker/domain/club";
import { withLocale } from "../../../worker/i18n";
import { sendText, textsOn } from "../../../worker/domain/texts";
import { addDays, todayLocal, toLocal } from "../../../worker/lib/time";

export type DutyTopic = "duty_remind_3d" | "duty_remind_1d" | "duty_open" | "duty_coach_open" | "duty_referee_open";

/** Without a setting: push on, mail off. */
const DEFAULT = { push: 1, mail: 0 };
/** Sending starts at this hour (Berlin). */
export const DUTY_NOTIFY_HOUR = 8;

interface GameRow {
  id: number;
  kind: "game" | "special";
  starts_at: string;
  is_home: number | null;
  home_team: string | null;
  guest_team: string | null;
  title: string | null;
  team_id: number;
  team_name: string;
  parents_enabled: number;
}

interface FreeBlock {
  type: DutyType;
  free: number;
}

/** Only once: true if this notification had not been sent yet. */
async function claim(db: D1Database, kind: string, ref: string): Promise<boolean> {
  const res = await run(db, "INSERT OR IGNORE INTO duty_notifications (kind, ref) VALUES (?, ?)", kind, ref);
  return (res.meta.changes ?? 0) > 0;
}

interface Message {
  title: string;
  body: string;
  url: string;
  tag: string;
  mailSubject: string;
  mailText: string;
}

/**
 * Sends per account by the chosen channel. Mail only to confirmed addresses.
 * msg builds the texts; it runs in the language of each recipient.
 */
async function deliver(env: Env, accountIds: number[], topic: DutyTopic, msg: () => Message): Promise<number> {
  if (!accountIds.length) return 0;
  const rows = await all<{
    id: number;
    email: string | null;
    verified: number;
    phone: string | null;
    phone_verified: number;
    push: number | null;
    mail: number | null;
    sms: number | null;
    locale: string | null;
  }>(
    env.DB,
    `SELECT a.id, a.email, a.email_verified_at IS NOT NULL AS verified, a.phone, a.phone_verified_at IS NOT NULL AS phone_verified,
            nc.push, nc.mail, nc.sms, a.locale
       FROM accounts a LEFT JOIN notification_channels nc ON nc.account_id = a.id AND nc.topic = ?
      WHERE a.id IN (SELECT value FROM json_each(?)) AND a.disabled_at IS NULL`,
    topic,
    list([...new Set(accountIds)]),
  );
  const push = rows.filter((r) => (r.push ?? DEFAULT.push) === 1).map((r) => r.id);
  const mail = rows.filter((r) => (r.mail ?? DEFAULT.mail) === 1 && r.email && r.verified === 1);
  const sms = textsOn() ? rows.filter((r) => r.sms === 1 && r.phone && r.phone_verified === 1) : [];
  let sent = 0;
  if (push.length) {
    sent += await enqueuePush(env, push, () => {
      const m = msg();
      return { title: m.title, body: m.body, url: m.url, tag: m.tag };
    });
  }
  for (const r of mail) {
    try {
      const { subject, text, name } = withLocale(r.locale, () => {
        const m = msg();
        const club = ownClubShortName();
        return { subject: m.mailSubject, text: m.mailText, name: t`${club} helper plan` };
      });
      await mailer.send(env, { to: r.email!, subject, text, fromName: name });
      sent++;
    } catch (err) {
      console.warn("Helper plan mail failed", err instanceof Error ? err.message : err);
    }
  }
  for (const r of sms) {
    try {
      const text = withLocale(r.locale, () => {
        const m = msg();
        return `${m.title}: ${m.body}`;
      });
      await sendText(env, r.phone!, text);
      sent++;
    } catch (err) {
      console.warn("Helper plan SMS failed", err instanceof Error ? err.message : err);
    }
  }
  return sent;
}

function appLink(env: Env, path: string): string {
  // ORIGIN is filled with the remembered app address at the start of the cron run (worker/cron.ts)
  return `${env.ORIGIN ?? ""}${path}`;
}

/** Mail text from paragraphs: greeting, content, footer. */
function mailText(...paragraphs: string[]): string {
  return [t`Hello,`, ...paragraphs, t`You can choose which notifications you get by push or mail in the app under Profile → Notifications.`].join("\n\n");
}

const GAME_COLUMNS = `e.id, e.kind, e.starts_at, e.is_home, e.home_team, e.guest_team, e.title, t.id AS team_id, t.name AS team_name, t.parents_enabled`;
const FIRST_TEAM = `JOIN teams t ON t.id = (SELECT et.team_id FROM event_teams et WHERE et.event_id = e.id ORDER BY et.team_id LIMIT 1)`;

/** Events with helper duties on a day: games with a helper plan (not hidden) and special events with blocks. */
async function gamesOn(db: D1Database, date: string): Promise<GameRow[]> {
  return all<GameRow>(
    db,
    `SELECT ${GAME_COLUMNS} FROM events e ${FIRST_TEAM}
      WHERE e.cancelled_at IS NULL AND substr(e.starts_at, 1, 10) = ?
        AND ((e.kind = 'game' AND e.duty_hidden = 0 AND t.helper_plan = 1) OR e.kind = 'special')
        AND EXISTS (SELECT 1 FROM event_duties ed JOIN duty_types dt ON dt.id = ed.duty_type_id AND dt.who_referees = 0 WHERE ed.event_id = e.id)`,
    date,
  );
}

/** Events with a KiHaSL/JuHaSL block on a day, regardless of the helper plan. */
async function refereeGamesOn(db: D1Database, date: string): Promise<GameRow[]> {
  return all<GameRow>(
    db,
    `SELECT ${GAME_COLUMNS} FROM events e ${FIRST_TEAM}
      WHERE e.cancelled_at IS NULL AND substr(e.starts_at, 1, 10) = ?
        AND EXISTS (SELECT 1 FROM event_duties ed JOIN duty_types dt ON dt.id = ed.duty_type_id AND dt.who_referees = 1 WHERE ed.event_id = e.id)`,
    date,
  );
}

/** Events with entries on a day (for reminders). */
async function gamesWithDutiesOn(db: D1Database, date: string): Promise<GameRow[]> {
  return all<GameRow>(
    db,
    `SELECT ${GAME_COLUMNS} FROM events e ${FIRST_TEAM}
      WHERE e.cancelled_at IS NULL AND substr(e.starts_at, 1, 10) = ? AND EXISTS (SELECT 1 FROM duties d WHERE d.event_id = e.id)`,
    date,
  );
}

/** Free places per block of an event (without KiHaSL/JuHaSL, those go through refereeWanted). */
async function freeBlocks(db: D1Database, g: GameRow, types: Map<number, DutyType>): Promise<FreeBlock[]> {
  const rows = await all<{ duty_type_id: number; free: number }>(
    db,
    `SELECT ed.duty_type_id, ed.slots - (SELECT count(*) FROM duties d WHERE d.event_duty_id = ed.id) AS free
       FROM event_duties ed WHERE ed.event_id = ? ORDER BY ed.starts_at, ed.sort, ed.id`,
    g.id,
  );
  const out: FreeBlock[] = [];
  for (const r of rows) {
    const type = types.get(r.duty_type_id);
    if (!type || type.whoReferees || r.free <= 0) continue;
    const same = out.find((x) => x.type.id === type.id);
    if (same) same.free += r.free;
    else out.push({ type, free: r.free });
  }
  return out;
}

/** "KiHaSL/JuHaSL wanted" to everyone with the role (or parents of a child with the role) who has not signed up yet. */
async function refereeWanted(env: Env, today: string): Promise<number> {
  const games = await refereeGamesOn(env.DB, addDays(today, 3));
  let sent = 0;
  for (const g of games) {
    const blocks = await all<{ slots: number; taken: number }>(
      env.DB,
      `SELECT sum(ed.slots) AS slots, (SELECT count(*) FROM duties d WHERE d.event_id = ?1 AND d.duty_type_id IN (SELECT id FROM duty_types WHERE who_referees = 1)) AS taken
         FROM event_duties ed JOIN duty_types dt ON dt.id = ed.duty_type_id AND dt.who_referees = 1 WHERE ed.event_id = ?1`,
      g.id,
    );
    const slots = blocks[0]?.slots ?? 0;
    const takenCount = blocks[0]?.taken ?? 0;
    if (takenCount >= slots) continue;
    const taken = await all<{ person_id: number | null; child_id: number | null }>(
      env.DB,
      "SELECT person_id, child_id FROM duties WHERE event_id = ? AND duty_type_id IN (SELECT id FROM duty_types WHERE who_referees = 1)",
      g.id,
    );
    const busy = new Set(taken.flatMap((t) => [t.person_id, t.child_id]).filter((x): x is number => x != null));
    const candidates = await all<{ account_id: number; person_id: number }>(
      env.DB,
      `SELECT a.id AS account_id, r.person_id FROM referees r JOIN accounts a ON a.person_id = r.person_id AND a.disabled_at IS NULL
       UNION
       SELECT a.id, r.person_id FROM referees r JOIN guardianships gu ON gu.child_id = r.person_id
         JOIN accounts a ON a.person_id = gu.guardian_id AND a.disabled_at IS NULL`,
    );
    const free = slots - takenCount;
    for (const c of candidates) {
      if (busy.has(c.person_id)) continue;
      if (!(await claim(env.DB, "refopen", `${g.id}:${c.account_id}`))) continue;
      const team = g.team_name;
      const link = appLink(env, "/helfer?kihasl");
      sent += await deliver(env, [c.account_id], "duty_referee_open", () => {
        const game = gameText(g);
        const opponent = opponentOf(g);
        return {
          title: t`KiHaSL/JuHaSL wanted · ${team}`,
          body: plural(free, { one: `${game}. # place still free.`, other: `${game}. # places still free.` }),
          url: "/helfer?kihasl",
          tag: `duty-referee-${g.id}`,
          mailSubject: t`KiHaSL/JuHaSL wanted: ${team} ${opponent}`,
          mailText: mailText(t`A KiHaSL/JuHaSL is still needed for the game ${game}.`, t`Sign up: ${link}`),
        };
      });
    }
  }
  return sent;
}

/** "K wD vs X on Fri 2 Oct at 14:00", in the current language. */
function gameText(g: GameRow): string {
  const club = ownClubAbbr();
  const team = g.team_name;
  const opponent = opponentOf(g);
  const date = shortDate(g.starts_at);
  const time = shortTime(g.starts_at);
  return t`${club} ${team} ${opponent} on ${date} at ${time}`;
}

function freeText(free: FreeBlock[]): string {
  return free.map((f) => (f.free > 1 ? `${f.type.name} (${f.free})` : f.type.name)).join(", ");
}

/** Reminder to those signed up. */
async function remind(env: Env, today: string, days: 3 | 1): Promise<number> {
  const games = await gamesWithDutiesOn(env.DB, addDays(today, days));
  let sent = 0;
  for (const g of games) {
    const entries = await all<{ id: number; label: string; child: string | null; account_id: number; via_parent: number }>(
      env.DB,
      // KiHaSL/JuHaSL children without their own access: reminder to the parents
      `SELECT d.id, dt.name AS label, CASE WHEN d.child_id = d.person_id THEN NULL ELSE ch.first_name END AS child, a.id AS account_id, 0 AS via_parent
         FROM duties d JOIN duty_types dt ON dt.id = d.duty_type_id JOIN accounts a ON a.person_id = d.person_id LEFT JOIN persons ch ON ch.id = d.child_id
        WHERE d.event_id = ?1
       UNION
       SELECT d.id, dt.name, ch.first_name, a.id, 1
         FROM duties d JOIN duty_types dt ON dt.id = d.duty_type_id AND dt.who_referees = 1
         JOIN persons ch ON ch.id = d.person_id JOIN guardianships gu ON gu.child_id = d.person_id
         JOIN accounts a ON a.person_id = gu.guardian_id
        WHERE d.event_id = ?1`,
      g.id,
    );
    for (const e of entries) {
      if (!(await claim(env.DB, `remind${days}`, e.via_parent ? `${e.id}:${e.account_id}` : String(e.id)))) continue;
      const label = e.label;
      const child = e.child;
      const link = appLink(env, "/helfer");
      sent += await deliver(env, [e.account_id], days === 3 ? "duty_remind_3d" : "duty_remind_1d", () => {
        const game = gameText(g);
        const what = child ? t`${label} (for ${child})` : label;
        return {
          title: days === 1 ? t`Your helper duty tomorrow` : t`Your helper duty in ${days} days`,
          body: `${what}: ${game}`,
          url: "/helfer",
          tag: `duty-${e.id}`,
          mailSubject: days === 1 ? t`Reminder: ${label} tomorrow` : t`Reminder: ${label} in ${days} days`,
          mailText: mailText(
            days === 1 ? t`You are signed up tomorrow at ${game}: ${what}.` : t`You are signed up in ${days} days at ${game}: ${what}.`,
            t`You can sign off or change your entry in the app: ${link}`,
          ),
        };
      });
    }
  }
  return sent;
}

/**
 * "Helpers wanted" to everyone in the team who has not signed up yet and could take a free
 * duty: who helps per duty type, skills only with consent.
 */
async function helpWanted(env: Env, today: string, types: Map<number, DutyType>): Promise<number> {
  const games = await gamesOn(env.DB, addDays(today, 3));
  let sent = 0;
  for (const g of games) {
    const free = await freeBlocks(env.DB, g, types);
    if (!free.length) continue;
    // parent: parent of a player (team with parents); player: the player; coach: coach
    const candidates = await all<{ account_id: number; person_id: number; role: "parent" | "player" | "coach" }>(
      env.DB,
      `SELECT DISTINCT a.id AS account_id, a.person_id, 'parent' AS role
         FROM team_memberships tm JOIN guardianships gu ON gu.child_id = tm.person_id
         JOIN accounts a ON a.person_id = gu.guardian_id AND a.disabled_at IS NULL
        WHERE tm.team_id = ?1 AND tm.role IN ('player', 'helper') AND ?2 = 1
       UNION
       SELECT DISTINCT a.id, a.person_id, CASE WHEN tm.role = 'coach' THEN 'coach' ELSE 'player' END
         FROM team_memberships tm JOIN accounts a ON a.person_id = tm.person_id AND a.disabled_at IS NULL
        WHERE tm.team_id = ?1`,
      g.team_id,
      g.parents_enabled,
    );
    const consents = await all<{ account_id: number; duty_type_id: number }>(
      env.DB,
      "SELECT account_id, duty_type_id FROM skill_consents WHERE account_id IN (SELECT value FROM json_each(?))",
      list(candidates.map((c) => c.account_id)),
    );
    const helping = new Set((await all<{ person_id: number }>(env.DB, "SELECT person_id FROM duties WHERE event_id = ? AND person_id IS NOT NULL", g.id)).map((r) => r.person_id));
    const members = new Set(
      (
        await all<{ person_id: number }>(
          env.DB,
          "SELECT person_id FROM club_members WHERE person_id IN (SELECT value FROM json_each(?))",
          list(candidates.map((c) => c.person_id)),
        )
      ).map((r) => r.person_id),
    );
    const byAccount = new Map<number, { person_id: number; roles: Set<string> }>();
    for (const c of candidates) {
      const x = byAccount.get(c.account_id) ?? { person_id: c.person_id, roles: new Set<string>() };
      x.roles.add(c.role);
      byAccount.set(c.account_id, x);
    }
    for (const [accountId, c] of byAccount) {
      if (helping.has(c.person_id)) continue;
      const possible = free.filter(({ type }) => {
        if (type.needsSkill && !consents.some((k) => k.account_id === accountId && k.duty_type_id === type.id)) return false;
        return (
          (type.whoParents && (c.roles.has("parent") || (g.parents_enabled === 0 && c.roles.has("player")))) ||
          (type.whoPlayers && c.roles.has("player")) ||
          (type.whoCoaches && c.roles.has("coach")) ||
          (type.whoMembers && members.has(c.person_id))
        );
      });
      if (!possible.length) continue;
      if (!(await claim(env.DB, "open", `${g.id}:${accountId}`))) continue;
      const team = g.team_name;
      const open = freeText(possible);
      const link = appLink(env, "/helfer");
      sent += await deliver(env, [accountId], "duty_open", () => {
        const game = gameText(g);
        const opponent = opponentOf(g);
        return {
          title: t`Helpers wanted · ${team}`,
          body: t`${game}. Still free: ${open}`,
          url: "/helfer",
          tag: `duty-open-${g.id}`,
          mailSubject: t`Helpers wanted: ${team} ${opponent}`,
          mailText: mailText(t`Helpers are still needed for ${game}. Still free: ${open}.`, t`Sign up: ${link}`),
        };
      });
    }
  }
  return sent;
}

/** "Open places" to the coaches of the team and admins. */
async function openSlotsToCoaches(env: Env, today: string, days: 5 | 2, types: Map<number, DutyType>): Promise<number> {
  const games = await gamesOn(env.DB, addDays(today, days));
  if (!games.length) return 0;
  // Admins with their own link to teams (coach or child there) only get those teams' games, even if
  // none of them uses the helper plan. Only admins without any team link get all.
  const admins = await all<{ account_id: number; teams: string | null }>(
    env.DB,
    `SELECT a.id AS account_id,
            (SELECT json_group_array(DISTINCT tm.team_id) FROM team_memberships tm
              WHERE tm.person_id = p.id AND tm.role = 'coach'
                 OR tm.person_id IN (SELECT child_id FROM guardianships WHERE guardian_id = p.id)) AS teams
       FROM persons p JOIN accounts a ON a.person_id = p.id AND a.disabled_at IS NULL
      WHERE p.is_admin = 1 AND p.is_former = 0`,
  );
  let sent = 0;
  for (const g of games) {
    const free = await freeBlocks(env.DB, g, types);
    if (!free.length) continue;
    const coaches = await all<{ account_id: number }>(
      env.DB,
      `SELECT a.id AS account_id FROM team_memberships tm JOIN accounts a ON a.person_id = tm.person_id AND a.disabled_at IS NULL
        WHERE tm.team_id = ? AND tm.role = 'coach'`,
      g.team_id,
    );
    // For special events also the creator and organisers
    const organizers = await all<{ account_id: number }>(
      env.DB,
      `SELECT a.id AS account_id FROM accounts a
        WHERE a.disabled_at IS NULL
          AND a.person_id IN (SELECT created_by FROM events WHERE id = ?1 AND kind = 'special' UNION SELECT person_id FROM event_organizers WHERE event_id = ?1)`,
      g.id,
    );
    const targets = new Set([...coaches, ...organizers].map((c) => c.account_id));
    for (const a of admins) {
      const teams = JSON.parse(a.teams ?? "[]") as number[];
      if (!teams.length || teams.includes(g.team_id)) targets.add(a.account_id);
    }
    for (const accountId of targets) {
      if (!(await claim(env.DB, `coach${days}`, `${g.id}:${accountId}`))) continue;
      const team = g.team_name;
      const open = freeText(free);
      const link = appLink(env, "/helfer");
      sent += await deliver(env, [accountId], "duty_coach_open", () => {
        const game = gameText(g);
        const opponent = opponentOf(g);
        return {
          title: t`Open helper places · ${team}`,
          body: `${game}: ${open}`,
          url: "/helfer",
          tag: `duty-coach-${g.id}`,
          mailSubject: t`Open helper places: ${team} ${opponent}`,
          mailText: mailText(t`There are still free places at ${game}: ${open}.`, t`Helper plan: ${link}`),
        };
      });
    }
  }
  return sent;
}

/** Called hourly, sends once a day from 8 am. */
export async function sendDutyNotifications(env: Env, now = Date.now()): Promise<number> {
  if (!isModuleOn("duties")) return 0;
  const hour = Number(toLocal(now).slice(11, 13));
  if (hour < DUTY_NOTIFY_HOUR) return 0;
  const today = todayLocal(now);
  // Create the blocks of upcoming games or move them along after a game was moved
  await ensureEventDuties(env.DB, null, today);
  const types = await loadAllDutyTypes(env.DB);
  let sent = 0;
  sent += await remind(env, today, 3);
  sent += await remind(env, today, 1);
  sent += await helpWanted(env, today, types);
  sent += await refereeWanted(env, today);
  sent += await openSlotsToCoaches(env, today, 5, types);
  sent += await openSlotsToCoaches(env, today, 2, types);
  return sent;
}
