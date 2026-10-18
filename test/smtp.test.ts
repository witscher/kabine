// SMTP client and MIME against a scripted server; sealed settings. Addresses invented.
import { describe, expect, it } from "vitest";
import { buildMime, dotStuff, encodeHeaderWord } from "../worker/lib/mime";
import { open, seal } from "../worker/lib/secret-box";
import { type SmtpConfig, type SmtpConnection, SmtpError, smtpSend } from "../worker/lib/smtp";

/** Server that answers each client line from a script and records what it received. */
function scripted(script: (line: string, state: { tls: boolean }) => string | null, greeting = "220 mail.example.org ESMTP\r\n") {
  const received: string[] = [];
  const state = { tls: false, closed: false };
  let pending: string[] = [greeting];
  let inData = false;
  let data = "";
  const make = (): SmtpConnection => ({
    async read() {
      while (!pending.length) await new Promise((r) => setTimeout(r, 1));
      return pending.shift()!;
    },
    async write(chunk) {
      if (inData) {
        data += chunk;
        if (data.endsWith("\r\n.\r\n")) {
          inData = false;
          received.push(`<DATA ${data.length} bytes>`);
          pending.push("250 2.0.0 queued\r\n");
        }
        return;
      }
      for (const line of chunk.split("\r\n").filter(Boolean)) {
        received.push(line);
        if (line === "DATA") inData = true;
        const reply = script(line, state);
        if (reply) pending.push(reply);
      }
    },
    startTls() {
      state.tls = true;
      return make();
    },
    async close() {
      state.closed = true;
    },
  });
  return { dial: () => make(), received, state, data: () => data };
}

const config: SmtpConfig = { host: "mail.example.org", port: 587, security: "starttls", user: "verein@example.org", password: "geheim" };
const message = { from: { email: "no-reply@example.org", name: "SV Musterstadt" }, to: "mia@example.org", subject: "Dein Code: 123456", text: "Hallo Mia,\n.\nTschüss" };

function standard(line: string, state: { tls: boolean }) {
  if (line.startsWith("EHLO")) return state.tls ? "250-mail.example.org\r\n250-AUTH LOGIN PLAIN\r\n250 SIZE 1000000\r\n" : "250-mail.example.org\r\n250 STARTTLS\r\n";
  if (line === "STARTTLS") return "220 Ready to start TLS\r\n";
  if (line.startsWith("AUTH PLAIN")) return "235 OK\r\n";
  if (line.startsWith("MAIL FROM") || line.startsWith("RCPT TO")) return "250 OK\r\n";
  if (line === "DATA") return "354 Go ahead\r\n";
  if (line === "QUIT") return "221 Bye\r\n";
  return "500 Unknown\r\n";
}

describe("SMTP", () => {
  it("sendet über STARTTLS mit AUTH PLAIN", async () => {
    const server = scripted(standard);
    await smtpSend(config, message, server.dial);
    expect(server.state.tls).toBe(true);
    expect(server.received).toEqual([
      "EHLO example.org",
      "STARTTLS",
      "EHLO example.org",
      `AUTH PLAIN ${btoa("\0verein@example.org\0geheim")}`,
      "MAIL FROM:<no-reply@example.org>",
      "RCPT TO:<mia@example.org>",
      "DATA",
      expect.stringMatching(/^<DATA \d+ bytes>$/),
      "QUIT",
    ]);
    expect(server.state.closed).toBe(true);
  });

  it("verweigert Server ohne STARTTLS und meldet abgelehnte Anmeldung", async () => {
    const noTls = scripted((line) => (line.startsWith("EHLO") ? "250 mail.example.org\r\n" : "500 x\r\n"));
    await expect(smtpSend(config, message, noTls.dial)).rejects.toThrow("STARTTLS");
    expect(noTls.received).not.toContain(expect.stringMatching(/^AUTH/));
    const badLogin = scripted((line, s) => (line.startsWith("AUTH") ? "535 5.7.8 Authentication failed\r\n" : standard(line, s)));
    const err = await smtpSend(config, message, badLogin.dial).catch((e) => e);
    expect(err).toBeInstanceOf(SmtpError);
    expect(err.code).toBe(535);
  });

  it("AUTH LOGIN, wenn PLAIN fehlt; implizites TLS", async () => {
    const server = scripted((line, s) => {
      if (line.startsWith("EHLO")) return "250-mail.example.org\r\n250 AUTH LOGIN\r\n";
      if (line === "AUTH LOGIN") return "334 VXNlcm5hbWU6\r\n";
      if (line === btoa("verein@example.org")) return "334 UGFzc3dvcmQ6\r\n";
      if (line === btoa("geheim")) return "235 OK\r\n";
      return standard(line, s);
    });
    await smtpSend({ ...config, port: 465, security: "tls" }, message, server.dial);
    expect(server.received).not.toContain("STARTTLS");
  });

  it("MIME: UTF-8 kodiert, Punkte am Zeilenanfang verdoppelt, Anhang", () => {
    const mime = buildMime({
      ...message,
      date: new Date("2026-10-18T10:00:00Z"),
      messageId: "x@example.org",
      boundary: "b",
      attachments: [{ content: new Uint8Array([1, 2, 3]), filename: "bild.jpg", type: "image/jpeg" }],
    });
    expect(mime).toContain(`Subject: Dein Code: 123456`);
    expect(mime).toContain(`From: "SV Musterstadt" <no-reply@example.org>`);
    expect(mime).toContain(`Content-Type: multipart/mixed; boundary="b"`);
    expect(mime).toContain(btoa(String.fromCharCode(...new TextEncoder().encode(message.text))));
    expect(mime).toContain("AQID");
    expect(encodeHeaderWord("Grüße")).toBe(`=?UTF-8?B?${btoa(String.fromCharCode(...new TextEncoder().encode("Grüße")))}?=`);
    expect(dotStuff("a\r\n.b\r\n..c")).toBe("a\r\n..b\r\n...c");
    expect(() => buildMime({ ...message, subject: "x\r\nBcc: evil@example.org" })).toThrow();
  });

  it("verschlüsselt Einstellungen mit APP_SECRET", async () => {
    const sealed = await seal("test-app-secret-0123456789abcdef", "geheim");
    expect(sealed).not.toContain("geheim");
    expect(await open("test-app-secret-0123456789abcdef", sealed)).toBe("geheim");
    await expect(open("anderes-secret-0123456789abcdef", sealed)).rejects.toThrow();
  });
});
