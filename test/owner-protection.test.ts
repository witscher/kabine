// Geschützter Eigentümer-Zugang: Andere Admins können ihn nicht entziehen. Namen erfunden.
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { saveClub } from "../worker/domain/club";
import { createInvite } from "../worker/domain/invites";
import { api as call, exec, freshDb, loginAs, one, person, season } from "./helpers";

const OWNER_EMAIL = "inhaber@example.org";
let owner: number;
let other: number;
let plain: number;
let ownerCookie: string;
let otherCookie: string;

const api = (path: string, cookie: string, method = "POST", body?: unknown) =>
  call(path, { method, cookie, body: body ?? (method === "DELETE" ? undefined : {}) });
const blocked = (res: { status: number; body: any }) => {
  expect(res.status).toBe(403);
  expect(res.body.error.code).toBe("owner_protected");
};
const state = (id: number) =>
  one<{ is_admin: number; admin_email: string | null; is_former: number; accounts: number }>(
    "SELECT is_admin, admin_email, is_former, (SELECT count(*) FROM accounts WHERE person_id = persons.id AND disabled_at IS NULL) AS accounts FROM persons WHERE id = ?",
    id,
  );

beforeEach(async () => {
  await freshDb();
  await season();
  owner = await person("Inhaber", { admin: true });
  await exec("UPDATE persons SET admin_email = ? WHERE id = ?", OWNER_EMAIL, owner);
  await saveClub(env.DB, { ownerPersonId: owner });
  other = await person("Zweite", { admin: true });
  plain = await person("Dritte", { admin: true });
  ownerCookie = await loginAs(owner);
  otherCookie = await loginAs(other);
  await loginAs(plain);
});

describe("Geschützter Eigentümer-Zugang", () => {
  it("andere Admins können ihn auf keinem Weg entziehen", async () => {
    const before = await state(owner);
    blocked(await api(`/admin/persons/${owner}`, otherCookie, "PATCH", { isAdmin: false }));
    blocked(await api(`/admin/persons/${owner}`, otherCookie, "PATCH", { isAdmin: true, adminEmail: "neu@example.org" }));
    blocked(await api(`/admin/persons/${owner}`, otherCookie, "DELETE"));
    blocked(await api(`/persons/${owner}/account`, otherCookie, "DELETE"));
    blocked(await api(`/persons/${owner}/leave`, otherCookie));
    blocked(await api(`/persons/${owner}/personal-link`, otherCookie, "POST", { revokeExisting: true }));
    await exec("INSERT INTO seasons (name, starts_on, ends_on) VALUES ('2027/28', '2027-07-01', '2028-06-30')");
    const next = await one<{ id: number }>("SELECT id FROM seasons WHERE name = '2027/28'");
    blocked(
      await api("/season-change/execute", otherCookie, "POST", {
        seasonId: next.id,
        confirmName: "2027/28",
        assignments: [{ personId: owner, teamIds: [], former: true }],
      }),
    );
    expect(await state(owner)).toEqual(before);
    expect(before).toMatchObject({ is_admin: 1, admin_email: OWNER_EMAIL, is_former: 0, accounts: 1 });
  });

  it("gegen andere Admins wirken die Wege weiter", async () => {
    expect((await api(`/admin/persons/${plain}`, otherCookie, "PATCH", { isAdmin: false })).status).toBe(200);
    expect((await api(`/persons/${plain}/account`, otherCookie, "DELETE")).status).toBe(200);
  });

  it("der Inhaber selbst darf weiter alles, was er vorher durfte", async () => {
    expect((await api(`/admin/persons/${other}`, ownerCookie, "PATCH", { isAdmin: false })).status).toBe(200);
    const link = await api(`/persons/${owner}/personal-link`, ownerCookie, "POST", { revokeExisting: false });
    expect(link.status).toBe(201);
    const token = String(link.body.url).split("#")[1];
    expect((await api("/join/options", "", "POST", { token })).status).toBe(200);
  });

  it("persönliche Links für den Inhaber, die jemand anderes erzeugt hat, lassen sich nicht einlösen", async () => {
    // z. B. ein Link, der vor dieser Absicherung entstanden ist
    const invite = await createInvite(env, { kind: "personal", personId: owner, createdBy: other, revokeExisting: true });
    blocked(await api("/join/options", "", "POST", { token: invite.token }));
    blocked(await api("/join/email", "", "POST", { token: invite.token, email: "angreifer@example.org" }));
  });
});

describe("Eigentümer übergeben", () => {
  it("nur der Eigentümer übergibt die Rolle an einen anderen Admin", async () => {
    expect((await call("/admin/club/owner", { method: "PUT", cookie: otherCookie, body: { personId: other } })).status).toBe(403);
    expect((await call("/admin/club/owner", { method: "PUT", cookie: ownerCookie, body: { personId: other } })).status).toBe(200);
    // Jetzt ist der bisherige Eigentümer nicht mehr geschützt
    expect((await api(`/admin/persons/${owner}`, otherCookie, "PATCH", { isAdmin: false })).status).toBe(200);
  });
});
