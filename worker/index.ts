import { createBaseApp } from "./app";
import { handleScheduled } from "./cron";
import { demoGuard, demoRoutes } from "./demo/routes";
import { demoLocalHour, resetDemo } from "./demo/reset";
import type { PushJob } from "./domain/notify";
import { t } from "@lingui/core/macro";
import { loadClub, updateInProgress } from "./domain/club";
import { withLocale } from "./i18n";
import { maintenanceState } from "./lib/maintenance";
import { WORKER_MODULES } from "./modules";
import { handleQueue } from "./queue";
import { adminRoutes } from "./routes/admin";
import { authRoutes } from "./routes/auth";
import { avatarRoutes } from "./routes/avatars";
import { chatRoutes } from "./routes/chat";
import { clubRoutes } from "./routes/club";
import { calendarRoutes } from "./routes/calendar";
import { clubMemberRoutes } from "./routes/club-members";
import { emailRoutes } from "./routes/email";
import { eventRoutes } from "./routes/events";
import { feedbackRoutes } from "./routes/feedback";
import { gameImportRoutes } from "./routes/game-import";
import { gameRoutes } from "./routes/games";
import { mailRoutes } from "./routes/mail";
import { setupRoutes } from "./routes/setup";
import { joinRoutes } from "./routes/join";
import { listImportRoutes } from "./routes/list-import";
import { restoreRoutes } from "./routes/restore";
import { parentRoutes } from "./routes/parents";
import { personRoutes } from "./routes/persons";
import { planRoutes } from "./routes/plans";
import { pushRoutes } from "./routes/push";
import { manualGameRoutes } from "./routes/manual-games";
import { seasonRoutes } from "./routes/season";
import { squadRoutes } from "./routes/squad";
import { teamRoutes } from "./routes/teams";
import { updateRoutes } from "./routes/updates";

export { ChatRoom } from "./chat/room";
export { DutyHub } from "./duties/hub";

export const app = createBaseApp();
// env: "staging" makes the app show a banner (see src/env-banner.tsx)
app.get("/api/health", async (c) =>
  c.json({ ok: true, env: c.env.APP_ENV || "production", maintenance: !!updateInProgress() || !!(await maintenanceState(c.env.KV)), updating: !!updateInProgress() }),
);
app.use("/api/*", demoGuard);
for (const routes of [
  demoRoutes((request, env, ctx) => app.fetch(request, env, ctx)),
  clubRoutes,
  authRoutes,
  emailRoutes,
  joinRoutes,
  eventRoutes,
  squadRoutes,
  teamRoutes,
  updateRoutes,
  personRoutes,
  planRoutes,
  adminRoutes,
  parentRoutes,
  pushRoutes,
  chatRoutes,
  gameRoutes,
  gameImportRoutes,
  mailRoutes,
  setupRoutes,
  seasonRoutes,
  avatarRoutes,
  manualGameRoutes,
  calendarRoutes,
  feedbackRoutes,
  clubMemberRoutes,
  listImportRoutes,
  restoreRoutes,
]) {
  app.route("/api", routes);
}
// Routes of the modules; worker/app.ts answers 404 while a module is off (paths in its manifest)
for (const m of WORKER_MODULES) if (m.routes) app.route("/api", m.routes);

/** The public demo (APP_ENV "demo") starts over at 3:00 local time, before the usual hourly run. */
async function runScheduled(env: Env, ctx: ExecutionContext, scheduledTime: number): Promise<void> {
  if (env.APP_ENV === "demo" && demoLocalHour(scheduledTime) === 3) {
    await resetDemo(env, (request) => Promise.resolve(app.fetch(request, env, ctx)), scheduledTime);
  }
  await handleScheduled(env, scheduledTime);
}

/** Local development and tests run on plain http. */
const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$|\.localhost$/;

/**
 * Every request over https: a plain http:// request is redirected (the club's Cloudflare zone may not
 * force it). Pages and static files come from the assets, the API from the app.
 */
export async function handleFetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  if (url.protocol === "http:" && !LOCAL.test(url.hostname)) {
    url.protocol = "https:";
    return Response.redirect(url.toString(), 301);
  }
  if (!url.pathname.startsWith("/api/")) return withLegalLinks(await env.ASSETS.fetch(request), env);
  return app.fetch(request, env, ctx);
}

const escapeAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/**
 * The club's legal notice and privacy policy as plain links in the page shell, so they are there without
 * JavaScript too (the app shows them in its footer). Only HTML pages, so icons and files cost no read.
 */
async function withLegalLinks(res: Response, env: Env): Promise<Response> {
  if (!res.headers.get("content-type")?.startsWith("text/html")) return res;
  let links: string;
  try {
    const club = await loadClub(env.DB);
    links = withLocale(club.defaultLocale, () =>
      [
        club.legalNoticeUrl ? `<a href="${escapeAttr(club.legalNoticeUrl)}">${t`Legal notice`}</a>` : "",
        club.privacyUrl ? `<a href="${escapeAttr(club.privacyUrl)}">${t`Privacy policy`}</a>` : "",
      ]
        .filter(Boolean)
        .join(" · "),
    );
  } catch {
    return res;
  }
  if (!links) return res;
  return new HTMLRewriter().on("noscript", { element: (el) => void el.append(`<p>${links}</p>`, { html: true }) }).transform(res);
}

export default {
  fetch: handleFetch,
  scheduled: (controller, env, ctx) => ctx.waitUntil(runScheduled(env, ctx, controller.scheduledTime)),
  queue: (batch, env) => handleQueue(batch, env),
} satisfies ExportedHandler<Env, PushJob>;
