import { badgeCount } from "./domain/badge";
import { type PushJob, pushConfigured } from "./domain/notify";
import { all, first, list, run } from "./lib/db";
import { loadVapid, type PushSubscriptionRow, sendWebPush } from "./lib/webpush";
import { utcIso } from "./lib/time";

/**
 * Sender contact for the push services (VAPID "sub"): the app's address, not a
 * personal e-mail. Without ORIGIN, the address under which a device last
 * registered for push. Without a registration there is nothing to send.
 */
export async function vapidSubject(env: Env): Promise<string | null> {
  if (env.ORIGIN) return env.ORIGIN;
  return (await first<{ value: string }>(env.DB, "SELECT value FROM app_meta WHERE key = 'app_origin'"))?.value ?? null;
}

export async function handleQueue(batch: MessageBatch<PushJob>, env: Env): Promise<void> {
  const subject = pushConfigured(env) ? await vapidSubject(env) : null;
  if (!subject) {
    batch.ackAll();
    return;
  }
  const vapid = await loadVapid(env.VAPID_PUBLIC_KEY!, env.VAPID_PRIVATE_KEY!, subject);

  for (const message of batch.messages) {
    const job = message.body;
    try {
      const subs = await all<PushSubscriptionRow & { account_id: number }>(
        env.DB,
        "SELECT id, account_id, endpoint, p256dh, auth FROM push_subscriptions WHERE account_id IN (SELECT value FROM json_each(?))",
        list(job.accountIds),
      );
      // Every push carries the current count for the app icon (different per account)
      const payloads = new Map<number, string>();
      for (const accountId of new Set(subs.map((s) => s.account_id))) {
        const badge = await badgeCount(env.DB, accountId).catch(() => null);
        payloads.set(accountId, JSON.stringify(badge ? { ...job.payload, badge: badge.count } : job.payload));
      }
      const outcomes = await Promise.all(
        subs.map(async (s) => {
          try {
            return { id: s.id, outcome: await sendWebPush(s, payloads.get(s.account_id)!, vapid, { urgency: job.payload.tag?.startsWith("chat") ? "normal" : "high" }) };
          } catch (err) {
            console.warn("Push failed", err);
            return { id: s.id, outcome: "failed" as const };
          }
        }),
      );
      const gone = outcomes.filter((o) => o.outcome === "gone").map((o) => o.id);
      if (gone.length) await run(env.DB, "DELETE FROM push_subscriptions WHERE id IN (SELECT value FROM json_each(?))", list(gone));
      const sent = outcomes.filter((o) => o.outcome === "sent").map((o) => o.id);
      if (sent.length) await run(env.DB, "UPDATE push_subscriptions SET last_used_at = ? WHERE id IN (SELECT value FROM json_each(?))", utcIso(), list(sent));
      if (outcomes.some((o) => o.outcome === "retry") && message.attempts < 3) message.retry({ delaySeconds: 30 * message.attempts });
      else message.ack();
    } catch (err) {
      console.error("Push job failed", err);
      message.retry({ delaySeconds: 60 });
    }
  }
}
