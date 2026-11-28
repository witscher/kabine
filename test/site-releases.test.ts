// https://kabine.dev/releases.json (site/src/releases.mjs): built from CHANGELOG.md and the release days in
// shared/changelog.ts, read by club installations (shared/releases.ts). Security releases carry a marker line
// at the start of their section (docs/dev/releases.md).
import { describe, expect, it } from "vitest";
import changelogMd from "../CHANGELOG.md?raw";
import changelogTs from "../shared/changelog.ts?raw";
import { KABINE_VERSION } from "../shared/changelog";
import { parseReleaseFeed } from "../shared/releases";
import { releasesJson } from "../site/src/releases.mjs";

const TS = `{ version: "1.0.1", date: "2026-12-10", items: () => [] }, { version: "1.0.0", date: "2026-12-01", items: () => [] }`;

describe("releases.json", () => {
  it("lists the releases newest first, without Unreleased, with links to their notes", () => {
    const md = "# Changelog\n\nIntro.\n\n## Unreleased\n\n- Next thing\n\n## v1.0.1\n\n**Security release:** fixes a sign-in problem. Install it soon.\n\n- Fix\n\n## v1.0.0\n\n- Release\n";
    const json = releasesJson(md, TS);
    expect(json.latest).toEqual({ version: "1.0.1", date: "2026-12-10", notes: "https://kabine.dev/en/news/#v1-0-1", security: true });
    expect(json.versions.map((v) => [v.version, v.security])).toEqual([
      ["1.0.1", true],
      ["1.0.0", false],
    ]);
    // What the installations read is exactly what the site writes
    expect(parseReleaseFeed(JSON.parse(JSON.stringify(json)))).toEqual(json);
  });

  it("the marker counts only as its own line, not inside a sentence", () => {
    const md = "## v1.0.1\n\n- Docs: how to write **Security release:** in a changelog\n\n## v1.0.0\n\n- Release\n";
    expect(releasesJson(md, TS).latest.security).toBe(false);
  });

  it("fails the build when a release has no day", () => {
    expect(() => releasesJson("## v2.0.0\n\n- New\n", TS)).toThrow(/v2\.0\.0/);
  });

  it("builds from the repository's changelog with the installed version as the latest", () => {
    const json = releasesJson(changelogMd, changelogTs);
    expect(json.latest.version).toBe(KABINE_VERSION);
    expect(json.versions.length).toBeGreaterThan(3);
    expect(json.versions.length).toBeLessThanOrEqual(10);
  });
});
