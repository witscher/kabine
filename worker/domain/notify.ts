import { select, t } from "@lingui/core/macro";
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
  return [...new Set((await recipientPairs(db, personIds, topic, teamIds)).map((r) => r.account_id))];
}

interface RecipientPair {
  account_id: number;
  first_name: string;
  /** 1: the person is the account's own person, 0: a child of the account */
  self: number;
}

/** Like recipientsForPersons, with the persons each account gets the push for. */
async function recipientPairs(db: D1Database, personIds: number[], topic: NotificationTopic, teamIds: readonly number[]): Promise<RecipientPair[]> {
  if (!personIds.length) return [];
  return all<RecipientPair>(
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
      SELECT DISTINCT pr.account_id, p.first_name, a.person_id = pr.person_id AS self
        FROM pairs pr JOIN accounts a ON a.id = pr.account_id JOIN persons p ON p.id = pr.person_id
       WHERE a.disabled_at IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM notification_settings ns
            WHERE ns.account_id = pr.account_id AND ns.person_id = pr.person_id AND ns.topic = ?2 AND ns.enabled = 0
         )`,
    list(personIds),
    topic,
    list([...teamIds]),
  );
}

/**
 * Whom a push is about, seen from the recipient: themselves and/or their children (first names).
 * Without it parents read "You are in the squad" when their child is meant.
 */
export interface PushFor {
  self: boolean;
  others: string[];
}

/** Content of a push about persons: the same for everyone, or written per recipient (you, your child, several). */
export type PersonContent = PushContent | ((who: PushFor) => PushPayload);

/** you: only the recipient; one: one child; youAnd: the recipient and children; other: several children */
export type PushForm = "you" | "one" | "youAnd" | "other";

export function pushForm(w: PushFor): PushForm {
  return w.self ? (w.others.length ? "youAnd" : "you") : w.others.length === 1 ? "one" : "other";
}

/** "Mia", "Mia and Ben", "you and Mia" in the current language; capitalised at the start of a sentence. */
export function whoNames(w: PushFor, start = false): string {
  const you = start ? t`You` : t`you`;
  const names = [...(w.self ? [you] : []), ...w.others];
  return new Intl.ListFormat(currentLocale(), { type: "conjunction" }).format(names.length ? names : [you]);
}

/** "Are you coming?", "Is Mia coming?", "Are you and Mia coming?" */
export function areYouComing(w: PushFor): string {
  const form = pushForm(w);
  const names = whoNames(w);
  return select(form, { you: "Are you coming?", one: `Is ${names} coming?`, youAnd: `Are ${names} coming?`, other: `Are ${names} coming?` });
}

/** "If you can't make it, please decline." for a child by name, for several "someone". */
export function ifYouCannot(w: PushFor): string {
  const form = pushForm(w);
  const name = w.others[0] ?? "";
  return select(form, {
    you: "If you can't make it, please decline.",
    one: `If ${name} can't make it, please decline.`,
    other: "If someone can't make it, please decline.",
  });
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
  if (typeof content !== "function") return enqueueEach(env, accountIds, () => content, opts);
  // One payload per language of the recipients
  const perLocale = new Map<string, PushPayload>();
  return enqueueEach(env, accountIds, () => content(), opts, perLocale);
}

/**
 * A push written per account (e.g. "you play at 14:00", "Lena plays at 11:30"), each built in the account's language.
 * Accounts with the same text are sent together; accounts without a registered device are skipped.
 */
export async function enqueuePushEach(
  env: Env,
  accountIds: number[],
  build: (accountId: number) => PushPayload,
  opts: { exclude?: number[] } = {},
): Promise<number> {
  return enqueueEach(env, accountIds, build, opts);
}

/**
 * Enqueues a push per account, built in the account's language; accounts with the same text are sent
 * together. Accounts without a registered device are filtered out first, so no queue operations are wasted.
 * cache: payloads per language, when the text does not depend on the account.
 */
async function enqueueEach(
  env: Env,
  accountIds: number[],
  build: (accountId: number) => PushPayload,
  opts: { exclude?: number[] },
  cache?: Map<string, PushPayload>,
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
  const groups = new Map<string, { payload: PushPayload; targets: number[] }>();
  for (const r of withDevices) {
    const locale = isLocale(r.locale) ? r.locale : "";
    let payload = cache?.get(locale);
    if (!payload) {
      payload = withLocale(locale || null, () => build(r.account_id));
      cache?.set(locale, payload);
    }
    const key = JSON.stringify(payload);
    const group = groups.get(key) ?? { payload, targets: [] };
    group.targets.push(r.account_id);
    groups.set(key, group);
  }
  const jobs: { body: PushJob }[] = [];
  for (const { payload, targets } of groups.values()) {
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
  content: PersonContent,
  opts: { teamIds: readonly number[]; exclude?: number[] },
): Promise<number> {
  if (!pushConfigured(env)) return 0;
  const pairs = await recipientPairs(env.DB, personIds, topic, opts.teamIds);
  if (typeof content !== "function") return enqueuePush(env, pairs.map((r) => r.account_id), content, opts);
  // Per account: whom the push is about; accounts with the same text go out together (enqueueEach)
  const byAccount = new Map<number, PushFor>();
  for (const r of pairs) {
    const w = byAccount.get(r.account_id) ?? { self: false, others: [] };
    if (r.self) w.self = true;
    else if (!w.others.includes(r.first_name)) w.others.push(r.first_name);
    byAccount.set(r.account_id, w);
  }
  for (const w of byAccount.values()) w.others.sort((a, b) => a.localeCompare(b));
  return enqueueEach(env, [...byAccount.keys()], (account) => content(byAccount.get(account)!), opts);
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

/**
 * Accounts of a child's linked parents, if they are in charge in the event's teams. Not filtered by the
 * notification settings: for hints that must always reach the parents.
 */
export async function guardianAccounts(db: D1Database, childId: number, teamIds: readonly number[]): Promise<number[]> {
  const rows = await all<{ id: number }>(
    db,
    `SELECT DISTINCT a.id FROM guardianships g
       JOIN accounts a ON a.person_id = g.guardian_id AND a.disabled_at IS NULL
       JOIN persons p ON p.id = g.guardian_id AND p.is_former = 0
      WHERE g.child_id = ?1 AND ${parentsInChargeSql("g.child_id", "SELECT value FROM json_each(?2)")}`,
    childId,
    list([...teamIds]),
  );
  return rows.map((r) => r.id);
}
