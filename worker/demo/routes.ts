// Routes of the public demo installation (APP_ENV "demo"); in every other environment they do not exist.
//   GET  /api/demo/login/:role?lang=de|en  signs in as the demo person of a role and opens the app
//   POST /api/demo/reset                   wipes and fills the demo again (Bearer DEMO_RESET_TOKEN)
// Everything that could lock others out or reach outside the demo (passkeys, e-mail, SMS, owner
// handover, invitations) is blocked by demoGuard.
import { t } from "@lingui/core/macro";
import { type ExecutionContext as HonoExecutionContext, Hono } from "hono";
import type { AppEnv } from "../app";
import { sessionCookie } from "../auth/session";
import { safeEqual } from "../lib/crypto";
import { ApiError, forbidden } from "../lib/http";
import { DEMO_ROLES, type DemoRole, demoSession, resetDemo } from "./reset";

export const isDemo = (env: Env): boolean => env.APP_ENV === "demo";

const BLOCKED: RegExp[] = [
  /^\/api\/me\/(passkeys|sessions|email|phone)/,
  /^\/api\/auth\/(email|sms)\//,
  /^\/api\/admin\/(mail|sms)/,
  /^\/api\/admin\/club\/owner$/,
  /^\/api\/(join|bootstrap)\/(email|verify|options|link-children)/,
  /^\/api\/bootstrap\//,
  /^\/api\/feedback$/,
];

/** Blocks the routes a visitor must not use in the demo (reading stays possible). */
export const demoGuard = async (c: import("hono").Context<AppEnv>, next: () => Promise<void>) => {
  if (isDemo(c.env) && c.req.method !== "GET" && BLOCKED.some((re) => re.test(c.req.path))) {
    throw forbidden(t`This is not available in the demo.`, "demo_restricted");
  }
  await next();
};

export function demoRoutes(fetchApp: (request: Request, env: Env, ctx: HonoExecutionContext) => Response | Promise<Response>) {
  const routes = new Hono<AppEnv>();

  routes.get("/demo/login/:role", async (c) => {
    if (!isDemo(c.env)) throw new ApiError(404, "not_found", t`Unknown endpoint.`);
    const role = c.req.param("role");
    if (!(role in DEMO_ROLES)) throw new ApiError(404, "not_found", t`Unknown endpoint.`);
    const session = await demoSession(c.env, role as DemoRole, c.req.header("user-agent") ?? null);
    const lang = c.req.query("lang");
    c.header("Set-Cookie", sessionCookie(session.token, session.expiresAt), { append: true });
    return c.redirect(lang === "de" || lang === "en" ? `/?lang=${lang}` : "/", 302);
  });

  routes.post("/demo/reset", async (c) => {
    const expected = c.env.DEMO_RESET_TOKEN;
    const given = /^Bearer (.+)$/.exec(c.req.header("authorization") ?? "")?.[1] ?? "";
    if (!isDemo(c.env) || !expected || expected.length < 16 || !safeEqual(given, expected)) {
      throw new ApiError(404, "not_found", t`Unknown endpoint.`);
    }
    await resetDemo(c.env, (req) => Promise.resolve(fetchApp(req, c.env, c.executionCtx)));
    return c.json({ ok: true });
  });

  return routes;
}
