// Anmeldung per E-Mail-Code und Link. Namen und Adressen sind erfunden.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type MailMessage, mailer } from "../worker/domain/email-login";
import { api, exec, freshDb, loginAs, member, one, person, rows, season, team } from "./helpers";

let sent: MailMessage[] = [];

beforeEach(async () => {
  await freshDb();
  await season();
  sent = [];
  vi.spyOn(mailer, "send").mockImplementation(async (_env, msg) => {
    sent.push(msg);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

const codeOf = (msg: MailMessage) => msg.subject.match(/\d{6}/)![0];
const tokenOf = (msg: MailMessage) => msg.text.match(/\/email#([\w-]+)/)![1]!;

async function withEmail(personId: number, email: string, verified = true) {
  await loginAs(personId);
  await exec("UPDATE accounts SET email = ?, email_verified_at = ? WHERE person_id = ?", email, verified ? "2026-01-01T00:00:00Z" : null, personId);
}

/** Setzt einen Request mit dem Session-Cookie aus einer Antwort zusammen. */
async function sessionFrom(res: Response) {
  const cookie = res.headers.get("set-cookie")?.split(";")[0] ?? "";
  return (await api("/session", { cookie })).body;
}

async function rawPost(path: string, body: unknown) {
  const { exports } = await import("cloudflare:workers");
  return exports.default.fetch(
    new Request(`http://localhost:5173/api${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  );
}

describe("Anmeldung per E-Mail", () => {
  it("schickt einen Code an bestätigte Adressen und meldet damit an", async () => {
    const p = await person("Mara");
    await withEmail(p, "mara@example.org");
    const start = await api("/auth/email/start", { body: { email: "Mara@Example.org " } });
    expect(start.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe("mara@example.org");
    const res = await rawPost("/auth/email/verify", { requestId: start.body.requestId, code: codeOf(sent[0]!) });
    expect(res.status).toBe(200);
    expect((await sessionFrom(res)).me.person.id).toBe(p);
    // Der Code gilt nur einmal
    expect((await api("/auth/email/verify", { body: { requestId: start.body.requestId, code: codeOf(sent[0]!) } })).status).toBe(410);
  });

  it("funktioniert auch über den Link", async () => {
    const p = await person("Mara");
    await withEmail(p, "mara@example.org");
    await api("/auth/email/start", { body: { email: "mara@example.org" } });
    const res = await rawPost("/auth/email/verify", { token: tokenOf(sent[0]!) });
    expect((await sessionFrom(res)).me.person.id).toBe(p);
  });

  it("verrät nicht, ob eine Adresse bekannt ist, und ignoriert unbestätigte", async () => {
    const p = await person("Mara");
    await withEmail(p, "offen@example.org", false);
    const unknown = await api("/auth/email/start", { body: { email: "niemand@example.org" } });
    const unverified = await api("/auth/email/start", { body: { email: "offen@example.org" } });
    expect(unknown.status).toBe(200);
    expect(unverified.status).toBe(200);
    expect(typeof unknown.body.requestId).toBe("string");
    expect(sent).toHaveLength(0);
    expect((await api("/auth/email/verify", { body: { requestId: unknown.body.requestId, code: "123456" } })).status).toBe(410);
  });

  it("sperrt den Code nach fünf Fehlversuchen", async () => {
    const p = await person("Mara");
    await withEmail(p, "mara@example.org");
    const start = await api("/auth/email/start", { body: { email: "mara@example.org" } });
    const right = codeOf(sent[0]!);
    const wrong = right === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) {
      expect((await api("/auth/email/verify", { body: { requestId: start.body.requestId, code: wrong } })).status).toBe(400);
    }
    expect((await api("/auth/email/verify", { body: { requestId: start.body.requestId, code: right } })).status).toBe(410);
  });

  it("lässt bei gemeinsamer Adresse den Zugang auswählen", async () => {
    const mum = await person("Mara");
    const kid = await person("Yara");
    await withEmail(mum, "familie@example.org");
    await withEmail(kid, "familie@example.org");
    const start = await api("/auth/email/start", { body: { email: "familie@example.org" } });
    const code = codeOf(sent[0]!);
    const choose = await api("/auth/email/verify", { body: { requestId: start.body.requestId, code } });
    expect(choose.body.choose.map((c: { firstName: string }) => c.firstName)).toEqual(["Mara", "Yara"]);
    const kidAccount = choose.body.choose.find((c: { firstName: string }) => c.firstName === "Yara").accountId;
    const res = await rawPost("/auth/email/verify", { requestId: start.body.requestId, code, accountId: kidAccount });
    expect((await sessionFrom(res)).me.person.id).toBe(kid);
  });

  it("begrenzt die Zahl der E-Mails pro Adresse", async () => {
    const p = await person("Mara");
    await withEmail(p, "mara@example.org");
    for (let i = 0; i < 5; i++) expect((await api("/auth/email/start", { body: { email: "mara@example.org" } })).status).toBe(200);
    const sixth = await api("/auth/email/start", { body: { email: "mara@example.org" } });
    expect(sixth.status).toBe(409);
    expect(sent).toHaveLength(5);
  });
});

describe("Zugang über Einladungslink", () => {
  let wd: number;
  let coach: number;
  let ida: number;

  beforeEach(async () => {
    wd = await team("wD", "wD");
    coach = await person("Trainerin");
    ida = await person("Ida");
    await member(coach, wd, "coach");
    await member(ida, wd);
  });

  async function playerLinkToken() {
    const res = await api(`/teams/${wd}/invites`, { cookie: await loginAs(coach), body: { kind: "player" } });
    return String(res.body.url).split("#")[1]!;
  }

  it("E-Mail-Adresse ist optional, außer für den Code per E-Mail und für Admins", async () => {
    const token = await playerLinkToken();
    // Passkey ohne Adresse: erlaubt (Ersatz später über den persönlichen Link des Trainers)
    expect((await api("/join/options", { body: { token, personId: ida } })).status).toBe(200);
    expect((await api("/join/options", { body: { token, personId: ida, email: "ida@example.org" } })).status).toBe(200);
    // Ungültige Adresse bleibt ein Fehler
    expect((await api("/join/options", { body: { token, personId: ida, email: "kein-mail" } })).status).toBe(400);
    // Code per E-Mail geht nur mit Adresse
    const code = await api("/join/email", { body: { token, personId: ida } });
    expect(code.status).toBe(400);
    expect(code.body.error.code).toBe("email_required");

    // Persönlicher Link für einen Admin ohne Zugang: Adresse Pflicht
    const admin = await person("Ada", { admin: true });
    const other = await person("Alma", { admin: true });
    const link = await api(`/persons/${other}/personal-link`, { cookie: await loginAs(admin), body: { revokeExisting: false } });
    expect(link.status).toBe(201);
    const adminToken = String(link.body.url).split("#")[1]!;
    const res = await api("/join/options", { body: { token: adminToken } });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("email_required");
    expect((await api("/join/options", { body: { token: adminToken, email: "alma@example.org" } })).status).toBe(200);
  });

  it("richtet den Zugang ohne Passkey per Code ein, die Adresse ist danach bestätigt", async () => {
    const token = await playerLinkToken();
    const start = await api("/join/email", { body: { token, personId: ida, email: "ida@example.org" } });
    expect(start.status).toBe(200);
    expect(await rows("SELECT * FROM accounts WHERE person_id = ?", ida)).toHaveLength(0);
    const res = await rawPost("/auth/email/verify", { requestId: start.body.requestId, code: codeOf(sent[0]!) });
    expect(res.status).toBe(200);
    expect((await sessionFrom(res)).me.person.id).toBe(ida);
    const account = await one<{ email: string; email_verified_at: string | null }>("SELECT email, email_verified_at FROM accounts WHERE person_id = ?", ida);
    expect(account.email).toBe("ida@example.org");
    expect(account.email_verified_at).not.toBeNull();
    expect(await rows("SELECT * FROM passkeys")).toHaveLength(0);
  });

  it("Adresse im Profil ändern und bestätigen", async () => {
    const cookie = await loginAs(ida);
    const set = await api("/me/email", { cookie, method: "PUT", body: { email: "neu@example.org" } });
    expect(set.body.verified).toBe(false);
    expect((await api("/me/security", { cookie })).body).toMatchObject({ email: "neu@example.org", emailVerified: false });
    expect((await api("/auth/email/verify", { body: { requestId: set.body.requestId, code: codeOf(sent[0]!) } })).body.kind).toBe("verify");
    expect((await api("/me/security", { cookie })).body.emailVerified).toBe(true);
    // Ohne Passkey bleibt die Adresse der einzige Weg in die App
    expect((await api("/me/email", { cookie, method: "DELETE" })).status).toBe(409);
  });
});
