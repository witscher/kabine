// https://kabine.dev/releases.json: the newest release and the recent ones, for the update notices in club
// installations (worker/domain/releases.ts reads it once a day, shared/releases.ts parses it). Built from
// CHANGELOG.md (the versions, and the security marker of a section) and shared/changelog.ts (the release days).
// Only releases (## vX.Y.Z) count, never "Unreleased" or test versions. Conventions: docs/dev/releases.md.
import { ORIGIN } from "./layout.mjs";

/** The line that marks a security release, at the start of its section in CHANGELOG.md. */
export const SECURITY_MARKER = /^\*\*Security release[:.]\*\*/m;
/** Recent versions in the file; an installation that skipped more still learns about the latest. */
const RECENT = 10;

/** Release days from shared/changelog.ts ({ version: "0.9.0", date: "2026-11-19", … }). */
export function releaseDates(changelogTs) {
  return Object.fromEntries([...changelogTs.matchAll(/version: "(\d+\.\d+\.\d+)",\s*date: "(\d{4}-\d{2}-\d{2})"/g)].map(([, v, d]) => [v, d]));
}

export function releasesJson(changelogMd, changelogTs) {
  const dates = releaseDates(changelogTs);
  const versions = [];
  for (const section of changelogMd.split(/^(?=## )/m)) {
    const version = /^## v(\d+\.\d+\.\d+)\s*$/m.exec(section.split("\n")[0])?.[1];
    if (!version) continue;
    const date = dates[version];
    if (!date) throw new Error(`CHANGELOG.md: v${version} has no release day in shared/changelog.ts`);
    versions.push({
      version,
      date,
      // The heading's anchor on the release notes page (site/src/docs.mjs, slug)
      notes: `${ORIGIN}/en/news/#v${version.replace(/\./g, "-")}`,
      security: SECURITY_MARKER.test(section),
    });
  }
  if (!versions.length) throw new Error("CHANGELOG.md: no release found");
  return { latest: versions[0], versions: versions.slice(0, RECENT) };
}
