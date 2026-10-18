import type { NotificationTopic } from "../../shared/types";
import { parentsInChargeSql } from "../auth/actor";
import { all, list } from "../lib/db";

export interface PushPayload {
  title: string;
  body: string;
  /** Pfad innerhalb der App, der beim Antippen geöffnet wird. */
  url: string;
  /** Gleiche Tags ersetzen sich auf dem Gerät (z. B. ein Chatraum). */
  tag?: string;
}

export interface PushJob {
  accountIds: number[];
  payload: PushPayload;
}

/**
 * Accounts, die eine Push zu diesen Personen bekommen: der eigene Account der
 * Person und die Accounts ihrer Eltern, sofern die Eltern in den betroffenen
 * Mannschaften (teamIds) eingebunden sind. Gefiltert nach den
 * Benachrichtigungseinstellungen pro Account und Person.
 */
export async function recipientsForPersons(
  db: D1Database,
  personIds: number[],
  topic: NotificationTopic,
  teamIds: readonly number[],
): Promise<number[]> {
  if (!personIds.length) return [];
  const rows = await all<{ account_id: number }>(
    db,
    `WITH targets(person_id) AS (
        SELECT p.id FROM persons p WHERE p.id IN (SELECT value FROM json_each(?1)) AND p.is_former = 0
      ),
      pairs(account_id, person_id) AS (
        SELECT a.id, t.person_id FROM targets t JOIN accounts a ON a.person_id = t.person_id
        UNION
        SELECT a.id, t.person_id FROM targets t
          JOIN guardianships g ON g.child_id = t.person_id
          JOIN accounts a ON a.person_id = g.guardian_id
         WHERE ${parentsInChargeSql("t.person_id", "SELECT value FROM json_each(?3)")}
      )
      SELECT DISTINCT pr.account_id FROM pairs pr JOIN accounts a ON a.id = pr.account_id
       WHERE a.disabled_at IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM notification_settings ns
            WHERE ns.account_id = pr.account_id AND ns.person_id = pr.person_id AND ns.topic = ?2 AND ns.enabled = 0
         )`,
    list(personIds),
    topic,
    list([...teamIds]),
  );
  return rows.map((r) => r.account_id);
}

/** Accounts der Trainer dieser Mannschaften (Thema "coach" der eigenen Person). */
export async function recipientsForCoaches(db: D1Database, teamIds: number[]): Promise<number[]> {
  if (!teamIds.length) return [];
  const rows = await all<{ account_id: number }>(
    db,
    `SELECT DISTINCT a.id AS account_id
       FROM team_memberships tm JOIN accounts a ON a.person_id = tm.person_id
      WHERE tm.team_id IN (SELECT value FROM json_each(?)) AND tm.role = 'coach' AND a.disabled_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM notification_settings ns
           WHERE ns.account_id = a.id AND ns.person_id = tm.person_id AND ns.topic = 'coach' AND ns.enabled = 0
        )`,
    list(teamIds),
  );
  return rows.map((r) => r.account_id);
}

export function pushConfigured(env: Env): boolean {
  return Boolean(env.VAPID_PRIVATE_KEY && env.VAPID_PUBLIC_KEY);
}

/**
 * Reiht Pushes in die Queue ein. Accounts ohne registriertes Gerät werden
 * vorher aussortiert, damit keine Queue-Operationen verschwendet werden.
 */
export async function enqueuePush(
  env: Env,
  accountIds: number[],
  payload: PushPayload,
  opts: { exclude?: number[] } = {},
): Promise<number> {
  if (!pushConfigured(env)) return 0;
  const exclude = new Set(opts.exclude ?? []);
  const unique = [...new Set(accountIds)].filter((id) => !exclude.has(id));
  if (!unique.length) return 0;
  const withDevices = await all<{ account_id: number }>(
    env.DB,
    "SELECT DISTINCT account_id FROM push_subscriptions WHERE account_id IN (SELECT value FROM json_each(?))",
    list(unique),
  );
  const targets = withDevices.map((r) => r.account_id);
  if (!targets.length) return 0;
  const jobs: { body: PushJob }[] = [];
  for (let i = 0; i < targets.length; i += 50) jobs.push({ body: { accountIds: targets.slice(i, i + 50), payload } });
  await env.PUSH_QUEUE.sendBatch(jobs);
  return targets.length;
}

/** Push an Personen und ihre Eltern. teamIds: die betroffenen Mannschaften (für die Zuständigkeit der Eltern). */
export async function notifyPersons(
  env: Env,
  personIds: number[],
  topic: NotificationTopic,
  payload: PushPayload,
  opts: { teamIds: readonly number[]; exclude?: number[] },
): Promise<number> {
  if (!pushConfigured(env)) return 0;
  return enqueuePush(env, await recipientsForPersons(env.DB, personIds, topic, opts.teamIds), payload, opts);
}

export async function notifyCoaches(
  env: Env,
  teamIds: number[],
  payload: PushPayload,
  opts: { exclude?: number[] } = {},
): Promise<number> {
  if (!pushConfigured(env)) return 0;
  return enqueuePush(env, await recipientsForCoaches(env.DB, teamIds), payload, opts);
}

const WEEKDAYS = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

/** "Fr 02.10." für eine lokale Zeit 'YYYY-MM-DDTHH:MM'. */
export function shortDate(local: string): string {
  const [y, m, d] = local.slice(0, 10).split("-").map(Number) as [number, number, number];
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${WEEKDAYS[wd]} ${String(d).padStart(2, "0")}.${String(m).padStart(2, "0")}.`;
}

export function shortTime(local: string): string {
  return local.slice(11, 16);
}

export function eventLabel(kind: string, title: string): string {
  if (kind === "training") return "Training";
  if (kind === "game") return `Spiel ${title}`;
  return title;
}
