// CHANGELOG.md (GitHub, update pull requests) and shared/changelog.ts (shown in the app) list the same versions.
import { describe, expect, it } from "vitest";
import changelogMd from "../CHANGELOG.md?raw";
import pkg from "../package.json";
import { CHANGELOG, compareVersions, KABINE_VERSION } from "../shared/changelog";

describe("changelog", () => {
  it("has the same versions as CHANGELOG.md, newest first, the first one installed", () => {
    const md = [...changelogMd.matchAll(/^## v(\d+\.\d+\.\d+)\s*$/gm)].map((m) => m[1]);
    expect(CHANGELOG.map((e) => e.version)).toEqual(md);
    expect(KABINE_VERSION).toBe(pkg.version);
    for (let i = 1; i < CHANGELOG.length; i++) expect(compareVersions(CHANGELOG[i - 1]!.version, CHANGELOG[i]!.version)).toBeGreaterThan(0);
    for (const e of CHANGELOG) {
      expect(e.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(e.items().length).toBeGreaterThan(0);
    }
  });

  it("compares versions by number", () => {
    expect(compareVersions("0.10.0", "0.9.9")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
    expect(compareVersions("0.1.0", "0.2.0")).toBeLessThan(0);
  });
});
