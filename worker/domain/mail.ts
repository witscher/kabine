// E-mail settings and sending. The club sends either through Cloudflare Email Sending (binding EMAIL)
// or through its own SMTP server (TLS only). The SMTP password is stored encrypted (lib/secret-box).
import { loadClub } from "./club";
import { first, run } from "../lib/db";
import { buildMime } from "../lib/mime";
import { open, seal } from "../lib/secret-box";
import { type SmtpConfig, smtpSend } from "../lib/smtp";

export interface MailSettings {
  /** cloudflare: binding EMAIL; smtp: the club's server; off: no mail (e-mail login unavailable) */
  mode: "cloudflare" | "smtp" | "off";
  /** Sender address; empty: MAIL_FROM of the installation */
  from: string;
  smtp: { host: string; port: number; security: "tls" | "starttls"; user: string; passwordSealed: string | null } | null;
}

const KEY = "mail";

export async function loadMailSettings(env: Pick<Env, "DB" | "EMAIL" | "MAIL_FROM">): Promise<MailSettings> {
  const row = await first<{ value: string }>(env.DB, "SELECT value FROM app_meta WHERE key = ?", KEY);
  if (row) return JSON.parse(row.value) as MailSettings;
  // Not set up yet: Cloudflare if the binding and a sender exist
  return { mode: env.EMAIL && env.MAIL_FROM ? "cloudflare" : "off", from: env.MAIL_FROM ?? "", smtp: null };
}

export async function saveMailSettings(
  env: Pick<Env, "DB" | "APP_SECRET">,
  input: { mode: MailSettings["mode"]; from: string; smtp?: { host: string; port: number; security: "tls" | "starttls"; user: string; password?: string } | null },
  previous: MailSettings,
): Promise<MailSettings> {
  let smtp: MailSettings["smtp"] = null;
  if (input.smtp) {
    // Without a new password the stored one stays (the form never shows it)
    const passwordSealed = input.smtp.password ? await seal(env.APP_SECRET, input.smtp.password) : (previous.smtp?.passwordSealed ?? null);
    smtp = { host: input.smtp.host, port: input.smtp.port, security: input.smtp.security, user: input.smtp.user, passwordSealed };
  }
  const next: MailSettings = { mode: input.mode, from: input.from, smtp };
  await run(env.DB, "INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", KEY, JSON.stringify(next));
  return next;
}

export interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
  fromName?: string;
  replyTo?: string;
  attachments?: { content: ArrayBuffer | Uint8Array; filename: string; type: string }[];
}

export class MailNotConfigured extends Error {}

/** Transport functions, replaceable in tests. */
export const transports = {
  smtp: smtpSend,
};

export async function deliver(env: Env, msg: OutgoingMail): Promise<void> {
  const settings = await loadMailSettings(env);
  const from = settings.from || env.MAIL_FROM;
  if (settings.mode === "off" || !from) throw new MailNotConfigured("E-mail sending is not set up.");
  const fromName = msg.fromName ?? (await loadClub(env.DB)).shortName;
  if (settings.mode === "smtp") {
    if (!settings.smtp?.passwordSealed) throw new MailNotConfigured("SMTP server incomplete.");
    const config: SmtpConfig = {
      host: settings.smtp.host,
      port: settings.smtp.port,
      security: settings.smtp.security,
      user: settings.smtp.user,
      password: await open(env.APP_SECRET, settings.smtp.passwordSealed),
    };
    await transports.smtp(config, { from: { email: from, name: fromName }, to: msg.to, subject: msg.subject, text: msg.text, replyTo: msg.replyTo, attachments: msg.attachments });
    return;
  }
  if (!env.EMAIL) throw new MailNotConfigured("E-mail sending is not set up (binding EMAIL missing).");
  await env.EMAIL.send({
    from: { email: from, name: fromName },
    to: msg.to,
    subject: msg.subject,
    text: msg.text,
    ...(msg.replyTo ? { replyTo: msg.replyTo } : {}),
    ...(msg.attachments?.length ? { attachments: msg.attachments.map((a) => ({ ...a, disposition: "attachment" as const })) } : {}),
  });
}

/** The MIME text of a message, for checks and tests. */
export { buildMime };
