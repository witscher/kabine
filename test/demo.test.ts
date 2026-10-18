import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { app } from "../worker/index";
import { DEMO_ROLES, demoLocalHour, resetDemo } from "../worker/demo/reset";
import { splitSql } from "../worker/demo/split-sql";
import { freshDb, one, rows } from "./helpers";

const demoEnv = { ...env, APP_ENV: "demo", DEMO_RESET_TOKEN: "demo-reset-token-0123456789" } as Env;
const ctx = { waitUntil() {}, passThroughOnException() {}, props: {} } as unknown as ExecutionContext;
const fetchApp = (request: Request, e: Env = demoEnv) => Promise.resolve(app.fetch(request, e, ctx));

describe("splitSql", () => {
  it("splits at semicolons outside strings and drops comments", () => {
    expect(splitSql("-- header; not a statement\nINSERT INTO a VALUES ('x;y', 'it''s');\nSELECT 1 -- tail\n;\n")).toEqual(["INSERT INTO a VALUES ('x;y', 'it''s')", "SELECT 1 \n"].map((s) => s.trim()));
  });
});

describe("demo local hour", () => {
  it("is Berlin time, summer and winter", () => {
    expect(demoLocalHour(Date.UTC(2026, 6, 1, 1, 0))).toBe(3);
    expect(demoLocalHour(Date.UTC(2026, 11, 1, 2, 0))).toBe(3);
    expect(demoLocalHour(Date.UTC(2026, 11, 1, 1, 0))).toBe(2);
  });
});

describe("demo installation", () => {
  beforeAll(async () => {
    await freshDb();
    // Something a visitor left behind: a person and a session that the reset must remove
    await env.DB.prepare("INSERT INTO persons (id, first_name, last_name) VALUES (9999, 'Besucher', 'Spuren')").run();
    await resetDemo(demoEnv, (req) => fetchApp(req));
  });

  it("starts over with the invented club and its scenes", async () => {
    expect(await one<{ n: number }>("SELECT COUNT(*) AS n FROM persons WHERE id = 9999")).toEqual({ n: 0 });
    expect(await one<{ n: number }>("SELECT COUNT(*) AS n FROM teams")).toEqual({ n: 3 });
    expect(await one<{ n: number }>("SELECT COUNT(*) AS n FROM events WHERE kind = 'game'")).toEqual({ n: 2 });
    // Players accept by default, so only the two declines are stored
    expect(await one<{ n: number }>("SELECT COUNT(*) AS n FROM responses WHERE status = 'no' AND reason IS NOT NULL")).toEqual({ n: 2 });
    expect((await one<{ n: number }>("SELECT COUNT(*) AS n FROM carpool_offers")).n).toBe(1);
    expect((await one<{ n: number }>("SELECT COUNT(*) AS n FROM duties")).n).toBe(1);
    expect(await one<{ n: number }>("SELECT COUNT(*) AS n FROM sessions")).toEqual({ n: 0 });
    expect((await one<{ n: number }>("SELECT COUNT(*) AS n FROM events WHERE kind = 'training'")).n).toBeGreaterThan(0);
  });

  it("is the same again after a second reset", async () => {
    await resetDemo(demoEnv, (req) => fetchApp(req));
    expect(await one<{ n: number }>("SELECT COUNT(*) AS n FROM teams")).toEqual({ n: 3 });
    expect(await one<{ n: number }>("SELECT COUNT(*) AS n FROM events WHERE kind = 'game'")).toEqual({ n: 2 });
  });

  it("signs in as each role by link", async () => {
    for (const [role, personId] of Object.entries(DEMO_ROLES)) {
      const res = await fetchApp(new Request(`https://demo.example/api/demo/login/${role}?lang=en`, { redirect: "manual" }));
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/?lang=en");
      const cookie = res.headers.get("set-cookie")!.split(";")[0]!;
      const session = await fetchApp(new Request("https://demo.example/api/session", { headers: { cookie } }));
      const body = (await session.json()) as { authenticated: boolean; me: { person: { id: number } } };
      expect(body.authenticated).toBe(true);
      expect(body.me.person.id).toBe(personId);
    }
    expect((await fetchApp(new Request("https://demo.example/api/demo/login/hacker", { redirect: "manual" }))).status).toBe(404);
  });

  it("only exists in the demo environment", async () => {
    const res = await fetchApp(new Request("https://demo.example/api/demo/login/admin", { redirect: "manual" }), { ...env, APP_ENV: "production" } as Env);
    expect(res.status).toBe(404);
  });

  it("blocks passkeys, owner handover and mail settings for visitors", async () => {
    const login = await fetchApp(new Request("https://demo.example/api/demo/login/admin", { redirect: "manual" }));
    const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
    for (const [method, path] of [
      ["POST", "/api/me/passkeys/options"],
      ["PUT", "/api/admin/club/owner"],
      ["PUT", "/api/admin/mail"],
      ["PUT", "/api/me/email"],
    ] as const) {
      const res = await fetchApp(new Request(`https://demo.example${path}`, { method, headers: { cookie, "content-type": "application/json" }, body: "{}" }));
      expect(res.status, `${method} ${path}`).toBe(403);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe("demo_restricted");
    }
  });

  it("resets over HTTP only with the token", async () => {
    const post = (authorization?: string) =>
      fetchApp(new Request("https://demo.example/api/demo/reset", { method: "POST", headers: authorization ? { authorization } : {} }));
    expect((await post()).status).toBe(404);
    expect((await post("Bearer wrong-token-0123456789")).status).toBe(404);
    expect((await post("Bearer demo-reset-token-0123456789")).status).toBe(200);
    expect(await rows("SELECT id FROM teams")).toHaveLength(3);
  });
});
