// Migration rules (migrations/README.md): 0001_init.sql stays as clubs applied it, later files carry a UTC
// timestamp, the area and a description, and every one of them has an upgrade test.
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const NAME = /^\d{12}_[a-z0-9]+(-[a-z0-9]+)*_[a-z0-9]+(-[a-z0-9]+)*\.sql$/;
// SHA-256 of the statements of 0001_init.sql. Frozen: a schema change is a new file, never an edit.
const INIT_HASH = "08e5dd5dea5d08abfa02c7f5ebcca97d64d998679c1dacedf7ff950c02f6b189";

const tests = import.meta.glob<string>(["./**/*.test.ts", "../modules/*/test/**/*.test.ts"], { eager: true, query: "?raw", import: "default" });

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

describe("migrations", () => {
  const names = env.TEST_MIGRATIONS.map((m) => m.name);

  it("are 0001_init.sql plus timestamped files in order", () => {
    expect(names[0]).toBe("0001_init.sql");
    for (const name of names.slice(1)) expect(name, name).toMatch(NAME);
    expect([...names].sort()).toEqual(names);
  });

  it("the pattern accepts the documented example", () => {
    expect("202611051430_carpools_seat-notes.sql").toMatch(NAME);
    expect("0002_new_table.sql").not.toMatch(NAME);
  });

  it("0001_init.sql is unchanged", async () => {
    expect(await sha256(env.TEST_MIGRATIONS[0]!.queries.join("\n"))).toBe(INIT_HASH);
  });

  it("every migration after 0001_init.sql has an upgrade test", () => {
    const sources = Object.entries(tests).filter(([path]) => !path.endsWith("/migrations.test.ts"));
    expect(sources.length).toBeGreaterThan(20);
    for (const name of names.slice(1)) {
      expect(
        sources.some(([, src]) => src.includes(`upgradeFrom("${name}")`)),
        `${name}: no test calls upgradeFrom("${name}") (migrations/README.md)`,
      ).toBe(true);
    }
  });
});
