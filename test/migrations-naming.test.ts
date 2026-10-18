// Migration files after the initial schema carry a UTC timestamp, the area and a description
// (migrations/README.md), so parallel pull requests never clash on a number.
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const NAME = /^\d{12}_[a-z0-9]+(-[a-z0-9]+)*_[a-z0-9]+(-[a-z0-9]+)*\.sql$/;

describe("migrations", () => {
  it("are 0001_init.sql plus timestamped files in order", () => {
    const names = (env.TEST_MIGRATIONS as { name: string }[]).map((m) => m.name);
    expect(names[0]).toBe("0001_init.sql");
    for (const name of names.slice(1)) expect(name, name).toMatch(NAME);
    expect([...names].sort()).toEqual(names);
  });

  it("the pattern accepts the documented example", () => {
    expect("202611051430_carpools_seat-notes.sql").toMatch(NAME);
    expect("0002_new_table.sql").not.toMatch(NAME);
  });
});
