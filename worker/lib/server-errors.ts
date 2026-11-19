// Unexpected server errors (docs/dev/decisions.md, "Server errors"). People never see the error text, only a general
// message, and under overload (e.g. "D1_ERROR: Your account is generating too much load") a hint to try again later.
// Internally the errors of a day go to KV, not D1, because the database may be the part that fails. From the third
// error of a day the owner of the installation gets an e-mail, at most one a day.
import { t } from "@lingui/core/macro";
import { isLocale } from "../../shared/i18n";
import { loadClub } from "../domain/club";
import { mailer } from "../domain/email-login";
import { MailNotConfigured } from "../domain/mail";
import { withLocale } from "../i18n";
import { first } from "./db";
import { todayLocal, toLocal, utcIso } from "./time";

export type ServerErrorKind = "overload" | "error";

export interface ServerErrorEntry {
  /** UTC */
  at: string;
  kind: ServerErrorKind;
  /** e.g. "GET /api/events/:id" or "Cron: Reminders" */
  where: string;
  message: string;
}

export interface ServerErrorDay {
  count: number;
  entries: ServerErrorEntry[];
  alertedAt: string | null;
}

/** From this many errors on one day (club time) the e-mail goes out. */
export const ALERT_THRESHOLD = 3;
/** At most this many errors a day in KV: bounds the writes (KV quota, which sign-in and maintenance mode need too). */
export const MAX_ENTRIES_PER_DAY = 20;
const KEY_PREFIX = "server-errors:";
const RETENTION_SECONDS = 14 * 86_400;

const OVERLOAD = /too much load|overloaded|back off|exceeded timeout|network connection lost|temporarily unavailable|too many requests/i;

export const overloadMessage = () => t`Things are very busy right now. Please try again in a few minutes.`;
export const genericMessage = () => t`Something went wrong. Please try again later.`;

export function errorKind(err: unknown): ServerErrorKind {
  return OVERLOAD.test(errorText(err)) ? "overload" : "error";
}

function errorText(err: unknown): string {
  if (err instanceof Error) {
    // D1 often repeats the message as the cause
    const cause = err.cause instanceof Error && !err.message.includes(err.cause.message) ? ` (${err.cause.message})` : "";
    return `${err.message}${cause}`;
  }
  return String(err);
}

/** Path without ids and tokens (calendar links, invitations, signed addresses), so nothing secret ends up in the mail. */
export function routeLabel(method: string, path: string): string {
  const parts = path.split("/").map((p) => (/^\d+$/.test(p) ? ":id" : p.length >= 16 && /^[\w.-]+$/.test(p) && /\d/.test(p) ? ":token" : p));
  return `${method} ${parts.join("/")}`;
}

export function dayKey(now = Date.now()): string {
  return `${KEY_PREFIX}${todayLocal(now)}`;
}

/** Days on which this isolate saw the maximum already: then not even KV is read. */
const fullDays = new Set<string>();

/**
 * Records the error and, from the third error of the day, tells the owner by e-mail. Never throws: if KV or sending
 * fails, only the log line remains. Counted without a lock (KV has none), so roughly under many simultaneous errors;
 * for "did it happen more often today?" that is enough.
 */
export async function recordServerError(env: Env, where: string, err: unknown, now = Date.now()): Promise<void> {
  const key = dayKey(now);
  if (fullDays.has(key)) return;
  try {
    const record = (await env.KV.get<ServerErrorDay>(key, "json")) ?? { count: 0, entries: [], alertedAt: null };
    if (record.count >= MAX_ENTRIES_PER_DAY) {
      fullDays.add(key);
      return;
    }
    record.count += 1;
    record.entries.push({ at: utcIso(now), kind: errorKind(err), where: where.slice(0, 120), message: errorText(err).replace(/\s+/g, " ").slice(0, 300) });
    if (record.count >= ALERT_THRESHOLD && !record.alertedAt) {
      try {
        if (await alertOwner(env, record, now)) record.alertedAt = utcIso(now);
      } catch (mailErr) {
        // Tried again with the next error
        if (!(mailErr instanceof MailNotConfigured)) console.warn("Server error mail not sent", mailErr);
      }
    }
    await env.KV.put(key, JSON.stringify(record), { expirationTtl: RETENTION_SECONDS });
  } catch (kvErr) {
    console.warn("Server error not recorded", kvErr);
  }
}

/** The errors of a day, e.g. for tests and a later view. */
export async function serverErrorsOn(env: Env, now = Date.now()): Promise<ServerErrorDay | null> {
  return env.KV.get<ServerErrorDay>(dayKey(now), "json");
}

/**
 * Mail to the owner (club profile), to the confirmed e-mail address of their access, in their language. false
 * without an owner or address: then nothing is sent and the next error checks again.
 */
async function alertOwner(env: Env, record: ServerErrorDay, now: number): Promise<boolean> {
  const club = await loadClub(env.DB);
  if (club.ownerPersonId == null) return false;
  const owner = await first<{ email: string; locale: string | null }>(
    env.DB,
    "SELECT email, locale FROM accounts WHERE person_id = ? AND email IS NOT NULL AND email_verified_at IS NOT NULL AND disabled_at IS NULL ORDER BY id LIMIT 1",
    club.ownerPersonId,
  );
  if (!owner) return false;
  const locale = isLocale(owner.locale) ? owner.locale : null;
  const mail = withLocale(locale, () => alertMail(record, club.name, now));
  await mailer.send(env, { to: owner.email, locale, ...mail });
  return true;
}

function shortLocal(at: string): string {
  const local = toLocal(Date.parse(at));
  return `${local.slice(8, 10)}.${local.slice(5, 7)}. ${local.slice(11, 16)}`;
}

export function alertMail(record: ServerErrorDay, club: string, now = Date.now()): { subject: string; text: string } {
  const date = todayLocal(now);
  const day = `${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(0, 4)}`;
  const count = record.count;
  const overload = record.entries.filter((e) => e.kind === "overload").length;
  const max = MAX_ENTRIES_PER_DAY;
  const lines = record.entries.map((e) => `${shortLocal(e.at)}  ${e.kind === "overload" ? t`Overload` : t`Error`}  ${e.where}\n  ${e.message}`);
  const text = [
    overload
      ? t`Today (${day}) ${count} unexpected server errors occurred in ${club} so far, ${overload} of them from overload (e.g. of the database). People only saw a general message.`
      : t`Today (${day}) ${count} unexpected server errors occurred in ${club} so far. People only saw a general message.`,
    "",
    ...lines,
    "",
    t`The full messages are in the logs of the Worker (Cloudflare dashboard → Workers & Pages → this Worker → Logs).`,
    t`This e-mail comes at most once a day. Further errors of today are only counted (at most ${max}).`,
  ].join("\n");
  return { subject: t`${club}: ${count} server errors on ${day}`, text };
}
