import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { cleanup, sendDeadlineReminders } from "../worker/cron";
import { recipientsForCoaches, recipientsForPersons } from "../worker/domain/notify";
import { localToInstant } from "../worker/lib/time";
import { vapidSubject } from "../worker/queue";
import { api, exec, freshDb, guardian, loginAs, member, one, person, rows, season, team } from "./helpers";

async function accountOf(personId: number): Promise<number> {
  await loginAs(personId);
  return (await one<{ id: number }>("SELECT id FROM accounts WHERE person_id = ?", personId)).id;
}

describe("Empfänger von Benachrichtigungen", () => {
  let wd: number;
  let child: number;
  let mum: number;
  let dad: number;
  let coach: number;

  beforeEach(async () => {
    await freshDb();
    await season();
    wd = await team("wD", "wD");
    child = await person("Kind");
    mum = await person("Mama");
    dad = await person("Papa");
    coach = await person("Trainer");
    await member(child, wd);
    await member(coach, wd, "coach");
    await guardian(mum, child);
    await guardian(dad, child);
  });

  it("gehen an das Kind und alle Eltern, gefiltert nach Einstellungen", async () => {
    const [kidAcc, mumAcc, dadAcc] = [await accountOf(child), await accountOf(mum), await accountOf(dad)];
    expect((await recipientsForPersons(env.DB, [child], "events", [wd])).sort()).toEqual([kidAcc, mumAcc, dadAcc].sort());
    await exec("INSERT INTO notification_settings (account_id, person_id, topic, enabled) VALUES (?, ?, 'chat', 0)", dadAcc, child);
    expect((await recipientsForPersons(env.DB, [child], "chat", [wd])).sort()).toEqual([kidAcc, mumAcc].sort());
    expect((await recipientsForPersons(env.DB, [child], "events", [wd])).length).toBe(3);
    // Deaktivierte Accounts bekommen nichts
    await exec("UPDATE accounts SET disabled_at = '2026-01-01T00:00:00Z' WHERE id = ?", mumAcc);
    expect((await recipientsForPersons(env.DB, [child], "events", [wd])).sort()).toEqual([kidAcc, dadAcc].sort());
  });

  it("gehen nicht an Eltern, wenn die Mannschaft ohne Eltern geführt wird", async () => {
    const [kidAcc] = [await accountOf(child), await accountOf(mum), await accountOf(dad)];
    await exec("UPDATE teams SET parents_enabled = 0 WHERE id = ?", wd);
    expect(await recipientsForPersons(env.DB, [child], "events", [wd])).toEqual([kidAcc]);
    // Ohne Mannschaftsbezug zählen alle Mannschaften des Kindes, hier keine mit Eltern
    expect(await recipientsForPersons(env.DB, [child], "events", [])).toEqual([kidAcc]);
    // Spielt das Kind zusätzlich in einer Mannschaft mit Eltern, bekommen die Eltern deren Nachrichten
    const wc = await team("wC", "wC");
    await member(child, wc);
    expect((await recipientsForPersons(env.DB, [child], "events", [wc])).length).toBe(3);
    expect(await recipientsForPersons(env.DB, [child], "events", [wd])).toEqual([kidAcc]);
  });

  it("Trainer-Hinweise gehen nur an Trainer der Mannschaft", async () => {
    const coachAcc = await accountOf(coach);
    await accountOf(child);
    expect(await recipientsForCoaches(env.DB, [wd])).toEqual([coachAcc]);
    await exec("INSERT INTO notification_settings (account_id, person_id, topic, enabled) VALUES (?, ?, 'coach', 0)", coachAcc, coach);
    expect(await recipientsForCoaches(env.DB, [wd])).toEqual([]);
  });
});

describe("Erinnerungen und Aufräumen", () => {
  let wd: number;
  beforeEach(async () => {
    await freshDb();
    await season();
    wd = await team("wD", "wD");
    await member(await person("Spielerin"), wd);
  });

  async function event(startsAt: string) {
    const id = (await one<{ id: number }>("INSERT INTO events (kind, starts_at) VALUES ('training', ?) RETURNING id", startsAt)).id;
    await exec("INSERT INTO event_teams (event_id, team_id) VALUES (?, ?)", id, wd);
    return id;
  }

  it("erinnert einmal, sobald das Fristende weniger als 24 Stunden entfernt ist", async () => {
    const now = localToInstant("2026-12-09T13:00");
    const soon = await event("2026-12-10T18:00"); // Frist 10.12. 12:00, in 23 Stunden
    const later = await event("2026-12-12T18:00"); // Frist in 71 Stunden
    await sendDeadlineReminders(env, now);
    const marked = await rows<{ id: number }>("SELECT id FROM events WHERE reminder_sent_at IS NOT NULL");
    expect(marked.map((m) => m.id)).toEqual([soon]);
    await sendDeadlineReminders(env, now + 3_600_000);
    expect((await rows("SELECT id FROM events WHERE reminder_sent_at IS NOT NULL")).length).toBe(1);
    expect(later).toBeGreaterThan(soon);
  });

  it("löscht Begründungen nach 60 Tagen und abgelaufene Sessions", async () => {
    const p = await person("Alt");
    await member(p, wd);
    const old = await event("2026-01-10T18:00");
    const recent = await event("2026-11-20T18:00");
    for (const e of [old, recent]) {
      await exec("INSERT INTO responses (event_id, person_id, status, reason, responded_at) VALUES (?, ?, 'no', 'krank', '2026-01-01T00:00:00Z')", e, p);
    }
    await loginAs(p);
    await exec("UPDATE sessions SET expires_at = '2026-01-01T00:00:00.000Z'");
    await cleanup(env.DB, localToInstant("2026-12-01T03:00"));
    const reasons = await rows<{ event_id: number; reason: string | null }>("SELECT event_id, reason FROM responses ORDER BY event_id");
    expect(reasons).toEqual([
      { event_id: old, reason: null },
      { event_id: recent, reason: "krank" },
    ]);
    expect((await rows("SELECT * FROM sessions")).length).toBe(0);
  });
});

describe("Push-Anmeldung", () => {
  beforeEach(async () => {
    await freshDb();
    await season();
  });

  it("merkt sich die Adresse der App als Absender für die Push-Dienste", async () => {
    const withoutOrigin = { ...env, ORIGIN: "" };
    expect(await vapidSubject(withoutOrigin)).toBeNull();
    const cookie = await loginAs(await person("Gerät"));
    const res = await api("/push/subscriptions", {
      cookie,
      body: { endpoint: "https://push.example.org/abc", keys: { p256dh: "B".repeat(87), auth: "A".repeat(22) } },
    });
    expect(res.status).toBe(201);
    expect(await vapidSubject(withoutOrigin)).toBe("http://localhost:5173");
    expect(await vapidSubject(env)).toBe(env.ORIGIN);
  });
});
