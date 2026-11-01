// Routes of the public demo installation (APP_ENV "demo"); in every other environment they do not exist.
//   GET  /api/demo/login/:role?lang=de|en  signs in as the demo person of a role and opens the app
//   POST /api/demo/reset                   wipes and fills the demo again (Bearer DEMO_RESET_TOKEN)
// Everything that could lock others out or reach outside the demo (passkeys, e-mail, SMS, owner
// handover, invitations, the links in the club profile) is blocked by demoGuard.
import { t } from "@lingui/core/macro";
import { type ExecutionContext as HonoExecutionContext, Hono } from "hono";
import type { AppEnv } from "../app";
import { sessionCookie } from "../auth/session";
import { loadClub } from "../domain/club";
import { safeEqual } from "../lib/crypto";
import { ApiError, forbidden } from "../lib/http";
import { DEMO_ROLES, type DemoRole, demoSession, resetDemo } from "./reset";

export const isDemo = (env: Env): boolean => env.APP_ENV === "demo";

const BLOCKED: RegExp[] = [
  // locale: the demo accounts are shared, a visitor's language stays on the visitor's device
  /^\/api\/me\/(passkeys|sessions|email|phone|locale)/,
  /^\/api\/auth\/(email|sms)\//,
  /^\/api\/admin\/(mail|sms)/,
  /^\/api\/admin\/club\/owner$/,
  /^\/api\/(join|bootstrap)\/(email|verify|options|link-children)/,
  /^\/api\/bootstrap\//,
  /^\/api\/feedback$/,
  // No photos: visitors would show real faces to everyone until the next reset
  /^\/api\/persons\/\d+\/avatar/,
  /^\/api\/admin\/club\/logo$/,
];

/** Blocks the routes a visitor must not use in the demo (reading stays possible). */
export const demoGuard = async (c: import("hono").Context<AppEnv>, next: () => Promise<void>) => {
  if (isDemo(c.env) && c.req.method !== "GET" && BLOCKED.some((re) => re.test(c.req.path))) {
    throw forbidden(t`This is not available in the demo.`, "demo_restricted");
  }
  if (isDemo(c.env) && c.req.method === "PUT" && c.req.path === "/api/admin/club" && (await changesFixedClubSettings(c))) {
    throw forbidden(t`This is not available in the demo.`, "demo_restricted");
  }
  await next();
};

/**
 * The links in the club profile lead every visitor somewhere (legal notice and privacy policy of the demo,
 * source code), and handball4all would load data from a third party: visitors cannot change them.
 */
async function changesFixedClubSettings(c: import("hono").Context<AppEnv>): Promise<boolean> {
  let body: Record<string, unknown>;
  try {
    body = (await c.req.raw.clone().json()) as Record<string, unknown>;
  } catch {
    return false;
  }
  const club = await loadClub(c.env.DB);
  const links = ["legalNoticeUrl", "privacyUrl", "sourceUrl"] as const;
  if (links.some((k) => k in body && (body[k] || null) !== club[k])) return true;
  return (body.modules as Record<string, unknown> | undefined)?.handball4all === true;
}

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
