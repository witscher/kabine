// Restore from the club's own export: a club is exported, the database starts over with only an admin, and the
// export comes back exactly as the app sends it (runRestore). Invented names.
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { chatStub } from "../worker/domain/chat";
import { EXPORT_TABLES } from "../worker/routes/season";
import { type KabineExport, RESTORE_CATEGORIES, RESTORE_TABLES, runRestore } from "../shared/restore";
import { api, eventIn, exec, freshDb, guardian, hall, loginAs, member, one, person, rows, season, team } from "./helpers";

const poster = (cookie: string) => async <T,>(path: string, body: unknown): Promise<T> => {
  const res = await api<T>(path, { cookie, body });
  if (res.status !== 200) throw new Error(`${path}: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
};

async function exampleClub(): Promise<KabineExport> {
  await freshDb();
  await season();
  await team("Platzhalter", "F"); // so that the restored team gets another id and another chat room
  const wd = await team("wD", "wD");
  const admin = await person("Ada", { lastName: "Admin", admin: true });
  const coach = await person("Theo", { lastName: "Trainer" });
  const kid = await person("Lina", { lastName: "Probe", birthYear: 2014 });
  const parent = await person("Paula", { lastName: "Probe" });
  await member(coach, wd, "coach");
  await member(kid, wd);
  await guardian(parent, kid);
  await loginAs(parent);
  await exec("UPDATE accounts SET email = 'paula@example.org', email_verified_at = '2026-10-01T10:00:00Z' WHERE person_id = ?", parent);
  await exec("INSERT INTO avatars (person_id, status, mime, image, version) VALUES (?, 'approved', 'image/webp', X'010203', 1)", kid);
  const halle = await hall("Testhalle");
  const plan = await one<{ id: number }>(
    "INSERT INTO training_plans (team_id, name, kind, valid_from, valid_to) VALUES (?, 'Herbst', 'regular', '2026-09-01', '2026-12-20') RETURNING id",
    wd,
  );
  await exec("INSERT INTO training_rules (plan_id, weekday, starts_at, ends_at, location_id) VALUES (?, 2, '17:00', '18:30', ?)", plan.id, halle);
  const ev = await eventIn(wd, 3, { kind: "special", title: "Fotoshooting", locationId: halle });
  await exec("INSERT INTO responses (event_id, person_id, status, responded_at) VALUES (?, ?, 'no', '2026-10-20T10:00:00Z')", ev, kid);
  const res = await chatStub(env, wd).fetch("https://chat.internal/system", {
    method: "POST",
    headers: { "x-team-id": String(wd), "content-type": "application/json" },
    body: JSON.stringify({ text: "Willkommen im Chat" }),
  });
  expect(res.ok).toBe(true);
  const exported = await api<KabineExport>("/admin/export", { cookie: await loginAs(admin) });
  expect(exported.status).toBe(200);
  return exported.body;
}

describe("Wiederherstellen aus dem Export", () => {
  it("jede exportierte Tabelle gehört zu einem Bereich", () => {
    const restorable = new Set(Object.values(RESTORE_TABLES).flat());
    expect(EXPORT_TABLES.filter((t) => t !== "app_meta" && !restorable.has(t))).toEqual([]);
  });

  it("alles angekreuzt: neue Installation bekommt den Verein zurück, ein zweiter Lauf legt nichts doppelt an", async () => {
    const file = await exampleClub();
    expect(file.version).toBeTruthy();

    // New installation: only the admin who set it up, no season, no teams
    await freshDb();
    const ada = await person("Ada", { lastName: "Admin", admin: true });
    const cookie = await loginAs(ada);
    const tally = await runRestore(file, new Set(RESTORE_CATEGORIES), poster(cookie));
    expect(tally.people).toEqual({ added: 3, existing: 1, skipped: 0 });
    expect(tally.teams.added).toBe(2);
    expect(tally.events).toEqual({ added: 1, existing: 0, skipped: 0 });
    expect(tally.chats.added).toBe(1);

    expect(await rows("SELECT name, is_current FROM seasons")).toEqual([{ name: "2026/27", is_current: 1 }]);
    const wd = await one<{ id: number }>("SELECT id FROM teams WHERE name = 'wD'");
    expect(
      await rows("SELECT p.first_name, tm.role FROM team_memberships tm JOIN persons p ON p.id = tm.person_id WHERE tm.team_id = ? ORDER BY p.first_name", wd.id),
    ).toEqual([
      { first_name: "Lina", role: "player" },
      { first_name: "Theo", role: "coach" },
    ]);
    expect(await rows("SELECT g.first_name AS guardian, c.first_name AS child FROM guardianships x JOIN persons g ON g.id = x.guardian_id JOIN persons c ON c.id = x.child_id")).toEqual([
      { guardian: "Paula", child: "Lina" },
    ]);
    // E-mail sign-in works again; the passkey handle is new
    const account = await one<{ email: string; webauthn_user_id: string }>("SELECT a.email, a.webauthn_user_id FROM accounts a JOIN persons p ON p.id = a.person_id WHERE p.first_name = 'Paula'");
    expect(account.email).toBe("paula@example.org");
    expect(account.webauthn_user_id).not.toMatch(/^uid-/);
    expect(await rows("SELECT hex(a.image) AS image FROM avatars a JOIN persons p ON p.id = a.person_id WHERE p.first_name = 'Lina'")).toEqual([{ image: "010203" }]);
    expect(
      await rows(
        "SELECT e.title, l.name AS hall, p.first_name, r.status FROM responses r JOIN events e ON e.id = r.event_id JOIN persons p ON p.id = r.person_id JOIN locations l ON l.id = e.location_id",
      ),
    ).toEqual([{ title: "Fotoshooting", hall: "Testhalle", first_name: "Lina", status: "no" }]);
    expect(await rows("SELECT tr.starts_at FROM training_rules tr JOIN training_plans tp ON tp.id = tr.plan_id WHERE tp.team_id = ?", wd.id)).toEqual([{ starts_at: "17:00" }]);
    const chat = (await (await chatStub(env, wd.id).fetch("https://chat.internal/export", { method: "POST", headers: { "x-team-id": String(wd.id) } })).json()) as {
      messages: { text: string }[];
    };
    expect(chat.messages.map((m) => m.text)).toEqual(["Willkommen im Chat"]);
    // The club settings came along; the owner of this installation is kept
    expect(JSON.parse((await one<{ value: string }>("SELECT value FROM app_meta WHERE key = 'club'")).value)).toMatchObject({ name: expect.any(String) });

    const counts = async () =>
      one<Record<string, number>>(
        "SELECT (SELECT COUNT(*) FROM persons) AS persons, (SELECT COUNT(*) FROM teams) AS teams, (SELECT COUNT(*) FROM events) AS events, (SELECT COUNT(*) FROM responses) AS responses, (SELECT COUNT(*) FROM accounts) AS accounts, (SELECT COUNT(*) FROM training_rules) AS rules",
      );
    const before = await counts();
    const again = await runRestore(file, new Set(RESTORE_CATEGORIES), poster(cookie));
    expect(again.people).toEqual({ added: 0, existing: 4, skipped: 0 });
    expect(again.events).toEqual({ added: 0, existing: 1, skipped: 0 });
    expect(again.chats).toEqual({ added: 0, existing: 1, skipped: 0 });
    expect(await counts()).toEqual(before);
  });

  it("nur Mannschaften: die Saison kommt mit, Personen nicht", async () => {
    const file = await exampleClub();
    await freshDb();
    const cookie = await loginAs(await person("Ada", { lastName: "Admin", admin: true }));
    await runRestore(file, new Set(["teams", "season"] as const), poster(cookie));
    expect((await rows("SELECT name FROM teams ORDER BY name")).map((r) => (r as { name: string }).name)).toEqual(["Platzhalter", "wD"]);
    expect(await rows("SELECT first_name FROM persons")).toEqual([{ first_name: "Ada" }]);
  });

  it("Admin-Rollen nur bei der vollständigen Wiederherstellung", async () => {
    const file = await exampleClub();
    await freshDb();
    const cookie = await loginAs(await person("Theo", { lastName: "Trainer", admin: true }));
    await runRestore(file, new Set(["people"] as const), poster(cookie));
    expect(await rows("SELECT first_name, is_admin FROM persons WHERE first_name = 'Ada'")).toEqual([{ first_name: "Ada", is_admin: 0 }]);
  });

  it("nur für Admins, nur Tabellen des Exports", async () => {
    await freshDb();
    const cookie = await loginAs(await person("Theo"));
    expect((await api("/admin/restore/rows", { cookie, body: { table: "persons", rows: [], maps: {} } })).status).toBe(403);
    const admin = await loginAs(await person("Ada", { admin: true }));
    expect((await api("/admin/restore/rows", { cookie: admin, body: { table: "sessions", rows: [], maps: {} } })).status).toBe(400);
  });
});
