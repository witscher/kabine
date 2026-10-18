// Keys a fresh installation creates itself, so the "Deploy to Cloudflare" button only asks for the
// setup password: APP_SECRET (signed links, sealed passwords) and the VAPID key pair (push).
// Secrets set in Cloudflare (wrangler secret put) take precedence. The generated keys live in their
// own table, which the data export leaves out.
import { first, run } from "./db";

interface Generated {
  APP_SECRET: string;
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
}

let cached: Generated | null = null;

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function createKeys(): Promise<Generated> {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const publicRaw = new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer);
  const privateJwk = (await crypto.subtle.exportKey("jwk", pair.privateKey)) as JsonWebKey;
  return {
    APP_SECRET: b64url(crypto.getRandomValues(new Uint8Array(32))),
    VAPID_PUBLIC_KEY: b64url(publicRaw),
    VAPID_PRIVATE_KEY: privateJwk.d!,
  };
}

/** Fills missing keys of `env` from the generated ones (created once, the first writer wins). */
export async function ensureInstanceSecrets(env: Pick<Env, "DB" | "APP_SECRET" | "VAPID_PUBLIC_KEY" | "VAPID_PRIVATE_KEY">): Promise<void> {
  const hasSecret = !!env.APP_SECRET && env.APP_SECRET.length >= 16;
  const hasVapid = !!env.VAPID_PUBLIC_KEY && !!env.VAPID_PRIVATE_KEY;
  if (hasSecret && hasVapid) return;
  if (!cached) {
    const read = () => first<{ value: string }>(env.DB, "SELECT value FROM instance_secrets WHERE key = 'generated'");
    let row = await read();
    if (!row) {
      await run(env.DB, "INSERT OR IGNORE INTO instance_secrets (key, value) VALUES ('generated', ?)", JSON.stringify(await createKeys()));
      row = await read();
    }
    cached = JSON.parse(row!.value) as Generated;
  }
  if (!hasSecret) env.APP_SECRET = cached.APP_SECRET;
  if (!hasVapid) {
    env.VAPID_PUBLIC_KEY = cached.VAPID_PUBLIC_KEY;
    env.VAPID_PRIVATE_KEY = cached.VAPID_PRIVATE_KEY;
  }
}
