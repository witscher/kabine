import { t } from "@lingui/core/macro";
import type { NotificationTopic } from "../../shared/types";
import { parentsInChargeSql } from "../auth/actor";
import { isLocale } from "../../shared/i18n";
import { shortDateIn } from "../../shared/dates";
import { currentLocale, withLocale } from "../i18n";
import { all, list } from "../lib/db";

export interface PushPayload {
  title: string;
  body: string;
  /** Path within the app that opens when tapped. */
  url: string;
  /** Equal tags replace each other on the device (e.g. a chat room). */
  tag?: string;
}

/**
 * Content of a push: a function that builds title and body. It runs once per language of the
 * recipients (withLocale), so texts written with t`…` arrive in each person's language.
 * A plain payload is sent as is (texts without words, e.g. a chat message).
 */
export type PushContent = PushPayload | (() => PushPayload);

export interface PushJob {
  accountIds: number[];
  payload: PushPayload;
}

/**
 * Accounts that get a push about these persons: the person's own account and
 * the accounts of their parents, if parents are involved in the affected
 * teams (teamIds). Filtered by the notification settings per account and
 * person.
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

/** Staff of these teams (physio, manager): they get the event changes of the team without taking part. */
export async function staffOf(db: D1Database, teamIds: readonly number[]): Promise<number[]> {
  if (!teamIds.length) return [];
  const rows = await all<{ person_id: number }>(
    db,
    `SELECT DISTINCT tm.person_id FROM team_memberships tm JOIN persons p ON p.id = tm.person_id
      WHERE tm.team_id IN (SELECT value FROM json_each(?)) AND tm.role = 'staff' AND p.is_former = 0`,
    list([...teamIds]),
  );
  return rows.map((r) => r.person_id);
}

/** Accounts of the coaches of these teams (topic "coach" of the own person). */
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
 * Enqueues pushes. Accounts without a registered device are filtered out
 * first, so no queue operations are wasted.
 */
export async function enqueuePush(
  env: Env,
  accountIds: number[],
  content: PushContent,
  opts: { exclude?: number[] } = {},
): Promise<number> {
  if (!pushConfigured(env)) return 0;
  const exclude = new Set(opts.exclude ?? []);
  const unique = [...new Set(accountIds)].filter((id) => !exclude.has(id));
  if (!unique.length) return 0;
  const withDevices = await all<{ account_id: number; locale: string | null }>(
    env.DB,
    `SELECT a.id AS account_id, a.locale FROM accounts a
      WHERE a.id IN (SELECT value FROM json_each(?)) AND EXISTS (SELECT 1 FROM push_subscriptions s WHERE s.account_id = a.id)`,
    list(unique),
  );
  if (!withDevices.length) return 0;
  // One payload per language of the recipients
  const byLocale = new Map<string, number[]>();
  for (const r of withDevices) {
    const key = isLocale(r.locale) ? r.locale : "";
    byLocale.set(key, [...(byLocale.get(key) ?? []), r.account_id]);
  }
  const jobs: { body: PushJob }[] = [];
  for (const [locale, targets] of byLocale) {
    const payload = typeof content === "function" ? withLocale(locale || null, content) : content;
    for (let i = 0; i < targets.length; i += 50) jobs.push({ body: { accountIds: targets.slice(i, i + 50), payload } });
  }
  for (let i = 0; i < jobs.length; i += 100) await env.PUSH_QUEUE.sendBatch(jobs.slice(i, i + 100));
  return withDevices.length;
}

/** Push to persons and their parents. teamIds: the affected teams (for whether parents are in charge). */
export async function notifyPersons(
  env: Env,
  personIds: number[],
  topic: NotificationTopic,
  payload: PushContent,
  opts: { teamIds: readonly number[]; exclude?: number[] },
): Promise<number> {
  if (!pushConfigured(env)) return 0;
  return enqueuePush(env, await recipientsForPersons(env.DB, personIds, topic, opts.teamIds), payload, opts);
}

export async function notifyCoaches(
  env: Env,
  teamIds: number[],
  payload: PushContent,
  opts: { exclude?: number[] } = {},
): Promise<number> {
  if (!pushConfigured(env)) return 0;
  return enqueuePush(env, await recipientsForCoaches(env.DB, teamIds), payload, opts);
}

/** de "Fr 02.10.", en "Fri 2 Oct" for a local time 'YYYY-MM-DDTHH:MM', in the current language. */
export function shortDate(local: string): string {
  return shortDateIn(currentLocale(), local);
}

export function shortTime(local: string): string {
  return local.slice(11, 16);
}

export function eventLabel(kind: string, title: string): string {
  if (kind === "training") return t`Training`;
  if (kind === "game") return t`Game ${title}`;
  return title;
}
