// Datensicherung: der Admin-Export enthält alle Vereinsdaten. Namen erfunden.
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EXPORT_EXCLUDED, EXPORT_TABLES } from "../worker/routes/season";
import { api, exec, freshDb, guardian, loginAs, member, person, season, team } from "./helpers";

describe("Admin-Export", () => {
  beforeEach(async () => {
    await freshDb();
    await season();
  });

  it("jede Tabelle ist exportiert oder bewusst ausgenommen", async () => {
    const tables = (
      await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'").all<{ name: string }>()
    ).results.map((r) => r.name);
    const listed = new Set([...EXPORT_TABLES, ...EXPORT_EXCLUDED]);
    expect(tables.filter((t) => !listed.has(t))).toEqual([]);
    // Und umgekehrt: keine Einträge für Tabellen, die es nicht gibt
    expect([...listed].filter((t) => !tables.includes(t))).toEqual([]);
  });

  it("enthält Daten, E-Mail und Profilbild, aber keine Zugangsdaten", async () => {
    const wd = await team("wD", "wD");
    const admin = await person("Ada", { admin: true });
    const kid = await person("Lina", { birthYear: 2014 });
    const parent = await person("Paula");
    await member(kid, wd);
    await guardian(parent, kid);
    const cookie = await loginAs(admin);
    await loginAs(parent);
    await exec("UPDATE accounts SET email = 'paula@example.org' WHERE person_id = ?", parent);
    await exec("INSERT INTO avatars (person_id, status, mime, image, version) VALUES (?, 'approved', 'image/webp', X'010203', 1)", kid);

    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const res = await api("/admin/export", { cookie });
    expect(res.status).toBe(200);
    // Protokoll in den Worker-Logs: nur IDs, keine Namen
    const entry = JSON.parse(String(log.mock.calls.find((c) => String(c[0]).includes("admin_export"))?.[0]));
    expect(entry).toMatchObject({ event: "admin_export", personId: admin });
    expect(JSON.stringify(entry)).not.toContain("Ada");
    log.mockRestore();
    const { data } = res.body;
    for (const t of EXPORT_TABLES) expect(Array.isArray(data[t]), t).toBe(true);
    expect(data.persons.map((p: any) => p.first_name)).toEqual(expect.arrayContaining(["Lina", "Paula"]));
    expect(data.accounts.find((a: any) => a.person_id === parent).email).toBe("paula@example.org");
    expect(data.accounts[0].webauthn_user_id).toBeUndefined();
    expect(data.avatars).toEqual([expect.objectContaining({ person_id: kid, image: "AQID" })]);
    for (const t of ["sessions", "passkeys", "email_codes", "invites", "push_subscriptions", "calendar_tokens"]) expect(data[t], t).toBeUndefined();
  });
});
