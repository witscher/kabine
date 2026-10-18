// Mail settings and sending: Cloudflare binding or the club's SMTP server. Addresses invented.
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mailer } from "../worker/domain/email-login";
import { deliver, loadMailSettings, transports } from "../worker/domain/mail";
import { api, exec, freshDb, loginAs, person, season } from "./helpers";

let adminCookie: string;
let admin: number;

beforeEach(async () => {
  await freshDb();
  await season();
  admin = await person("Ada", { admin: true });
  adminCookie = await loginAs(admin);
});
afterEach(() => vi.restoreAllMocks());

describe("E-Mail-Versand", () => {
  it("SMTP: Passwort verschlüsselt gespeichert, nie ausgeliefert, beim Versand entschlüsselt", async () => {
    const smtp = { host: "smtp.example.org", port: 587, security: "starttls", user: "verein@example.org", password: "geheim" };
    const res = await api("/admin/mail", { method: "PUT", cookie: adminCookie, body: { mode: "smtp", from: "app@example.org", smtp } });
    expect(res.status).toBe(200);
    expect(res.body.smtp).toEqual({ host: "smtp.example.org", port: 587, security: "starttls", user: "verein@example.org", hasPassword: true });
    expect(JSON.stringify(res.body)).not.toContain("geheim");
    const stored = await env.DB.prepare("SELECT value FROM app_meta WHERE key = 'mail'").first<{ value: string }>();
    expect(stored!.value).not.toContain("geheim");
    // Speichern ohne Passwort behält das bisherige
    await api("/admin/mail", { method: "PUT", cookie: adminCookie, body: { mode: "smtp", from: "app@example.org", smtp: { ...smtp, password: "" } } });
    const sent: any[] = [];
    vi.spyOn(transports, "smtp").mockImplementation(async (config, msg) => void sent.push({ config, msg }));
    await deliver(env, { to: "mia@example.org", subject: "Hallo", text: "Test" });
    expect(sent[0].config).toMatchObject({ host: "smtp.example.org", password: "geheim", security: "starttls" });
    expect(sent[0].msg).toMatchObject({ from: { email: "app@example.org", name: "Kabine" }, to: "mia@example.org" });
  });

  it("prüft die Eingaben und lässt nur Admins", async () => {
    const other = await loginAs(await person("Pia"));
    expect((await api("/admin/mail", { cookie: other })).status).toBe(403);
    expect((await api("/admin/mail", { method: "PUT", cookie: adminCookie, body: { mode: "smtp", from: "app@example.org" } })).status).toBe(400);
    const badHost = { host: "https://smtp", port: 587, security: "starttls", user: "u", password: "p" };
    expect((await api("/admin/mail", { method: "PUT", cookie: adminCookie, body: { mode: "smtp", from: "app@example.org", smtp: badHost } })).status).toBe(400);
    expect((await api("/admin/mail", { method: "PUT", cookie: adminCookie, body: { mode: "off", from: "" } })).status).toBe(200);
    expect((await loadMailSettings(env)).mode).toBe("off");
  });

  it("Testmail an die eigene bestätigte Adresse, Fehler mit Grund", async () => {
    expect((await api("/admin/mail/test", { cookie: adminCookie, body: {} })).status).toBe(400);
    await exec("UPDATE accounts SET email = 'ada@example.org', email_verified_at = '2026-01-01T00:00:00Z' WHERE person_id = ?", admin);
    const mails: any[] = [];
    vi.spyOn(mailer, "send").mockImplementation(async (_e, m) => void mails.push(m));
    const ok = await api("/admin/mail/test", { cookie: adminCookie, body: {} });
    expect(ok.body).toMatchObject({ ok: true, to: "ada@example.org" });
    expect(mails[0].to).toBe("ada@example.org");
    vi.spyOn(mailer, "send").mockRejectedValue(new Error("535 Authentication failed"));
    const failed = await api("/admin/mail/test", { cookie: adminCookie, body: {} });
    expect(failed.body.error.code).toBe("mail_failed");
    expect(failed.body.error.message).toContain("535");
  });
});
