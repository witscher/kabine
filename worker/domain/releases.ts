// Update notices for admins: once a day the hourly cron asks kabine.dev for the newest release
// (https://kabine.dev/releases.json, shared/releases.ts), on the server only and never from a browser. A newer
// version is shown in the administration and sent once as a push to the admins (topic "updates"). Admins can
// switch the check off; then nothing is fetched. The request carries no personal data: an ordinary HTTPS GET
// with the User-Agent "Kabine/<version>" (docs/privacy.md, "Update check").
import { t } from "@lingui/core/macro";
import { KABINE_VERSION } from "../../shared/changelog";
import type { Locale } from "../../shared/i18n";
import { type AvailableUpdate, availableUpdate, compareRelease, githubRepo, parseReleaseFeed, type ReleaseFeed, RELEASES_URL, UPSTREAM_REPO } from "../../shared/releases";
import { enqueuePush } from "./notify";
import { all, first, run } from "../lib/db";
import { todayLocal, toLocal, utcIso } from "../lib/time";

const KEY = "update_check";
/** The check runs from this hour of the club's day on, so the push does not arrive at night. */
export const CHECK_FROM_HOUR = 10;
const TIMEOUT_MS = 5000;

export interface UpdateCheck {
  /** Switched off by an admin: nothing is fetched */
  off: boolean;
  /** Local day of the last attempt (successful or not): at most one request a day */
  triedOn: string | null;
  /** Time of the last successful fetch (UTC) */
  fetchedAt: string | null;
  feed: ReleaseFeed | null;
  /** The last version the admins got a push about */
  notified: string | null;
}

const EMPTY: UpdateCheck = { off: false, triedOn: null, fetchedAt: null, feed: null, notified: null };

function fromStored(value: string | null | undefined): UpdateCheck {
  if (!value) return { ...EMPTY };
  try {
    const v = JSON.parse(value) as Partial<UpdateCheck>;
    return {
      off: v.off === true,
      triedOn: typeof v.triedOn === "string" ? v.triedOn : null,
      fetchedAt: typeof v.fetchedAt === "string" ? v.fetchedAt : null,
      feed: parseReleaseFeed(v.feed),
      notified: typeof v.notified === "string" ? v.notified : null,
    };
  } catch {
    return { ...EMPTY };
  }
}

export async function loadUpdateCheck(db: D1Database): Promise<UpdateCheck> {
  return fromStored((await first<{ value: string }>(db, "SELECT value FROM app_meta WHERE key = ?", KEY))?.value);
}

async function saveUpdateCheck(db: D1Database, state: UpdateCheck): Promise<void> {
  await run(db, "INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", KEY, JSON.stringify(state));
}

/** Like saveUpdateCheck, but keeps the switch as it is now: an admin may switch the check off while it fetches. */
async function saveCheckResult(db: D1Database, state: UpdateCheck): Promise<void> {
  await run(
    db,
    `INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE
       SET value = json_set(excluded.value, '$.off', CASE WHEN json_extract(app_meta.value, '$.off') THEN json('true') ELSE json('false') END)`,
    KEY,
    JSON.stringify(state),
  );
}

/** Admins switch the check on or off. Off forgets what was fetched, so no stale hint stays. */
export async function setUpdateCheck(db: D1Database, on: boolean): Promise<void> {
  const state = await loadUpdateCheck(db);
  await saveUpdateCheck(db, on ? { ...state, off: false } : { ...state, off: true, feed: null, fetchedAt: null, triedOn: null });
}

/** Fetches releases.json; null on any failure (timeout, status, shape). Nothing about the club is sent. */
export async function fetchReleaseFeed(fetcher: typeof fetch = fetch): Promise<ReleaseFeed | null> {
  try {
    const res = await fetcher(RELEASES_URL, {
      headers: { accept: "application/json", "user-agent": `Kabine/${KABINE_VERSION}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: "error",
    });
    if (!res.ok) return null;
    return parseReleaseFeed(await res.json());
  } catch {
    return null;
  }
}

export type CheckResult = "off" | "not due" | "failed" | "checked";

/**
 * Hourly from the cron: fetches the feed once a day (from CHECK_FROM_HOUR on) and sends the admins one push per
 * new version. A failed fetch counts as the day's attempt; the next day tries again.
 */
export async function checkForUpdates(env: Env, now = Date.now(), fetcher: typeof fetch = fetch): Promise<CheckResult> {
  const state = await loadUpdateCheck(env.DB);
  if (state.off) return "off";
  const today = todayLocal(now);
  if (state.triedOn === today || Number(toLocal(now).slice(11, 13)) < CHECK_FROM_HOUR) return "not due";
  const feed = await fetchReleaseFeed(fetcher);
  const next: UpdateCheck = { ...state, triedOn: today, ...(feed ? { feed, fetchedAt: utcIso(now) } : {}) };
  // The newest version, once, and only if it is newer than the installed one and than the last one notified
  const latest = feed?.latest;
  if (latest && compareRelease(latest.version, KABINE_VERSION) > 0 && (!state.notified || compareRelease(latest.version, state.notified) > 0)) {
    const update = availableUpdate(feed, KABINE_VERSION, null, "en")!;
    // Stored before sending: a failing queue must not lead to a second push tomorrow
    next.notified = latest.version;
    await saveCheckResult(env.DB, next);
    await notifyAdmins(env, update);
    return "checked";
  }
  await saveCheckResult(env.DB, next);
  if (!feed) console.log("Update check: releases.json not available");
  return feed ? "checked" : "failed";
}

/** Accounts of the admins who work as admins (not in coach mode) and did not switch the topic "updates" off. */
export async function adminAccounts(db: D1Database): Promise<number[]> {
  const rows = await all<{ id: number }>(
    db,
    `SELECT a.id FROM persons p JOIN accounts a ON a.person_id = p.id
      WHERE p.is_admin = 1 AND p.is_former = 0 AND a.disabled_at IS NULL
        -- "Work as admin" switched off (worker/auth/actor.ts, loadActor): they see the app like a coach or parent
        AND NOT (a.coach_mode = 1 AND (EXISTS (SELECT 1 FROM team_memberships tm WHERE tm.person_id = p.id AND tm.role = 'coach')
          OR EXISTS (SELECT 1 FROM guardianships g WHERE g.guardian_id = p.id)))
        AND NOT EXISTS (
          SELECT 1 FROM notification_settings ns WHERE ns.account_id = a.id AND ns.person_id = p.id AND ns.topic = 'updates' AND ns.enabled = 0
        )`,
  );
  return rows.map((r) => r.id);
}

async function notifyAdmins(env: Env, update: AvailableUpdate): Promise<number> {
  const version = update.version;
  return enqueuePush(env, await adminAccounts(env.DB), () =>
    update.security
      ? { title: t`Security update: Kabine ${version}`, body: t`Please install it soon. Administration → Updates and maintenance shows how.`, url: "/verwaltung/updates", tag: "kabine-update" }
      : { title: t`Kabine ${version} is available`, body: t`Install it when it suits the club. Administration → Updates and maintenance shows how.`, url: "/verwaltung/updates", tag: "kabine-update" },
  );
}

/**
 * The club's copy on GitHub ("owner/name"), for the "Install update" button: as the deploy found it in Workers
 * Builds (scripts/deploy.mjs, last_update.repo), else the club's source code link if it points to a GitHub copy.
 * Null when unknown; the button then opens the update guide on kabine.dev.
 */
export function clubRepo(lastUpdateRepo: string | null | undefined, sourceUrl: string | null | undefined): string | null {
  const own = (repo: string | null) => (repo && repo.toLowerCase() !== UPSTREAM_REPO ? repo : null);
  return own(githubRepo(lastUpdateRepo ? `https://github.com/${lastUpdateRepo}` : null)) ?? own(githubRepo(sourceUrl));
}

const parsed = <T>(value: string | undefined): T | null => {
  try {
    return value ? (JSON.parse(value) as T) : null;
  } catch {
    return null;
  }
};

export interface UpdateNotice {
  check: UpdateCheck;
  repo: string | null;
  update: AvailableUpdate | null;
}

/** State of the check, the club's copy and the update to tell the admins about, in one read. */
export async function loadUpdateNotice(db: D1Database, locale: Locale): Promise<UpdateNotice> {
  const rows = await all<{ key: string; value: string }>(db, "SELECT key, value FROM app_meta WHERE key IN (?, 'last_update', 'club')", KEY);
  const value = (key: string) => rows.find((r) => r.key === key)?.value;
  const check = fromStored(value(KEY));
  const repo = clubRepo(parsed<{ repo?: string }>(value("last_update"))?.repo, parsed<{ sourceUrl?: string }>(value("club"))?.sourceUrl);
  return { check, repo, update: check.off ? null : availableUpdate(check.feed, KABINE_VERSION, repo, locale) };
}
