import { describe, expect, it } from "vitest";
import { b64url, fromB64url } from "../worker/lib/crypto";
import { encryptPayload, importP256Private, loadVapid, vapidAuthorization } from "../worker/lib/webpush";

// Testvektoren aus RFC 8291, Abschnitt 5 und Anhang A.
const AS_PUBLIC = "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8";
const AS_PRIVATE = "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw";
const UA_PUBLIC = "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4";
const SALT = "DGv6ra1nlYgDCS1FRnbzlw";
const AUTH = "BTBZMqHH6r4Tts7J_aSIgg";
const PLAINTEXT = "When I grow up, I want to be a watermelon";
const HEADER = "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8";
const CIPHERTEXT = "8pfeW0KbunFT06SuDKoJH9Ql87S1QUrdirN6GcG7sFz1y1sqLgVi1VhjVkHsUoEsbI_0LpXMuGvnzQ";

describe("Web Push (RFC 8291)", () => {
  it("verschlüsselt den Testvektor exakt", async () => {
    const publicKey = fromB64url(AS_PUBLIC);
    const privateKey = await importP256Private(AS_PRIVATE, publicKey, "ECDH");
    const body = await encryptPayload(new TextEncoder().encode(PLAINTEXT), UA_PUBLIC, AUTH, {
      salt: fromB64url(SALT),
      serverKeys: { publicKey, privateKey },
    });
    expect(b64url(body.slice(0, 86))).toBe(HEADER);
    expect(b64url(body.slice(86))).toBe(CIPHERTEXT);
  });

  it("erzeugt mit Zufallswerten einen gültigen Header", async () => {
    const body = await encryptPayload(new TextEncoder().encode("Hallo"), UA_PUBLIC, AUTH);
    expect(body.length).toBe(86 + 5 + 1 + 16);
    expect(new DataView(body.buffer).getUint32(16)).toBe(4096);
    expect(body[20]).toBe(65);
  });

  it("signiert VAPID-JWTs, die sich mit dem öffentlichen Schlüssel prüfen lassen", async () => {
    const vapid = await loadVapid(AS_PUBLIC, AS_PRIVATE, "https://example.org");
    const header = await vapidAuthorization("https://push.example.net/abc", vapid, Date.UTC(2026, 9, 3));
    const match = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(header);
    expect(match).not.toBeNull();
    const [, h, p, s, k] = match!;
    expect(k).toBe(AS_PUBLIC);
    const claims = JSON.parse(new TextDecoder().decode(fromB64url(p!)));
    expect(claims.aud).toBe("https://push.example.net");
    expect(claims.sub).toBe("https://example.org");
    const verifyKey = await crypto.subtle.importKey("raw", fromB64url(AS_PUBLIC), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    const ok = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      verifyKey,
      fromB64url(s!),
      new TextEncoder().encode(`${h}.${p}`),
    );
    expect(ok).toBe(true);
  });
});
