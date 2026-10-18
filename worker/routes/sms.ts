// SMS module: provider settings (admins), phone number on the own account, sign-in code by SMS.
// Codes are redeemed like e-mail codes (POST /auth/email/verify).
import { t } from "@lingui/core/macro";
import { Hono } from "hono";
import { z } from "zod";
import { type AppEnv, requireActor } from "../app";
import { requireAdmin } from "../auth/actor";
import { relyingParty } from "../auth/webauthn";
import { issueEmailCode } from "../domain/email-login";
import { loadSmsSettings, saveSmsSettings, sendSmsTo } from "../domain/sms";
import { randomToken } from "../lib/crypto";
import { first, run } from "../lib/db";
import { ApiError, badRequest, conflict, parse, readJson } from "../lib/http";
import { normalizePhone, SmsError, validSender } from "../lib/sms";

export const smsRoutes = new Hono<AppEnv>();

const phoneSchema = z
  .string()
  .trim()
  .max(30)
  .transform((v, ctx) => {
    const phone = normalizePhone(v);
    if (!phone) {
      ctx.addIssue({ code: "custom", message: t`Please enter a mobile number, e.g. +49 151 23456789.` });
      return z.NEVER;
    }
    return phone;
  });

const view = (s: Awaited<ReturnType<typeof loadSmsSettings>>) => ({ provider: s.provider, sender: s.sender, hasApiKey: !!s.apiKeySealed });

smsRoutes.get("/admin/sms", async (c) => {
  requireAdmin(requireActor(c));
  return c.json(view(await loadSmsSettings(c.env.DB)));
});

smsRoutes.put("/admin/sms", async (c) => {
  requireAdmin(requireActor(c));
  const input = parse(
    z.object({
      sender: z.string().trim().refine(validSender, { error: () => t`Sender: at most 11 letters and digits, or a phone number.` }),
      apiKey: z.string().trim().max(200).optional(),
    }),
    await readJson(c.req.raw),
  );
  return c.json(view(await saveSmsSettings(c.env, input)));
});

smsRoutes.post("/admin/sms/test", async (c) => {
  const actor = requireActor(c);
  requireAdmin(actor);
  const account = await first<{ phone: string | null; phone_verified_at: string | null }>(c.env.DB, "SELECT phone, phone_verified_at FROM accounts WHERE id = ?", actor.accountId);
  if (!account?.phone || !account.phone_verified_at) throw badRequest(t`Confirm a phone number in your profile first; the test message goes there.`);
  try {
    await sendSmsTo(c.env, account.phone, t`Test message from Kabine: SMS works.`);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw badRequest(t`The test message could not be sent: ${detail}`, "sms_failed");
  }
  return c.json({ ok: true });
});

/** Sign-in code by SMS. The response does not reveal whether the number is known. */
smsRoutes.post("/auth/sms/start", async (c) => {
  const { phone } = parse(z.object({ phone: phoneSchema }), await readJson(c.req.raw));
  const known = await first<{ n: number }>(
    c.env.DB,
    `SELECT count(*) AS n FROM accounts a JOIN persons p ON p.id = a.person_id
      WHERE a.phone = ? AND a.phone_verified_at IS NOT NULL AND a.disabled_at IS NULL AND p.is_former = 0`,
    phone,
  );
  if (!known?.n) return c.json({ requestId: randomToken(18) });
  try {
    const requestId = await issueEmailCode(c.env, {
      purpose: "login",
      channel: "sms",
      email: phone,
      origin: relyingParty(c.env, c.req.raw).origin,
      ip: c.req.header("cf-connecting-ip") ?? null,
    });
    return c.json({ requestId });
  } catch (err) {
    if (err instanceof ApiError) throw err;
    console.error("Sign-in SMS not sent", err instanceof SmsError ? err.message : err);
    return c.json({ requestId: randomToken(18) });
  }
});

/** Sets the own mobile number; it counts after confirming the code sent to it. */
smsRoutes.put("/me/phone", async (c) => {
  const actor = requireActor(c);
  const { phone } = parse(z.object({ phone: phoneSchema }), await readJson(c.req.raw));
  const current = await first<{ phone: string | null; phone_verified_at: string | null }>(c.env.DB, "SELECT phone, phone_verified_at FROM accounts WHERE id = ?", actor.accountId);
  if (current?.phone === phone && current.phone_verified_at) return c.json({ ok: true, verified: true });
  await run(c.env.DB, "UPDATE accounts SET phone = ?, phone_verified_at = NULL WHERE id = ?", phone, actor.accountId);
  const requestId = await issueEmailCode(c.env, {
    purpose: "verify",
    channel: "sms",
    email: phone,
    accountId: actor.accountId,
    origin: relyingParty(c.env, c.req.raw).origin,
    ip: c.req.header("cf-connecting-ip") ?? null,
  });
  return c.json({ ok: true, verified: false, requestId });
});

smsRoutes.delete("/me/phone", async (c) => {
  const actor = requireActor(c);
  const res = await run(c.env.DB, "UPDATE accounts SET phone = NULL, phone_verified_at = NULL WHERE id = ? AND phone IS NOT NULL", actor.accountId);
  if (!res.meta.changes) throw conflict(t`There is no phone number on your access.`);
  // No SMS channels without a number
  await run(c.env.DB, "UPDATE notification_channels SET sms = 0 WHERE account_id = ?", actor.accountId);
  return c.json({ ok: true });
});
