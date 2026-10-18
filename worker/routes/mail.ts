// Mail settings (administration and setup wizard): Cloudflare Email Sending or the club's SMTP server.
import { t } from "@lingui/core/macro";
import { Hono } from "hono";
import { z } from "zod";
import { type AppEnv, requireActor } from "../app";
import { requireAdmin } from "../auth/actor";
import { mailer } from "../domain/email-login";
import { loadMailSettings, saveMailSettings } from "../domain/mail";
import { first } from "../lib/db";
import { badRequest, parse, readJson } from "../lib/http";
import { SmtpError } from "../lib/smtp";

export const mailRoutes = new Hono<AppEnv>();

const view = (s: Awaited<ReturnType<typeof loadMailSettings>>, env: Env) => ({
  mode: s.mode,
  from: s.from,
  defaultFrom: env.MAIL_FROM || null,
  cloudflareAvailable: !!env.EMAIL,
  smtp: s.smtp ? { host: s.smtp.host, port: s.smtp.port, security: s.smtp.security, user: s.smtp.user, hasPassword: !!s.smtp.passwordSealed } : null,
});

mailRoutes.get("/admin/mail", async (c) => {
  requireAdmin(requireActor(c));
  return c.json(view(await loadMailSettings(c.env), c.env));
});

const hostSchema = z
  .string()
  .trim()
  .min(3)
  .max(253)
  .regex(/^[a-z0-9.-]+$/i, { error: () => t`Please enter the server name only, e.g. smtp.example.org.` });

const settingsSchema = z.object({
  mode: z.enum(["cloudflare", "smtp", "off"]),
  from: z.union([z.literal(""), z.string().trim().toLowerCase().max(254).email({ error: () => t`Please type in a valid e-mail address.` })]),
  smtp: z
    .object({
      host: hostSchema,
      port: z.number().int().min(1).max(65535),
      security: z.enum(["tls", "starttls"]),
      user: z.string().trim().min(1).max(254),
      /** empty: keep the stored password */
      password: z.string().max(500).optional(),
    })
    .nullable()
    .optional(),
});

mailRoutes.put("/admin/mail", async (c) => {
  requireAdmin(requireActor(c));
  const input = parse(settingsSchema, await readJson(c.req.raw));
  const previous = await loadMailSettings(c.env);
  if (input.mode === "smtp" && !input.smtp) throw badRequest(t`Please enter the SMTP server.`);
  if (input.mode === "smtp" && !input.smtp?.password && !previous.smtp?.passwordSealed) throw badRequest(t`Please enter the password of the mail account.`);
  if (input.mode !== "off" && !input.from && !c.env.MAIL_FROM) throw badRequest(t`Please enter the sender address.`);
  const saved = await saveMailSettings(c.env, { mode: input.mode, from: input.from, smtp: input.mode === "smtp" ? input.smtp : null }, previous);
  return c.json(view(saved, c.env));
});

/** Sends a test mail to the admin's own confirmed address. */
mailRoutes.post("/admin/mail/test", async (c) => {
  const actor = requireActor(c);
  requireAdmin(actor);
  const account = await first<{ email: string | null; email_verified_at: string | null }>(c.env.DB, "SELECT email, email_verified_at FROM accounts WHERE id = ?", actor.accountId);
  if (!account?.email || !account.email_verified_at) throw badRequest(t`Confirm an e-mail address in your profile first; the test mail goes there.`);
  try {
    await mailer.send(c.env, {
      to: account.email,
      subject: t`Test mail from Kabine`,
      text: t`Hello, this test shows that the app can send e-mails. Nothing else to do.`,
    });
  } catch (err) {
    const detail = err instanceof SmtpError ? err.message : err instanceof Error ? err.message : String(err);
    throw badRequest(t`The test mail could not be sent: ${detail}`, "mail_failed");
  }
  const to = account.email;
  return c.json({ ok: true, to, message: t`Test mail sent to ${to}.` });
});
