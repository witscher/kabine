import { t } from "@lingui/core/macro";
// Sign-in by e-mail: one-time code and link. The passkey remains the most secure
// option; e-mail is the way for devices without a passkey and for recovery.
import { loadClub } from "./club";
import { deliver, MailNotConfigured } from "./mail";
import { sendText } from "./texts";
import { z } from "zod";
import { hmacB64url, randomToken, safeEqual, sha256Hex } from "../lib/crypto";
import { first, run } from "../lib/db";
import { badRequest, conflict, gone } from "../lib/http";
import { utcIso } from "../lib/time";

export const CODE_TTL_MS = 15 * 60_000;
export const MAX_ATTEMPTS = 5;
const SENDS_PER_ADDRESS_PER_HOUR = 5;
/** With five tries per code this bounds guessing a six-digit code to 50 tries per address and day. */
const SENDS_PER_ADDRESS_PER_DAY = 10;
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
  /** Language of the recipient for the legal footer; without it, the language of the request. */
  locale?: string | null;
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

const rateLimited = () => conflict(t`Many e-mails have just been sent. Please try again in an hour.`, "rate_limited");

/**
 * At most a few codes per sender IP per hour, kept in KV as an extra brake. KV is read, then written, so it is
 * not exact under parallel requests; the limit per address is enforced in the database (issueEmailCode).
 */
async function rateLimitIp(env: Env, ip: string | null): Promise<void> {
  if (!ip) return;
  const key = `mail:ip:${await sha256Hex(ip)}`;
  const count = Number((await env.KV.get(key)) ?? 0);
  if (count >= SENDS_PER_IP_PER_HOUR) throw rateLimited();
  await env.KV.put(key, String(count + 1), { expirationTtl: 3600 });
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

/**
 * Stores a code if the limits allow it, else throws "rate_limited". The limit per address is checked in the same
 * statement that creates the row, so parallel requests cannot get past it (a read, then a write, would let them).
 */
async function bookCode(
  env: Env,
  row: {
    requestId: string;
    purpose: EmailPurpose;
    channel: "email" | "sms";
    address: string;
    accountId: number | null;
    context: string | null;
    tokenHash: string;
    codeHash: string;
    expiresAt: number;
    ip: string | null;
    now: number;
  },
): Promise<void> {
  await rateLimitIp(env, row.ip);
  const created = await run(
    env.DB,
    `INSERT INTO email_codes (request_id, purpose, channel, email, account_id, context, token_hash, code_hash, expires_at)
     SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9
      WHERE (SELECT count(*) FROM email_codes WHERE email = ?4 AND channel = ?3 AND created_at > ?10) < ?11
        AND (SELECT count(*) FROM email_codes WHERE email = ?4 AND channel = ?3 AND created_at > ?12) < ?13`,
    row.requestId,
    row.purpose,
    row.channel,
    row.address,
    row.accountId,
    row.context,
    row.tokenHash,
    row.codeHash,
    utcIso(row.expiresAt),
    utcIso(row.now - 3_600_000),
    SENDS_PER_ADDRESS_PER_HOUR,
    utcIso(row.now - 86_400_000),
    SENDS_PER_ADDRESS_PER_DAY,
  );
  if (!created.meta.changes) throw rateLimited();
}

/**
 * A sign-in request for an address or number that belongs to no access: nothing is sent, but it counts against the
 * same limits as a known one. Otherwise the limit would answer "too many" only for people of the club and so tell
 * who is in it. The row keeps a keyed hash instead of the address and is expired from the start; the hourly
 * clean-up removes it after a day, like every code.
 */
export async function bookUnknownAddress(env: Env, input: { address: string; channel?: "email" | "sms"; ip: string | null }, now = Date.now()): Promise<void> {
  const channel = input.channel ?? "email";
  await bookCode(env, {
    requestId: randomToken(18),
    purpose: "login",
    channel,
    address: `unknown:${await hmacB64url(env.APP_SECRET, `unknown-address:${channel}:${input.address}`)}`,
    accountId: null,
    context: null,
    tokenHash: await sha256Hex(randomToken(24)),
    codeHash: randomToken(24),
    expiresAt: now,
    ip: input.ip,
    now,
  });
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
  const requestId = randomToken(18);
  const token = randomToken(24);
  const code = sixDigits();
  await bookCode(env, {
    requestId,
    purpose: input.purpose,
    channel,
    address: input.email,
    accountId: input.accountId ?? null,
    context: input.context === undefined ? null : JSON.stringify(input.context),
    tokenHash: await sha256Hex(token),
    codeHash: await codeHash(env, requestId, code),
    expiresAt: now + CODE_TTL_MS,
    ip: input.ip,
    now,
  });
  const club = await loadClub(env.DB);
  if (channel === "sms") {
    const app = club.shortName;
    await sendText(env, input.email, t`${code} is your code for ${app}. It is valid for 15 minutes.`);
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
  const tooMany = () => gone(t`Too many failed attempts. Please request a new code.`, "code_invalid");
  if (row.attempts >= MAX_ATTEMPTS) throw tooMany();
  if ("code" in by) {
    // Book the attempt before comparing, in one statement: parallel guesses cannot all read the same count
    const booked = await run(env.DB, "UPDATE email_codes SET attempts = attempts + 1 WHERE id = ? AND attempts < ? AND used_at IS NULL", row.id, MAX_ATTEMPTS);
    if (!booked.meta.changes) throw tooMany();
    const expected = await codeHash(env, row.request_id, by.code.replace(/\s/g, ""));
    if (!safeEqual(expected, row.code_hash)) throw badRequest(t`The code is wrong.`, "code_wrong");
    // A right code costs no attempt: the account chooser checks it twice
    await run(env.DB, "UPDATE email_codes SET attempts = attempts - 1 WHERE id = ? AND attempts > 0", row.id);
  }
  return row;
}

export async function markEmailCodeUsed(db: D1Database, id: number): Promise<void> {
  const res = await run(db, "UPDATE email_codes SET used_at = ? WHERE id = ? AND used_at IS NULL", utcIso(), id);
  if (!res.meta.changes) throw gone(invalid(), "code_invalid");
}
