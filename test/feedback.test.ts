// Hilfe und Feedback: Mail an den Betreuer der App, mit Bild und Antwortwunsch. Namen erfunden.
import { env, exports } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type MailMessage, mailer } from "../worker/domain/email-login";
import { exec, freshDb, guardian, loginAs, member, person, season, team } from "./helpers";

let mails: MailMessage[];
let cookie: string;
let parent: number;

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);

async function send(form: FormData, c = cookie) {
  const res = await exports.default.fetch(new Request("http://localhost:5173/api/feedback", { method: "POST", headers: { cookie: c }, body: form }));
  return { status: res.status, body: (await res.json()) as any };
}

function feedback(message: string, extra: Record<string, string | Blob> = {}) {
  const f = new FormData();
  f.set("message", message);
  for (const [k, v] of Object.entries(extra)) f.set(k, v);
  return f;
}

beforeEach(async () => {
  await freshDb();
  await season();
  const wd = await team("wD", "wD");
  const kim = await person("Kim", { lastName: "Kaiser" });
  parent = await person("Mona", { lastName: "Kaiser" });
  await member(kim, wd);
  await guardian(parent, kim);
  cookie = await loginAs(parent);
  mails = [];
  vi.spyOn(mailer, "send").mockImplementation(async (_env, msg) => void mails.push(msg));
});
afterEach(() => vi.restoreAllMocks());

describe("Hilfe und Feedback", () => {
  it("schickt die Nachricht mit Absender und Rolle, ohne Antwortadresse", async () => {
    const res = await send(feedback("Der Knopf ist zu klein."));
    expect(res).toEqual({ status: 200, body: { ok: true, replyTo: false } });
    expect(mails).toHaveLength(1);
    expect(mails[0]!.to).toBe("feedback@example.org");
    expect(mails[0]!.subject).toBe("Feedback Kabine von Mona Kaiser");
    expect(mails[0]!.text).toContain("Der Knopf ist zu klein.");
    expect(mails[0]!.text).toContain("Elternteil von Kim (wD)");
    expect(mails[0]!.replyTo).toBeUndefined();
    expect(mails[0]!.attachments).toBeUndefined();
  });

  it("hängt ein Bild an und setzt die Antwortadresse nur auf Wunsch und nur bestätigt", async () => {
    await exec("UPDATE accounts SET email = 'mona@example.org', email_verified_at = '2026-01-01T00:00:00Z' WHERE person_id = ?", parent);
    const res = await send(feedback("Siehe Screenshot", { reply: "1", image: new Blob([JPEG], { type: "image/jpeg" }) }));
    expect(res.body).toEqual({ ok: true, replyTo: true });
    expect(mails[0]!.replyTo).toBe("mona@example.org");
    expect(mails[0]!.attachments).toEqual([{ content: JPEG, filename: "bild.jpg", type: "image/jpeg" }]);

    // Ohne Wunsch bleibt die Adresse verborgen
    await send(feedback("Noch etwas"));
    expect(mails[1]!.replyTo).toBeUndefined();
    expect(mails[1]!.text).not.toContain("mona@example.org");
  });

  it("lehnt leere Nachrichten, falsche Dateien und zu viele Rückmeldungen ab", async () => {
    expect((await send(feedback("  "))).body.error.code).toBe("message_required");
    expect((await send(feedback("Datei", { image: new Blob(["kein Bild"], { type: "text/plain" }) }))).body.error.code).toBe("bad_image");
    for (let i = 0; i < 10; i++) expect((await send(feedback(`Nummer ${i}`))).status).toBe(200);
    expect((await send(feedback("Elfte"))).body.error.code).toBe("rate_limited");
    expect(mails).toHaveLength(10);
  });

  it("nur angemeldet", async () => {
    expect((await send(feedback("Hallo"), "")).status).toBe(401);
    expect(env.FEEDBACK_TO).toBe("feedback@example.org");
  });
});
