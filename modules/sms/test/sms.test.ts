// SMS module: provider settings, phone number with confirmation, sign-in code by SMS, helper plan
// reminders by SMS. Numbers invented, provider replaced.
import { env } from "cloudflare:workers";
import { DEFAULT_MODULES } from "../../../shared/modules";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { saveClub } from "../../../worker/domain/club";
import { smsTransport } from "../worker/settings";
import { api, freshDb, loginAs, person, rows, season } from "../../../test/helpers";

let texts: { to: string; text: string; key: string }[];
let adminCookie: string;

beforeEach(async () => {
  await freshDb();
  await season();
  await saveClub(env.DB, { modules: { ...DEFAULT_MODULES, sms: true } });
  adminCookie = await loginAs(await person("Ada", { admin: true }));
  texts = [];
  vi.spyOn(smsTransport, "send").mockImplementation(async (config, to, text) => void texts.push({ to, text, key: config.apiKey }));
});
afterEach(() => vi.restoreAllMocks());

const codeOf = (text: string) => text.match(/\d{6}/)![0];

describe("SMS-Modul", () => {
  it("Anbieter einrichten: Schlüssel verschlüsselt, Absender geprüft", async () => {
    expect((await api("/admin/sms", { method: "PUT", cookie: adminCookie, body: { sender: "SV Musterstadt", apiKey: "k" } })).status).toBe(400);
    const res = await api("/admin/sms", { method: "PUT", cookie: adminCookie, body: { sender: "SVMuster", apiKey: "sk-123" } });
    expect(res.body).toEqual({ provider: "seven", sender: "SVMuster", hasApiKey: true });
    expect((await env.DB.prepare("SELECT value FROM app_meta WHERE key = 'sms'").first<{ value: string }>())!.value).not.toContain("sk-123");
  });

  it("Nummer bestätigen, dann Anmeldung per SMS-Code", async () => {
    await api("/admin/sms", { method: "PUT", cookie: adminCookie, body: { sender: "SVMuster", apiKey: "sk-123" } });
    const mia = await person("Mia");
    const cookie = await loginAs(mia);
    expect((await api("/me/phone", { method: "PUT", cookie, body: { phone: "123" } })).status).toBe(400);
    const set = await api("/me/phone", { method: "PUT", cookie, body: { phone: "0151 2345 6789" } });
    expect(set.body.verified).toBe(false);
    expect(texts[0]).toMatchObject({ to: "+4915123456789", key: "sk-123" });
    expect((await api("/auth/email/verify", { body: { requestId: set.body.requestId, code: codeOf(texts[0]!.text) } })).body.kind).toBe("verify");
    expect(await rows("SELECT phone FROM accounts WHERE person_id = ? AND phone_verified_at IS NOT NULL", mia)).toEqual([{ phone: "+4915123456789" }]);
    // Anmeldung: unbekannte Nummer verrät nichts, bekannte bekommt einen Code
    const unknown = await api("/auth/sms/start", { body: { phone: "+4915199999999" } });
    expect(unknown.body.requestId).toBeTruthy();
    expect(texts).toHaveLength(1);
    const start = await api("/auth/sms/start", { body: { phone: "+49 151 23456789" } });
    expect(texts).toHaveLength(2);
    const login = await api("/auth/email/verify", { body: { requestId: start.body.requestId, code: codeOf(texts[1]!.text) } });
    expect(login.body).toMatchObject({ ok: true, kind: "login" });
  });

  it("Modul aus: Wege gesperrt", async () => {
    await saveClub(env.DB, { modules: { ...DEFAULT_MODULES, sms: false } });
    expect((await api("/auth/sms/start", { body: { phone: "+4915123456789" } })).status).toBe(404);
    expect((await api("/admin/sms", { cookie: adminCookie })).status).toBe(404);
  });
});
