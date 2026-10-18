// Anmeldung und Adressbestätigung per E-Mail-Code oder Link.
import { type Context, Hono } from "hono";
import { z } from "zod";
import { type AppEnv, requireActor } from "../app";
import { createSession, sessionCookie } from "../auth/session";
import { relyingParty } from "../auth/webauthn";
import { checkEmailCode, type EmailCodeRow, emailSchema, issueEmailCode, markEmailCodeUsed } from "../domain/email-login";
import { randomToken } from "../lib/crypto";
import { all, first, run } from "../lib/db";
import { ApiError, badRequest, conflict, gone, parse, readJson } from "../lib/http";
import { utcIso } from "../lib/time";
import { finishJoin, type JoinContext } from "./join";

export const emailRoutes = new Hono<AppEnv>();

function ipOf(request: Request): string | null {
  return request.headers.get("cf-connecting-ip");
}

/** Code anfordern. Die Antwort verrät nicht, ob die Adresse bekannt ist. */
emailRoutes.post("/auth/email/start", async (c) => {
  const { email } = parse(z.object({ email: emailSchema }), await readJson(c.req.raw));
  const known = await first<{ n: number }>(
    c.env.DB,
    `SELECT count(*) AS n FROM accounts a JOIN persons p ON p.id = a.person_id
      WHERE a.email = ? AND a.email_verified_at IS NOT NULL AND a.disabled_at IS NULL AND p.is_former = 0`,
    email,
  );
  if (!known?.n) return c.json({ requestId: randomToken(18) });
  try {
    const requestId = await issueEmailCode(c.env, { purpose: "login", email, origin: relyingParty(c.env, c.req.raw).origin, ip: ipOf(c.req.raw) });
    return c.json({ requestId });
  } catch (err) {
    if (err instanceof ApiError) throw err;
    console.error("Anmelde-E-Mail nicht verschickt", err);
    return c.json({ requestId: randomToken(18) });
  }
});

const verifySchema = z.union([
  z.object({ requestId: z.string().min(10).max(64), code: z.string().trim().min(4).max(12), accountId: z.number().int().positive().optional() }),
  z.object({ token: z.string().min(10).max(100), accountId: z.number().int().positive().optional() }),
]);

async function startSession(c: Context<AppEnv>, accountId: number) {
  const session = await createSession(c.env.DB, accountId, c.req.header("user-agent") ?? null);
  c.header("Set-Cookie", sessionCookie(session.token, session.expiresAt), { append: true });
}

/** Code oder Link einlösen: anmelden, Zugang anlegen oder Adresse bestätigen. */
emailRoutes.post("/auth/email/verify", async (c) => {
  const input = parse(verifySchema, await readJson(c.req.raw));
  const row: EmailCodeRow = await checkEmailCode(c.env, "token" in input ? { token: input.token } : { requestId: input.requestId, code: input.code });

  if (row.purpose === "login") {
    const accounts = await all<{ id: number; first_name: string; last_name: string | null }>(
      c.env.DB,
      `SELECT a.id, p.first_name, p.last_name FROM accounts a JOIN persons p ON p.id = a.person_id
        WHERE a.email = ? AND a.email_verified_at IS NOT NULL AND a.disabled_at IS NULL AND p.is_former = 0
        ORDER BY p.first_name, a.id`,
      row.email,
    );
    if (!accounts.length) throw gone("Zu dieser Adresse gibt es keinen Zugang mehr.", "code_invalid");
    // Mehrere Zugänge mit derselben Adresse (z. B. Familie): erst auswählen lassen
    if (accounts.length > 1 && !input.accountId) {
      return c.json({ choose: accounts.map((a) => ({ accountId: a.id, firstName: a.first_name, lastName: a.last_name })) });
    }
    const account = accounts.find((a) => a.id === (input.accountId ?? accounts[0]!.id));
    if (!account) throw badRequest("Ungültige Auswahl.");
    await markEmailCodeUsed(c.env.DB, row.id);
    await startSession(c, account.id);
    return c.json({ ok: true, kind: "login" });
  }

  if (row.purpose === "join") {
    const context = JSON.parse(row.context!) as JoinContext;
    await markEmailCodeUsed(c.env.DB, row.id);
    const accountId = await finishJoin(c.env, c.req.raw, context, null, true);
    await startSession(c, accountId);
    return c.json({ ok: true, kind: "join" });
  }

  // Adresse bestätigen
  await markEmailCodeUsed(c.env.DB, row.id);
  const res = await run(
    c.env.DB,
    "UPDATE accounts SET email_verified_at = ? WHERE id = ? AND email = ?",
    utcIso(),
    row.account_id,
    row.email,
  );
  if (!res.meta.changes) throw gone("Die Adresse wurde inzwischen geändert. Bitte bestätige die neue Adresse.", "code_invalid");
  return c.json({ ok: true, kind: "verify" });
});

/** Eigene Adresse setzen oder ändern. Gilt für die Anmeldung erst nach der Bestätigung. */
emailRoutes.put("/me/email", async (c) => {
  const actor = requireActor(c);
  const { email } = parse(z.object({ email: emailSchema }), await readJson(c.req.raw));
  const current = await first<{ email: string | null; email_verified_at: string | null }>(
    c.env.DB,
    "SELECT email, email_verified_at FROM accounts WHERE id = ?",
    actor.accountId,
  );
  if (current?.email === email && current.email_verified_at) return c.json({ ok: true, verified: true });
  await run(c.env.DB, "UPDATE accounts SET email = ?, email_verified_at = NULL WHERE id = ?", email, actor.accountId);
  const requestId = await issueEmailCode(c.env, {
    purpose: "verify",
    email,
    accountId: actor.accountId,
    origin: relyingParty(c.env, c.req.raw).origin,
    ip: ipOf(c.req.raw),
  });
  return c.json({ ok: true, verified: false, requestId });
});

emailRoutes.delete("/me/email", async (c) => {
  const actor = requireActor(c);
  const passkeys = await first<{ n: number }>(c.env.DB, "SELECT count(*) AS n FROM passkeys WHERE account_id = ?", actor.accountId);
  if (!passkeys?.n) throw conflict("Ohne Passkey ist die E-Mail-Adresse dein einziger Weg in die App. Richte zuerst einen Passkey ein.");
  await run(c.env.DB, "UPDATE accounts SET email = NULL, email_verified_at = NULL WHERE id = ?", actor.accountId);
  return c.json({ ok: true });
});
