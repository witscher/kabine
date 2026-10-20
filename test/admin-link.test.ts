// Rescue command `npm run admin:link` (scripts/admin-link.mjs): its SQL against a real database, then the
// link through the ordinary join routes. Names invented.
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { adminLinkProblem, adminLinkSql, ADMIN_LINK_HOURS } from "../scripts/admin-link-sql.mjs";
import { sha256Hex } from "../worker/lib/crypto";
import { api, exec, freshDb, loginAs, one, person, rows } from "./helpers";

async function runLink(firstName: string, lastName: string, email: string, now = new Date()) {
  const token = `rescue-${crypto.randomUUID()}`;
  const sql = adminLinkSql({ firstName, lastName, email, nonce: crypto.randomUUID(), tokenHash: await sha256Hex(token), now });
  for (const statement of sql.split(/;\n|;$/).map((s) => s.trim()).filter(Boolean)) await env.DB.prepare(statement).run();
  return token;
}

beforeEach(async () => {
  await freshDb();
});

describe("admin:link", () => {
  it("creates an admin and a personal link that works like any other", async () => {
    const now = new Date();
    const token = await runLink("Alex", "Admin", "Alex@Club.example", now);
    const created = await one<{ id: number; is_admin: number; admin_email: string }>("SELECT id, is_admin, admin_email FROM persons WHERE first_name = 'Alex'");
    expect(created).toMatchObject({ is_admin: 1, admin_email: "alex@club.example" });
    const invite = await one<{ kind: string; person_id: number; created_by: number; expires_at: string; revoke_existing: number }>(
      "SELECT kind, person_id, created_by, expires_at, revoke_existing FROM invites",
    );
    expect(invite).toMatchObject({ kind: "personal", person_id: created.id, created_by: created.id, revoke_existing: 0 });
    expect(Date.parse(invite.expires_at) - now.getTime()).toBe(ADMIN_LINK_HOURS * 3_600_000);

    const info = await api("/join/info", { body: { token } });
    expect(info.body).toMatchObject({ kind: "personal", person: { name: "Alex Admin", isAdmin: true, email: "alex@club.example" } });
    // The admin's address comes from the command, no need to type it
    expect((await api("/join/options", { body: { token } })).status).toBe(200);
  });

  it("an admin who lost access, also the owner: same person, older links withdrawn, devices signed out", async () => {
    const owner = await person("Olga", { lastName: "Owner", admin: true });
    await exec("INSERT INTO app_meta (key, value) VALUES ('club', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", JSON.stringify({ defaultLocale: "de", ownerPersonId: owner }));
    await loginAs(owner);
    const first = await runLink("Olga", "Owner", "olga@example.org");
    const second = await runLink("Olga", "Owner", "OLGA@example.org");
    expect(await rows("SELECT id FROM persons WHERE admin_email = 'olga@example.org'")).toHaveLength(1);
    expect((await api("/join/info", { body: { token: first } })).body.error.code).toBe("invite_revoked");
    const info = await api("/join/info", { body: { token: second } });
    expect(info.body).toMatchObject({ kind: "personal", revokeExisting: true, person: { hasAccount: true } });
    // Owner protection lets the link through: it counts as created by the owner
    expect((await api("/join/options", { body: { token: second } })).status).toBe(200);
  });

  it("brings back an admin who left, and checks its input", async () => {
    const gone = await person("Gerd", { lastName: "Gone", admin: true });
    await exec("UPDATE persons SET is_former = 1, is_admin = 1, left_at = '2026-01-01T00:00:00Z' WHERE id = ?", gone);
    await runLink("Gerd", "Gone", "gerd@example.org");
    expect(await one("SELECT is_former, is_admin, left_at FROM persons WHERE id = ?", gone)).toEqual({ is_former: 0, is_admin: 1, left_at: null });

    expect(adminLinkProblem({ firstName: "A", lastName: "B", email: "a@b.example" })).toBeNull();
    expect(adminLinkProblem({ firstName: "A", lastName: "B", email: "no-address" })).toMatch(/--email/);
    expect(adminLinkProblem({ firstName: "", lastName: "B", email: "a@b.example" })).toMatch(/--first/);
    // Quotes in names cannot break the SQL
    await runLink("O'Neil", "D'Arcy", "oneil@example.org");
    expect(await one("SELECT last_name FROM persons WHERE admin_email = 'oneil@example.org'")).toEqual({ last_name: "D'Arcy" });
  });
});
