import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("Gerüst", () => {
  it("antwortet auf /api/health", async () => {
    const res = await exports.default.fetch("https://example.com/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, env: "production", maintenance: false, updating: false });
  });

  it("hat das Schema angelegt", async () => {
    const row = await env.DB.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'events'").first<{ n: number }>();
    expect(row?.n).toBe(1);
  });
});
