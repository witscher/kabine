// Unexpected server errors (worker/lib/server-errors.ts): people never see the error text; errors are counted per day
// in KV, and from the third error of a day the owner gets one e-mail. Names and addresses invented.
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBaseApp } from "../worker/app";
import { saveClub } from "../worker/domain/club";
import { type MailMessage, mailer } from "../worker/domain/email-login";
import { ApiError } from "../worker/lib/http";
import { ALERT_THRESHOLD, dayKey, errorKind, MAX_ENTRIES_PER_DAY, recordServerError, routeLabel, serverErrorsOn } from "../worker/lib/server-errors";
import { exec, freshDb, loginAs, person } from "./helpers";

const OVERLOAD = new Error("D1_ERROR: Your account is generating too much load on D1 DBs. Please back off and try again later.");
/** Fixed days, so the tests do not get in the way of "today" (club time zone Europe/Berlin). */
const DAY1 = Date.parse("2030-03-04T09:00:00Z");
const DAY2 = Date.parse("2030-03-05T09:00:00Z");
const DAY_FULL = Date.parse("2030-03-06T09:00:00Z");

let mails: MailMessage[];
let owner: number;

beforeEach(async () => {
  await freshDb();
  owner = await person("Olga");
  await loginAs(owner);
  await exec("UPDATE accounts SET email = 'olga@example.org', email_verified_at = '2026-01-01T00:00:00Z' WHERE person_id = ?", owner);
  await saveClub(env.DB, { ownerPersonId: owner });
  mails = [];
  vi.spyOn(mailer, "send").mockImplementation(async (_env, msg) => void mails.push(msg));
  for (const day of [DAY1, DAY2, DAY_FULL, Date.now()]) await env.KV.delete(dayKey(day));
});
afterEach(() => vi.restoreAllMocks());

describe("classifying", () => {
  it("recognises overload of the database", () => {
    expect(errorKind(OVERLOAD)).toBe("overload");
    expect(errorKind(new Error("D1_ERROR: Network connection lost."))).toBe("overload");
    expect(errorKind(new Error("D1_ERROR: no such column: foo: SQLITE_ERROR"))).toBe("error");
    expect(errorKind(new TypeError("Cannot read properties of undefined"))).toBe("error");
  });

  it("takes ids and tokens out of the path", () => {
    expect(routeLabel("GET", "/api/events/123/squad")).toBe("GET /api/events/:id/squad");
    expect(routeLabel("GET", "/api/calendar/aB3dEf9hIjKlMnOpQr.ics")).toBe("GET /api/calendar/:token");
    expect(routeLabel("POST", "/api/season-change/preview")).toBe("POST /api/season-change/preview");
  });
});

describe("recording and telling the owner", () => {
  it("counts per day and mails the owner once from the third error, in their language", async () => {
    for (let i = 0; i < ALERT_THRESHOLD - 1; i++) await recordServerError(env, "GET /api/events", OVERLOAD, DAY1 + i * 60_000);
    expect(mails).toHaveLength(0);

    await recordServerError(env, "Cron: Reminders", new Error("broken"), DAY1 + 600_000);
    expect(mails).toHaveLength(1);
    expect(mails[0]!.to).toBe("olga@example.org");
    expect(mails[0]!.subject).toMatch(/: 3 Serverfehler am 04\.03\.2030$/);
    expect(mails[0]!.text).toContain("davon 2 durch Überlast");
    expect(mails[0]!.text).toContain("10:00  Überlast  GET /api/events");
    expect(mails[0]!.text).toContain("10:10  Fehler  Cron: Reminders\n  broken");

    // More errors on the same day: counted, no second mail
    await recordServerError(env, "GET /api/events", OVERLOAD, DAY1 + 700_000);
    expect(mails).toHaveLength(1);
    const day = await serverErrorsOn(env, DAY1);
    expect(day?.count).toBe(4);
    expect(day?.alertedAt).not.toBeNull();

    // The next day counting starts again
    await recordServerError(env, "GET /api/events", OVERLOAD, DAY2);
    expect((await serverErrorsOn(env, DAY2))?.count).toBe(1);
    expect(mails).toHaveLength(1);
  });

  it("an owner who chose English gets the mail in English", async () => {
    await exec("UPDATE accounts SET locale = 'en' WHERE person_id = ?", owner);
    for (let i = 0; i < ALERT_THRESHOLD; i++) await recordServerError(env, "GET /api/x", new Error("x"), DAY1 + i);
    expect(mails[0]!.subject).toMatch(/: 3 server errors on 04\.03\.2030$/);
    expect(mails[0]!.locale).toBe("en");
  });

  it("without a confirmed address of the owner nothing is sent, and the next error checks again", async () => {
    await exec("UPDATE accounts SET email_verified_at = NULL WHERE person_id = ?", owner);
    for (let i = 0; i < ALERT_THRESHOLD; i++) await recordServerError(env, "GET /api/x", new Error("x"), DAY1 + i);
    expect(mails).toHaveLength(0);
    expect((await serverErrorsOn(env, DAY1))?.alertedAt).toBeNull();
    await exec("UPDATE accounts SET email_verified_at = '2026-01-01T00:00:00Z' WHERE person_id = ?", owner);
    await recordServerError(env, "GET /api/x", new Error("x"), DAY1 + 10);
    expect(mails).toHaveLength(1);
  });

  it("tries the mail again with the next error when sending fails", async () => {
    vi.spyOn(mailer, "send").mockRejectedValueOnce(new Error("sending disturbed"));
    for (let i = 0; i < ALERT_THRESHOLD; i++) await recordServerError(env, "GET /api/x", new Error("x"), DAY1 + i);
    expect((await serverErrorsOn(env, DAY1))?.alertedAt).toBeNull();
    await recordServerError(env, "GET /api/x", new Error("x"), DAY1 + 10);
    expect(mails).toHaveLength(1);
    expect((await serverErrorsOn(env, DAY1))?.alertedAt).not.toBeNull();
  });

  it("records at most 20 errors a day", async () => {
    for (let i = 0; i < MAX_ENTRIES_PER_DAY + 5; i++) await recordServerError(env, "GET /api/x", new Error(`error ${i}`), DAY_FULL + i);
    const day = await serverErrorsOn(env, DAY_FULL);
    expect(day?.count).toBe(MAX_ENTRIES_PER_DAY);
    expect(day?.entries).toHaveLength(MAX_ENTRIES_PER_DAY);
    expect(mails).toHaveLength(1);
  });

  it("names a cause only when it adds something", async () => {
    const d1 = new Error("D1_ERROR: no such table: x: SQLITE_ERROR", { cause: new Error("no such table: x: SQLITE_ERROR") });
    const wrapped = new Error("Fetch failed", { cause: new Error("Timeout") });
    await recordServerError(env, "GET /api/a", d1, DAY2);
    await recordServerError(env, "GET /api/b", wrapped, DAY2 + 1);
    expect((await serverErrorsOn(env, DAY2))?.entries.map((e) => e.message)).toEqual(["D1_ERROR: no such table: x: SQLITE_ERROR", "Fetch failed (Timeout)"]);
  });

  it("never throws, also when KV fails", async () => {
    vi.spyOn(env.KV, "get").mockRejectedValueOnce(new Error("KV unreachable"));
    await expect(recordServerError(env, "GET /api/x", new Error("x"), DAY2)).resolves.toBeUndefined();
  });
});

describe("answer to people", () => {
  function appThrowing(err: unknown) {
    const app = createBaseApp();
    app.get("/api/broken/:id", () => {
      throw err;
    });
    return app;
  }

  async function call(err: unknown) {
    const pending: Promise<unknown>[] = [];
    const ctx = { waitUntil: (p: Promise<unknown>) => void pending.push(p), passThroughOnException: () => undefined, props: {} };
    const res = await appThrowing(err).request("http://localhost/api/broken/42", {}, env, ctx as unknown as ExecutionContext);
    await Promise.all(pending);
    return { status: res.status, body: (await res.json()) as { error: { code: string; message: string } } };
  }

  it("under overload a hint, never the error text, and the error is recorded", async () => {
    const res = await call(OVERLOAD);
    expect(res).toEqual({ status: 503, body: { error: { code: "overloaded", message: "Gerade ist sehr viel los. Bitte versuche es in ein paar Minuten noch einmal." } } });
    expect(JSON.stringify(res.body)).not.toContain("D1_ERROR");
    expect((await serverErrorsOn(env))?.entries.at(-1)).toMatchObject({ kind: "overload", where: "GET /api/broken/:id" });
  });

  it("other errors get the general message", async () => {
    const res = await call(new Error("D1_ERROR: no such table: secret: SQLITE_ERROR"));
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe("internal");
    expect(JSON.stringify(res.body)).not.toContain("secret");
  });

  it("expected errors (ApiError) stay as they are and are not counted", async () => {
    const res = await call(new ApiError(409, "conflict", "Exists already."));
    expect(res).toEqual({ status: 409, body: { error: { code: "conflict", message: "Exists already." } } });
    expect(await serverErrorsOn(env)).toBeNull();
  });
});
