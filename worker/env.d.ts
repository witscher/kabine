// Secrets, die nicht in wrangler.jsonc stehen (wrangler secret put / .dev.vars).
interface AppSecrets {
  ADMIN_BOOTSTRAP_TOKEN?: string;
  APP_SECRET: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  /** Empfänger von „Hilfe und Feedback“ (worker/routes/feedback.ts). Nicht im Repository. */
  FEEDBACK_TO?: string;
}

interface Env extends AppSecrets {}

declare namespace Cloudflare {
  interface Env extends AppSecrets {}
}
