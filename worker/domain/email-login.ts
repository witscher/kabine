import { t } from "@lingui/core/macro";
// Sign-in by e-mail: one-time code and link. The passkey remains the most secure
// option; e-mail is the way for devices without a passkey and for recovery.
import { loadClub } from "./club";
import { deliver, MailNotConfigured } from "./mail";
import { sendSmsTo } from "./sms";
import { z } from "zod";
import { hmacB64url, randomToken, sha256Hex } from "../lib/crypto";
import { first, run } from "../lib/db";
import { badRequest, conflict, gone } from "../lib/http";
import { utcIso } from "../lib/time";

export const CODE_TTL_MS = 15 * 60_000;
export const MAX_ATTEMPTS = 5;
const SENDS_PER_ADDRESS_PER_HOUR = 5;
const SENDS_PER_IP_PER_HOUR = 20;

export type EmailPurpose = "login" | "verify" | "join";

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, { error: () => t`The e-mail address is too long.` })
  .email({ error: () => t`Please type in a valid e-mail address.` });

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  /** Different display name, e.g. "SVM helper plan" (the address comes from the mail settings). */
  fromName?: string;
  replyTo?: string;
  attachments?: { content: ArrayBuffer | Uint8Array; filename: string; type: string }[];
}

/** Sending through the club's mail settings (domain/mail.ts). An object so tests can replace it. */
export const mailer = {
  async send(env: Env, msg: MailMessage): Promise<void> {
    try {
      await deliver(env, msg);
    } catch (err) {
      // Test installations may run without mail. Logs are kept, so they get neither the text (codes, feedback,
      // names) nor the address, only the subject and a short hash of the recipient.
      if (err instanceof MailNotConfigured && env.APP_ENV === "staging") {
        console.log(`E-mail not sent (no sending set up): ${msg.subject} to ${(await sha256Hex(msg.to)).slice(0, 12)}`);
        return;
      }
      throw err;
    }
  },
};

export interface EmailCodeRow {
  id: number;
  request_id: string;
  purpose: EmailPurpose;
  channel: "email" | "sms";
  /** Address the code went to: e-mail address or phone number */
  email: string;
  account_id: number | null;
  context: string | null;
  code_hash: string;
  attempts: number;
  expires_at: string;
  used_at: string | null;
}

function sixDigits(): string {
  // Uniform: discard values above the last full block of a million
  const max = Math.floor(0x1_0000_0000 / 1_000_000) * 1_000_000;
  const buf = new Uint32Array(1);
  do crypto.getRandomValues(buf);
  while (buf[0]! >= max);
  return String(buf[0]! % 1_000_000).padStart(6, "0");
}

async function codeHash(env: Env, requestId: string, code: string): Promise<string> {
  return hmacB64url(env.APP_SECRET, `email-code:${requestId}:${code}`);
}

/** At most a few e-mails per address and sender IP per hour. */
async function rateLimit(env: Env, email: string, ip: string | null): Promise<void> {
  const keys: [string, number][] = [[`mail:to:${await sha256Hex(email)}`, SENDS_PER_ADDRESS_PER_HOUR]];
  if (ip) keys.push([`mail:ip:${await sha256Hex(ip)}`, SENDS_PER_IP_PER_HOUR]);
  for (const [key, limit] of keys) {
    const count = Number((await env.KV.get(key)) ?? 0);
    if (count >= limit) throw conflict(t`Many e-mails have just been sent. Please try again in an hour.`, "rate_limited");
  }
  for (const [key] of keys) {
    const count = Number((await env.KV.get(key)) ?? 0);
    await env.KV.put(key, String(count + 1), { expirationTtl: 3600 });
  }
}

const texts = (): Record<EmailPurpose, { subject: (code: string, app: string) => string; intro: (app: string) => string }> => ({
  login: { subject: (code, app) => t`${code} is your sign-in code for ${app}`, intro: () => t`here is your code to sign in:` },
  verify: { subject: (code) => t`${code}: Please confirm your e-mail address`, intro: (app) => t`please confirm your e-mail address for ${app} with this code:` },
  join: { subject: (code, app) => t`${code} is your code for access to ${app}`, intro: () => t`here is your code to set up your access:` },
});

function mailText(purpose: EmailPurpose, code: string, link: string, club: string): string {
  const minutes = CODE_TTL_MS / 60_000;
  return [
    t`Hello,`,
    "",
    texts()[purpose].intro(club),
    "",
    `    ${code}`,
    "",
    t`The code is valid for ${minutes} minutes. Instead of entering the code, you can also open this link:`,
    link,
    "",
    t`If you use the app from the home screen, it is best to enter the code there directly.`,
    "",
    t`The most secure way to sign in is with a passkey (Face ID, fingerprint or device lock). You can set one up in the app under Profile, Passkeys and devices.`,
    "",
    t`You did not request this? Then simply ignore this e-mail.`,
    "",
    club,
  ].join("\n");
}

/** Creates a code and sends it. Returns the request ID for entering the code. */
export async function issueEmailCode(
  env: Env,
  input: {
    purpose: EmailPurpose;
    email: string;
    accountId?: number | null;
    context?: unknown;
    origin: string;
    ip: string | null;
    /** sms: the code goes as a text message to the phone number in `email` (SMS module) */
    channel?: "email" | "sms";
  },
  now = Date.now(),
): Promise<string> {
  const channel = input.channel ?? "email";
  await rateLimit(env, channel === "sms" ? `sms:${input.email}` : input.email, input.ip);
  const requestId = randomToken(18);
  const token = randomToken(24);
  const code = sixDigits();
  await run(
    env.DB,
    `INSERT INTO email_codes (request_id, purpose, channel, email, account_id, context, token_hash, code_hash, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    requestId,
    input.purpose,
    channel,
    input.email,
    input.accountId ?? null,
    input.context === undefined ? null : JSON.stringify(input.context),
    await sha256Hex(token),
    await codeHash(env, requestId, code),
    utcIso(now + CODE_TTL_MS),
  );
  const club = await loadClub(env.DB);
  if (channel === "sms") {
    const app = club.shortName;
    await sendSmsTo(env, input.email, t`${code} is your code for ${app}. It is valid for 15 minutes.`);
    return requestId;
  }
  await mailer.send(env, {
    to: input.email,
    subject: texts()[input.purpose].subject(code, club.shortName),
    text: mailText(input.purpose, code, `${input.origin}/email#${token}`, club.name),
  });
  return requestId;
}

const invalid = () => t`The code is wrong or has expired. Please request a new one.`;

/**
 * Checks a code or link without using it up (markUsed does that after a
 * successful sign-in). Wrong codes are counted; after five it is over.
 */
export async function checkEmailCode(env: Env, by: { requestId: string; code: string } | { token: string }, now = Date.now()): Promise<EmailCodeRow> {
  const row =
    "token" in by
      ? await first<EmailCodeRow>(env.DB, "SELECT * FROM email_codes WHERE token_hash = ?", await sha256Hex(by.token))
      : await first<EmailCodeRow>(env.DB, "SELECT * FROM email_codes WHERE request_id = ?", by.requestId);
  if (!row || row.used_at || Date.parse(row.expires_at) <= now) throw gone(invalid(), "code_invalid");
  if (row.attempts >= MAX_ATTEMPTS) throw gone(t`Too many failed attempts. Please request a new code.`, "code_invalid");
  if ("code" in by) {
    const expected = await codeHash(env, row.request_id, by.code.replace(/\s/g, ""));
    if (expected !== row.code_hash) {
      await run(env.DB, "UPDATE email_codes SET attempts = attempts + 1 WHERE id = ?", row.id);
      throw badRequest(t`The code is wrong.`, "code_wrong");
    }
  }
  return row;
}

export async function markEmailCodeUsed(db: D1Database, id: number): Promise<void> {
  const res = await run(db, "UPDATE email_codes SET used_at = ? WHERE id = ? AND used_at IS NULL", utcIso(), id);
  if (!res.meta.changes) throw gone(invalid(), "code_invalid");
}
