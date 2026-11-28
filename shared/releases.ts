// The newest Kabine releases, as kabine.dev publishes them (https://kabine.dev/releases.json, built from
// CHANGELOG.md by site/src/releases.mjs). A club's installation fetches the file once a day on the server
// (worker/domain/releases.ts) and tells its admins about a newer version (docs/operation.md, "Update notices").
import type { Locale } from "./i18n";

export const RELEASES_URL = "https://kabine.dev/releases.json";

export interface Release {
  /** "1.0.1", without the "v" */
  version: string;
  /** Release day, YYYY-MM-DD */
  date: string;
  /** Release notes on kabine.dev */
  notes: string;
  /** Marked as a security release in CHANGELOG.md (docs/dev/releases.md) */
  security: boolean;
}

export interface ReleaseFeed {
  latest: Release;
  /** Recent releases, newest first, the latest included */
  versions: Release[];
}

const VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const NOTES_PREFIX = "https://kabine.dev/";
/** More would only be noise: an installation needs the versions since its own. */
const MAX_VERSIONS = 30;

function release(value: unknown): Release | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.version !== "string" || !VERSION.test(v.version)) return null;
  if (typeof v.date !== "string" || !DATE.test(v.date)) return null;
  // Links point to kabine.dev only, whatever the file says
  const notes = typeof v.notes === "string" && v.notes.startsWith(NOTES_PREFIX) && v.notes.length < 300 ? v.notes : `${NOTES_PREFIX}en/news/`;
  return { version: v.version, date: v.date, notes, security: v.security === true };
}

/** The feed if it has the expected shape, else null. Unknown fields are ignored. */
export function parseReleaseFeed(value: unknown): ReleaseFeed | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const latest = release(v.latest);
  if (!latest) return null;
  const versions = (Array.isArray(v.versions) ? v.versions : [])
    .slice(0, MAX_VERSIONS)
    .map(release)
    .filter((r): r is Release => r !== null);
  if (!versions.some((r) => r.version === latest.version)) versions.unshift(latest);
  versions.sort((a, b) => compareRelease(b.version, a.version));
  return { latest, versions };
}

/**
 * Compares versions such as "1.0.0" and "1.0.0-rc.3": negative if a is older than b. A test version comes before
 * its release (1.0.0-rc.3 < 1.0.0); test versions of the same release are compared by their number.
 */
export function compareRelease(a: string, b: string): number {
  const [coreA = "", preA] = a.replace(/^v/, "").split("-", 2);
  const [coreB = "", preB] = b.replace(/^v/, "").split("-", 2);
  const pa = coreA.split(".").map(Number);
  const pb = coreB.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  if (!preA || !preB) return preA ? -1 : preB ? 1 : 0;
  const na = Number(/\d+$/.exec(preA)?.[0] ?? 0);
  const nb = Number(/\d+$/.exec(preB)?.[0] ?? 0);
  return na - nb;
}

/** What the admins of an installation on `installed` are told: the newest release, and whether a newer one fixes security. */
export interface AvailableUpdate extends Release {
  /** One of the releases since the installed one is a security release */
  security: boolean;
  /** Where "Install update" leads: the update pull request of the club's copy, else the guide on kabine.dev */
  installUrl: string;
  /** The update opens a pull request in the club's copy on GitHub (installUrl points there) */
  pullRequest: boolean;
}

export function availableUpdate(feed: ReleaseFeed | null, installed: string, repo: string | null, locale: Locale): AvailableUpdate | null {
  if (!feed || compareRelease(feed.latest.version, installed) <= 0) return null;
  const security = feed.versions.some((r) => r.security && compareRelease(r.version, installed) > 0) || feed.latest.security;
  return {
    ...feed.latest,
    security,
    installUrl: repo ? updatePullRequestUrl(repo, feed.latest.version) : updateGuideUrl(locale),
    pullRequest: !!repo,
  };
}

/** "owner/name" of a GitHub repository, from a URL like https://github.com/owner/name(.git); null for anything else. */
export function githubRepo(url: string | null | undefined): string | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url.replace(/^git@github\.com:/, "https://github.com/"));
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" || parsed.hostname.toLowerCase() !== "github.com") return null;
  const m = /^\/([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100}?)(?:\.git)?\/?$/.exec(parsed.pathname);
  if (!m || m[2] === "." || m[2] === "..") return null;
  return `${m[1]}/${m[2]}`;
}

/** The Kabine repository itself: never a club's copy. */
export const UPSTREAM_REPO = "witscher/kabine";

/** The update pull request of this version in the club's copy (branch kabine-update-vX.Y.Z, .github/workflows/update.yml). */
export function updatePullRequestUrl(repo: string, version: string): string {
  return `https://github.com/${repo}/pulls?q=${encodeURIComponent(`is:pr head:kabine-update-v${version}`).replace(/%20/g, "+")}`;
}

/** Anchors of the update guide in docs/operation.md and docs/operation.de.md (test/site-docs.test.ts checks them). */
export const UPDATE_DOC_SECTIONS = {
  install: { en: "installing-an-update", de: "ein-update-installieren" },
  notices: { en: "update-notices", de: "update-hinweise" },
} as const;

/** The update guide on kabine.dev, German or English. */
export function updateGuideUrl(locale: Locale, section: keyof typeof UPDATE_DOC_SECTIONS = "install"): string {
  const s = UPDATE_DOC_SECTIONS[section];
  return locale === "de" ? `https://kabine.dev/docs/betrieb/#${s.de}` : `https://kabine.dev/en/docs/operation/#${s.en}`;
}
