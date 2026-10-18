// Secrets that are not in wrangler.jsonc (wrangler secret put / .dev.vars).
interface AppSecrets {
  ADMIN_BOOTSTRAP_TOKEN?: string;
  APP_SECRET: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  /** Recipient of "Help and feedback" (worker/routes/feedback.ts). Not in the repository. */
  FEEDBACK_TO?: string;
  /** Only in the demo environment: allows POST /api/demo/reset (worker/demo/routes.ts). */
  DEMO_RESET_TOKEN?: string;
}

interface Env extends AppSecrets {}

declare namespace Cloudflare {
  interface Env extends AppSecrets {}
}
