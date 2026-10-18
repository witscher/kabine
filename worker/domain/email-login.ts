// Anmeldung per E-Mail: Einmal-Code und Link. Der Passkey bleibt die sicherste
// Variante, die E-Mail ist der Weg für Geräte ohne Passkey und zur Wiederherstellung.
import { loadClub } from "./club";
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
  .max(254, "Die E-Mail-Adresse ist zu lang.")
  .email("Bitte gib eine gültige E-Mail-Adresse ein.");

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  /** Abweichender Anzeigename, z. B. „SVM Helferplan“ (Adresse immer MAIL_FROM). */
  from?: { email: string; name: string };
  replyTo?: string;
  attachments?: { content: ArrayBuffer | Uint8Array; filename: string; type: string }[];
}

/** Versand über Cloudflare Email Service. Als Objekt, damit Tests ihn ersetzen können. */
export const mailer = {
  async send(env: Env, msg: MailMessage): Promise<void> {
    if (!env.EMAIL) {
      // Test installations may run without mail. Logs are kept, so they get neither the text (codes, feedback,
      // names) nor the address, only the subject and a short hash of the recipient.
      if (env.APP_ENV === "staging") {
        console.log(`E-Mail nicht verschickt (kein Versand eingerichtet): ${msg.subject} an ${(await sha256Hex(msg.to)).slice(0, 12)}`);
        return;
      }
      throw new Error("E-Mail-Versand ist nicht eingerichtet (Binding EMAIL fehlt).");
    }
    await env.EMAIL.send({
      from: msg.from ?? { email: env.MAIL_FROM, name: (await loadClub(env.DB)).shortName },
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
      ...(msg.replyTo ? { replyTo: msg.replyTo } : {}),
      ...(msg.attachments?.length ? { attachments: msg.attachments.map((a) => ({ ...a, disposition: "attachment" as const })) } : {}),
    });
  },
};

export interface EmailCodeRow {
  id: number;
  request_id: string;
  purpose: EmailPurpose;
  email: string;
  account_id: number | null;
  context: string | null;
  code_hash: string;
  attempts: number;
  expires_at: string;
  used_at: string | null;
}

function sixDigits(): string {
  // Gleichverteilt: Werte oberhalb des letzten vollen Millionenblocks verwerfen
  const max = Math.floor(0x1_0000_0000 / 1_000_000) * 1_000_000;
  const buf = new Uint32Array(1);
  do crypto.getRandomValues(buf);
  while (buf[0]! >= max);
  return String(buf[0]! % 1_000_000).padStart(6, "0");
}

async function codeHash(env: Env, requestId: string, code: string): Promise<string> {
  return hmacB64url(env.APP_SECRET, `email-code:${requestId}:${code}`);
}

/** Höchstens wenige E-Mails pro Adresse und Absender-IP und Stunde. */
async function rateLimit(env: Env, email: string, ip: string | null): Promise<void> {
  const keys: [string, number][] = [[`mail:to:${await sha256Hex(email)}`, SENDS_PER_ADDRESS_PER_HOUR]];
  if (ip) keys.push([`mail:ip:${await sha256Hex(ip)}`, SENDS_PER_IP_PER_HOUR]);
  for (const [key, limit] of keys) {
    const count = Number((await env.KV.get(key)) ?? 0);
    if (count >= limit) throw conflict("Es wurden gerade viele E-Mails verschickt. Bitte versuche es in einer Stunde noch einmal.", "rate_limited");
  }
  for (const [key] of keys) {
    const count = Number((await env.KV.get(key)) ?? 0);
    await env.KV.put(key, String(count + 1), { expirationTtl: 3600 });
  }
}

const TEXTS: Record<EmailPurpose, { subject: (code: string, app: string) => string; intro: (app: string) => string }> = {
  login: { subject: (code, app) => `${code} ist dein Anmeldecode für ${app}`, intro: () => "hier ist dein Code zum Anmelden" },
  verify: { subject: (code) => `${code}: Bitte bestätige deine E-Mail-Adresse`, intro: (app) => `bitte bestätige deine E-Mail-Adresse für ${app} mit diesem Code` },
  join: { subject: (code, app) => `${code} ist dein Code für den Zugang zu ${app}`, intro: () => "hier ist dein Code, um deinen Zugang einzurichten" },
};

function mailText(purpose: EmailPurpose, code: string, link: string, club: string): string {
  return [
    "Hallo,",
    "",
    `${TEXTS[purpose].intro(club)}:`,
    "",
    `    ${code}`,
    "",
    `Der Code gilt ${CODE_TTL_MS / 60_000} Minuten. Statt den Code einzugeben, kannst du auch diesen Link öffnen:`,
    link,
    "",
    "Nutzt du die App vom Home-Bildschirm, gib den Code am besten direkt dort ein.",
    "",
    "Am sichersten meldest du dich mit einem Passkey an (Face ID, Fingerabdruck oder Gerätesperre). Einrichten kannst du ihn in der App unter Profil, Passkeys und Geräte.",
    "",
    "Du hast das nicht angefordert? Dann ignoriere diese E-Mail einfach.",
    "",
    club,
  ].join("\n");
}

/** Legt einen Code an und verschickt ihn. Gibt die Anfrage-ID für die Code-Eingabe zurück. */
export async function issueEmailCode(
  env: Env,
  input: { purpose: EmailPurpose; email: string; accountId?: number | null; context?: unknown; origin: string; ip: string | null },
  now = Date.now(),
): Promise<string> {
  await rateLimit(env, input.email, input.ip);
  const requestId = randomToken(18);
  const token = randomToken(24);
  const code = sixDigits();
  await run(
    env.DB,
    `INSERT INTO email_codes (request_id, purpose, email, account_id, context, token_hash, code_hash, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    requestId,
    input.purpose,
    input.email,
    input.accountId ?? null,
    input.context === undefined ? null : JSON.stringify(input.context),
    await sha256Hex(token),
    await codeHash(env, requestId, code),
    utcIso(now + CODE_TTL_MS),
  );
  const club = await loadClub(env.DB);
  await mailer.send(env, {
    to: input.email,
    subject: TEXTS[input.purpose].subject(code, club.shortName),
    text: mailText(input.purpose, code, `${input.origin}/email#${token}`, club.name),
  });
  return requestId;
}

const INVALID = "Der Code stimmt nicht oder ist abgelaufen. Bitte fordere einen neuen an.";

/**
 * Prüft Code oder Link, ohne ihn zu verbrauchen (das macht markUsed nach
 * erfolgreicher Anmeldung). Falsche Codes zählen mit, nach fünf ist Schluss.
 */
export async function checkEmailCode(env: Env, by: { requestId: string; code: string } | { token: string }, now = Date.now()): Promise<EmailCodeRow> {
  const row =
    "token" in by
      ? await first<EmailCodeRow>(env.DB, "SELECT * FROM email_codes WHERE token_hash = ?", await sha256Hex(by.token))
      : await first<EmailCodeRow>(env.DB, "SELECT * FROM email_codes WHERE request_id = ?", by.requestId);
  if (!row || row.used_at || Date.parse(row.expires_at) <= now) throw gone(INVALID, "code_invalid");
  if (row.attempts >= MAX_ATTEMPTS) throw gone("Zu viele Fehlversuche. Bitte fordere einen neuen Code an.", "code_invalid");
  if ("code" in by) {
    const expected = await codeHash(env, row.request_id, by.code.replace(/\s/g, ""));
    if (expected !== row.code_hash) {
      await run(env.DB, "UPDATE email_codes SET attempts = attempts + 1 WHERE id = ?", row.id);
      throw badRequest("Der Code stimmt nicht.", "code_wrong");
    }
  }
  return row;
}

export async function markEmailCodeUsed(db: D1Database, id: number): Promise<void> {
  const res = await run(db, "UPDATE email_codes SET used_at = ? WHERE id = ? AND used_at IS NULL", utcIso(), id);
  if (!res.meta.changes) throw gone(INVALID, "code_invalid");
}
