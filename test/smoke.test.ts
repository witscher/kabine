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

describe("https only", () => {
  it("redirects plain http to https, also for the API", async () => {
    const res = await exports.default.fetch("http://app.example.org/api/health?x=1", { redirect: "manual" });
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("https://app.example.org/api/health?x=1");
    expect((await exports.default.fetch("https://app.example.org/api/health")).status).toBe(200);
    // Local development stays on http
    expect((await exports.default.fetch("http://localhost:5173/api/health")).status).toBe(200);
  });
});
