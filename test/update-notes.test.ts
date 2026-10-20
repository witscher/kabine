// Release notes in the update pull request (scripts/update-notes-lib.mjs): all versions since the installed one.
import { describe, expect, it } from "vitest";
import changelog from "../CHANGELOG.md?raw";
import { notesSince } from "../scripts/update-notes-lib.mjs";

const sample = `# Changelog

Intro for maintainers.

## Unreleased

- not released yet

## v0.2.3

- three

## v0.2.2

- two

## v0.2.1

- one

## v0.2.0

- zero
`;

describe("update notes", () => {
  it("a copy that skipped releases gets every version since its own, newest first", () => {
    expect(notesSince(sample, "v0.2.0")).toBe("## v0.2.3\n\n- three\n\n## v0.2.2\n\n- two\n\n## v0.2.1\n\n- one");
    expect(notesSince(sample, "0.2.2")).toBe("## v0.2.3\n\n- three");
  });

  it("leaves out Unreleased and the introduction; unknown versions get all releases, capped", () => {
    expect(notesSince(sample, "v0.2.3")).toBe("");
    expect(notesSince(sample, "v0.0.9")).toContain("## v0.2.0");
    expect(notesSince(sample, null)).not.toContain("not released yet");
    expect(notesSince(sample, "v0.0.9", 3).split("\n")).toHaveLength(5);
  });

  it("works on the real CHANGELOG.md", () => {
    const notes = notesSince(changelog, "v0.2.0");
    expect(notes).toMatch(/^## v\d+\.\d+\.\d+/);
    expect(notes).toContain("## v0.2.1");
    expect(notes).not.toContain("## v0.2.0");
  });
});
