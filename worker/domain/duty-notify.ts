// Benachrichtigungen des Helferplans (täglich ab 8 Uhr, jede nur einmal):
// - Erinnerung an Eingetragene 3 und 1 Tag vor dem Termin (Spiel oder Sondertermin)
// - "Helfer gesucht" 3 Tage vorher an alle der Mannschaft, die noch nicht
//   eingetragen sind und einen freien Dienst übernehmen könnten (Wer hilft je Dienstart)
// - "Offene Plätze" 5 und 2 Tage vorher an Trainer und Admins
// - "KiHaSL/JuHaSL gesucht" 3 Tage vorher an alle mit dieser Rolle (bzw. ihre Eltern)
// Kanal (Push, Mail) je Konto und Thema, siehe notification_channels.
import { type DutyType, ensureEventDuties, loadAllDutyTypes, opponentOf } from "./duties";
import { mailer } from "./email-login";
import { enqueuePush, shortDate, shortTime } from "./notify";
import { all, list, run } from "../lib/db";
import { ownClubAbbr, ownClubShortName } from "./club";
import { addDays, todayLocal, toLocal } from "../lib/time";

export type DutyTopic = "duty_remind_3d" | "duty_remind_1d" | "duty_open" | "duty_coach_open" | "duty_referee_open";

/** Ohne Einstellung: Push an, Mail aus. */
const DEFAULT = { push: 1, mail: 0 };
/** Ab dieser Stunde (Berlin) wird verschickt. */
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

/** Nur einmal: true, wenn diese Benachrichtigung noch nicht verschickt war. */
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

/** Verschickt je Konto nach gewähltem Kanal. Mail nur an bestätigte Adressen. */
async function deliver(env: Env, accountIds: number[], topic: DutyTopic, msg: Message): Promise<number> {
  if (!accountIds.length) return 0;
  const rows = await all<{ id: number; email: string | null; verified: number; push: number | null; mail: number | null }>(
    env.DB,
    `SELECT a.id, a.email, a.email_verified_at IS NOT NULL AS verified, nc.push, nc.mail
       FROM accounts a LEFT JOIN notification_channels nc ON nc.account_id = a.id AND nc.topic = ?
      WHERE a.id IN (SELECT value FROM json_each(?)) AND a.disabled_at IS NULL`,
    topic,
    list([...new Set(accountIds)]),
  );
  const push = rows.filter((r) => (r.push ?? DEFAULT.push) === 1).map((r) => r.id);
  const mail = rows.filter((r) => (r.mail ?? DEFAULT.mail) === 1 && r.email && r.verified === 1);
  let sent = 0;
  if (push.length) sent += await enqueuePush(env, push, { title: msg.title, body: msg.body, url: msg.url, tag: msg.tag });
  for (const r of mail) {
    try {
      await mailer.send(env, {
        to: r.email!,
        subject: msg.mailSubject,
        text: msg.mailText,
        from: { email: env.MAIL_FROM, name: `${ownClubShortName()} Helferplan` },
      });
      sent++;
    } catch (err) {
      console.warn("Helferplan-Mail fehlgeschlagen", err instanceof Error ? err.message : err);
    }
  }
  return sent;
}

function appLink(env: Env, path: string): string {
  // ORIGIN is filled with the remembered app address at the start of the cron run (worker/cron.ts)
  return `${env.ORIGIN}${path}`;
}

const FOOTER = "\n\nWelche Benachrichtigungen du per Push oder Mail bekommst, stellst du in der App unter Profil → Benachrichtigungen ein.";

const GAME_COLUMNS = `e.id, e.kind, e.starts_at, e.is_home, e.home_team, e.guest_team, e.title, t.id AS team_id, t.name AS team_name, t.parents_enabled`;
const FIRST_TEAM = `JOIN teams t ON t.id = (SELECT et.team_id FROM event_teams et WHERE et.event_id = e.id ORDER BY et.team_id LIMIT 1)`;

/** Termine mit Helferdiensten an einem Tag: Spiele mit Helferplan (nicht ausgeblendet) und Sondertermine mit Blöcken. */
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

/** Termine mit KiHaSL/JuHaSL-Block an einem Tag, unabhängig vom Helferplan. */
async function refereeGamesOn(db: D1Database, date: string): Promise<GameRow[]> {
  return all<GameRow>(
    db,
    `SELECT ${GAME_COLUMNS} FROM events e ${FIRST_TEAM}
      WHERE e.cancelled_at IS NULL AND substr(e.starts_at, 1, 10) = ?
        AND EXISTS (SELECT 1 FROM event_duties ed JOIN duty_types dt ON dt.id = ed.duty_type_id AND dt.who_referees = 1 WHERE ed.event_id = e.id)`,
    date,
  );
}

/** Termine mit Einträgen an einem Tag (für Erinnerungen). */
async function gamesWithDutiesOn(db: D1Database, date: string): Promise<GameRow[]> {
  return all<GameRow>(
    db,
    `SELECT ${GAME_COLUMNS} FROM events e ${FIRST_TEAM}
      WHERE e.cancelled_at IS NULL AND substr(e.starts_at, 1, 10) = ? AND EXISTS (SELECT 1 FROM duties d WHERE d.event_id = e.id)`,
    date,
  );
}

/** Freie Plätze je Block eines Termins (ohne KiHaSL/JuHaSL, die laufen über refereeWanted). */
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

/** "KiHaSL/JuHaSL gesucht" an alle mit der Rolle (bzw. Eltern eines Kindes mit Rolle), die noch nicht eingetragen sind. */
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
      sent += await deliver(env, [c.account_id], "duty_referee_open", {
        title: `KiHaSL/JuHaSL gesucht · ${g.team_name}`,
        body: `${gameText(g)}. ${free === 1 ? "Noch 1 Platz frei" : `Noch ${free} Plätze frei`}.`,
        url: "/helfer?kihasl",
        tag: `duty-referee-${g.id}`,
        mailSubject: `KiHaSL/JuHaSL gesucht: ${g.team_name} ${opponentOf(g)}`,
        mailText: `Hallo,\n\nfür das Spiel ${gameText(g)} wird noch ein KiHaSL/JuHaSL gesucht.\n\nEintragen: ${appLink(env, "/helfer?kihasl")}${FOOTER}`,
      });
    }
  }
  return sent;
}

function gameText(g: GameRow): string {
  return `${ownClubAbbr()} ${g.team_name} ${opponentOf(g)} am ${shortDate(g.starts_at)} um ${shortTime(g.starts_at)}`;
}

function freeText(free: FreeBlock[]): string {
  return free.map((f) => (f.free > 1 ? `${f.type.name} (${f.free})` : f.type.name)).join(", ");
}

/** Erinnerung an Eingetragene. */
async function remind(env: Env, today: string, days: 3 | 1): Promise<number> {
  const games = await gamesWithDutiesOn(env.DB, addDays(today, days));
  let sent = 0;
  for (const g of games) {
    const entries = await all<{ id: number; label: string; child: string | null; account_id: number; via_parent: number }>(
      env.DB,
      // KiHaSL/JuHaSL-Kinder ohne eigenen Zugang: Erinnerung an die Eltern
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
      const when = days === 1 ? "morgen" : `in ${days} Tagen`;
      const what = `${e.label}${e.child ? ` (für ${e.child})` : ""}`;
      sent += await deliver(env, [e.account_id], days === 3 ? "duty_remind_3d" : "duty_remind_1d", {
        title: `Dein Helferdienst ${when}`,
        body: `${what}: ${gameText(g)}`,
        url: "/helfer",
        tag: `duty-${e.id}`,
        mailSubject: `Erinnerung: ${e.label} ${when}`,
        mailText: `Hallo,\n\ndu bist ${when} bei ${gameText(g)} eingetragen: ${what}.\n\nAustragen oder ändern kannst du dich in der App: ${appLink(env, "/helfer")}${FOOTER}`,
      });
    }
  }
  return sent;
}

/**
 * "Helfer gesucht" an alle der Mannschaft, die noch nicht eingetragen sind und einen freien
 * Dienst übernehmen könnten: Wer hilft je Dienstart, Vorkenntnisse nur mit Freigabe.
 */
async function helpWanted(env: Env, today: string, types: Map<number, DutyType>): Promise<number> {
  const games = await gamesOn(env.DB, addDays(today, 3));
  let sent = 0;
  for (const g of games) {
    const free = await freeBlocks(env.DB, g, types);
    if (!free.length) continue;
    // parent: Elternteil eines Spielers (Mannschaft mit Eltern); player: Spieler selbst; coach: Trainer
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
      sent += await deliver(env, [accountId], "duty_open", {
        title: `Helfer gesucht · ${g.team_name}`,
        body: `${gameText(g)}. Noch frei: ${freeText(possible)}`,
        url: "/helfer",
        tag: `duty-open-${g.id}`,
        mailSubject: `Helfer gesucht: ${g.team_name} ${opponentOf(g)}`,
        mailText: `Hallo,\n\nfür ${gameText(g)} werden noch Helfer gesucht. Noch frei: ${freeText(possible)}.\n\nEintragen: ${appLink(env, "/helfer")}${FOOTER}`,
      });
    }
  }
  return sent;
}

/** "Offene Plätze" an Trainer der Mannschaft und Admins. */
async function openSlotsToCoaches(env: Env, today: string, days: 5 | 2, types: Map<number, DutyType>): Promise<number> {
  const games = await gamesOn(env.DB, addDays(today, days));
  if (!games.length) return 0;
  // Admins mit eigenem Bezug zu Mannschaften (Trainer oder Kind dort) bekommen nur deren Spiele, auch wenn
  // keine davon den Helferplan nutzt. Nur Admins ganz ohne Mannschaftsbezug bekommen alle.
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
    // Bei Sonderterminen zusätzlich Ersteller und Organisatoren
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
      sent += await deliver(env, [accountId], "duty_coach_open", {
        title: `Noch offene Helferplätze · ${g.team_name}`,
        body: `${gameText(g)}: ${freeText(free)}`,
        url: "/helfer",
        tag: `duty-coach-${g.id}`,
        mailSubject: `Noch offene Helferplätze: ${g.team_name} ${opponentOf(g)}`,
        mailText: `Hallo,\n\nbei ${gameText(g)} sind noch Plätze frei: ${freeText(free)}.\n\nHelferplan: ${appLink(env, "/helfer")}${FOOTER}`,
      });
    }
  }
  return sent;
}

/** Stündlich aufgerufen, verschickt einmal am Tag ab 8 Uhr. */
export async function sendDutyNotifications(env: Env, now = Date.now()): Promise<number> {
  const hour = Number(toLocal(now).slice(11, 13));
  if (hour < DUTY_NOTIFY_HOUR) return 0;
  const today = todayLocal(now);
  // Blöcke der kommenden Spiele erzeugen bzw. nach Verschiebungen mitziehen
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
