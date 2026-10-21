// Rescue command `npm run admin:link` (scripts/admin-link.mjs): its SQL against a real database, then the
// link through the ordinary join routes. Names invented.
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { adminLinkProblem, adminLinkSql, ADMIN_LINK_HOURS, adminsSql } from "../scripts/admin-link-sql.mjs";
import { sha256Hex } from "../worker/lib/crypto";
import { api, exec, freshDb, loginAs, one, person, rows } from "./helpers";

async function runLink(firstName: string, lastName: string, email: string, now = new Date(), opts: { owner?: boolean; revokeOthers?: boolean } = {}) {
  const token = `rescue-${crypto.randomUUID()}`;
  const sql = adminLinkSql({ firstName, lastName, email, nonce: crypto.randomUUID(), tokenHash: await sha256Hex(token), now, ...opts });
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

describe("admin:link break-glass options", () => {
  async function club() {
    return JSON.parse((await one<{ value: string }>("SELECT value FROM app_meta WHERE key = 'club'")).value) as { ownerPersonId?: number };
  }

  it("without options other admins and the owner stay; the use is recorded and shown to admins", async () => {
    const owner = await person("Olga", { lastName: "Owner", admin: true });
    await exec("UPDATE app_meta SET value = json_set(value, '$.ownerPersonId', ?) WHERE key = 'club'", owner);
    await runLink("Alex", "Admin", "alex@example.org");
    expect((await club()).ownerPersonId).toBe(owner);
    expect(await one("SELECT is_admin FROM persons WHERE id = ?", owner)).toEqual({ is_admin: 1 });
    const admins = await rows<{ first_name: string; rescued: number; owner: number }>(adminsSql("alex@example.org"));
    expect(admins.map((a) => [a.first_name, a.rescued, a.owner])).toEqual([
      ["Alex", 1, 0],
      ["Olga", 0, 1],
    ]);
    const view = await api("/admin/updates", { cookie: await loginAs(owner) });
    expect(view.body.breakGlass).toEqual([{ at: expect.any(String), email: "alex@example.org", owner: false, revoked: [] }]);
  });

  it("--owner makes the rescued person the owner", async () => {
    const owner = await person("Olga", { lastName: "Owner", admin: true });
    await exec("UPDATE app_meta SET value = json_set(value, '$.ownerPersonId', ?) WHERE key = 'club'", owner);
    await runLink("Alex", "Admin", "alex@example.org", new Date(), { owner: true });
    const alex = (await one<{ id: number }>("SELECT id FROM persons WHERE admin_email = 'alex@example.org'")).id;
    expect((await club()).ownerPersonId).toBe(alex);
    // The previous owner is an ordinary admin now: the new owner can remove the role in the app
    expect(await one("SELECT is_admin FROM persons WHERE id = ?", owner)).toEqual({ is_admin: 1 });
  });

  it("--revoke-all-admins: every other admin loses the role, is signed out, open links withdrawn; newest record first", async () => {
    const olga = await person("Olga", { lastName: "Owner", admin: true });
    const mark = await person("Mark", { lastName: "Mallory", admin: true });
    const coach = await person("Tina");
    const markCookie = await loginAs(mark);
    await loginAs(coach);
    await exec("UPDATE accounts SET coach_mode = 1 WHERE person_id = ?", mark);
    await exec("INSERT INTO invites (kind, nonce, token_hash, person_id, expires_at) VALUES ('personal', 'n-mark', 'h-mark', ?, '2099-01-01T00:00:00Z')", mark);
    await runLink("Alex", "Admin", "alex@example.org");
    await runLink("Alex", "Admin", "alex@example.org", new Date(), { revokeOthers: true });

    expect(await rows("SELECT first_name FROM persons WHERE is_admin = 1")).toEqual([{ first_name: "Alex" }]);
    expect(await one("SELECT admin_email FROM persons WHERE id = ?", olga)).toEqual({ admin_email: null });
    expect(await rows("SELECT * FROM sessions WHERE account_id IN (SELECT id FROM accounts WHERE person_id IN (?, ?))", olga, mark)).toEqual([]);
    expect(await rows("SELECT * FROM sessions WHERE account_id IN (SELECT id FROM accounts WHERE person_id = ?)", coach)).toHaveLength(1);
    expect(await one("SELECT revoked_at IS NOT NULL AS revoked FROM invites WHERE nonce = 'n-mark'")).toEqual({ revoked: 1 });
    expect(await one("SELECT coach_mode FROM accounts WHERE person_id = ?", mark)).toEqual({ coach_mode: 0 });
    expect((await api("/admin/updates", { cookie: markCookie })).status).toBe(401);
    const alex = (await one<{ id: number }>("SELECT id FROM persons WHERE admin_email = 'alex@example.org'")).id;
    expect((await club()).ownerPersonId).toBe(alex);

    const record = JSON.parse((await one<{ value: string }>("SELECT value FROM app_meta WHERE key = 'break_glass'")).value);
    expect(record.map((r: { owner: boolean; revoked: string[] }) => [r.owner, r.revoked])).toEqual([
      [true, ["Mark Mallory", "Olga Owner"]],
      [false, []],
    ]);
  });
});
