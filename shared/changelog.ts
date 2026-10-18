// Release notes the app shows to admins after an update (src/news.tsx), translated like every text.
// CHANGELOG.md has the full notes for GitHub and the update pull requests; every version there needs an
// entry here and the other way round, newest first (test/changelog.test.ts). The first entry is the
// installed version (package.json).
import { t } from "@lingui/core/macro";

export interface ChangelogEntry {
  /** "0.2.0", without the "v" */
  version: string;
  /** Release day, YYYY-MM-DD */
  date: string;
  /** A few short lines for admins: what changes for the club. */
  items: () => string[];
}

export const CHANGELOG: readonly ChangelogEntry[] = [
  {
    version: "0.1.0",
    date: "2026-10-18",
    items: () => [t`First release of Kabine.`],
  },
];

export const KABINE_VERSION = CHANGELOG[0]!.version;

/** Compares "1.2.3" versions: negative if a is older than b. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

/** Entries newer than the version someone has seen. */
export function entriesSince(seen: string): ChangelogEntry[] {
  return CHANGELOG.filter((e) => compareVersions(e.version, seen) > 0);
}
