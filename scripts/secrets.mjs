// Erzeugt einen Satz Secrets für die App (gemeinsam genutzt von
// generate-secrets.mjs und staging.mjs).
import { webcrypto as crypto } from "node:crypto";

const b64url = (buf) => Buffer.from(buf).toString("base64url");
const random = (n) => b64url(crypto.getRandomValues(new Uint8Array(n)));

export async function createSecrets() {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const publicRaw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const privateJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  return {
    APP_SECRET: random(32),
    ADMIN_BOOTSTRAP_TOKEN: random(24),
    VAPID_PUBLIC_KEY: b64url(publicRaw),
    VAPID_PRIVATE_KEY: privateJwk.d,
  };
}
