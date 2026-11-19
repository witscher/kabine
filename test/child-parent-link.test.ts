// Parent link for one child: created by a coach of the child's team (or an admin), links only that child, once.
// Security rule 19 (docs/dev/security.md). Names and addresses are invented.
import { exports } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type MailMessage, mailer } from "../worker/domain/email-login";
import { api, exec, freshDb, guardian, loginAs, member, one, person, rows, season, team } from "./helpers";

let wd: number;
let wc: number;
let coachD: string;
let lina: number;
let ole: number;
let mails: MailMessage[];

beforeEach(async () => {
  await freshDb();
  await season();
  wd = await team("wD", "wD");
  wc = await team("wC", "wC");
  const doris = await person("Doris", { lastName: "Dach" });
  await member(doris, wd, "coach");
  coachD = await loginAs(doris);
  lina = await person("Lina", { lastName: "Lauf", birthYear: 2014 });
  ole = await person("Ole", { lastName: "Ost", birthYear: 2014 });
  await member(lina, wd);
  await member(ole, wd);
  mails = [];
  vi.spyOn(mailer, "send").mockImplementation(async (_env, msg) => void mails.push(msg));
});
afterEach(() => vi.restoreAllMocks());

const tokenOf = (body: { url: string }) => String(body.url).split("#")[1]!;
const codeOf = () => mails.at(-1)!.subject.match(/\d{6}/)![0];

async function childLink(cookie = coachD, personId = lina, teamId = wd) {
  return api(`/teams/${teamId}/invites`, { cookie, body: { kind: "parent", personId } });
}

/** Sets up a parent access via the link with an e-mail code, as the join page does without a passkey. */
async function joinAsParent(token: string, firstName: string, email: string, childIds?: number[]) {
  const start = await api("/join/email", { body: { token, firstName, lastName: "Lauf", email, ...(childIds ? { childIds } : {}) } });
  if (start.status !== 200) return { status: start.status, code: start.body.error?.code as string | undefined };
  const res = await exports.default.fetch(
    new Request("http://localhost:5173/api/auth/email/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requestId: start.body.requestId, code: codeOf() }),
    }),
  );
  const body = (await res.json()) as { error?: { code?: string } };
  return { status: res.status, code: body.error?.code };
}

describe("parent link for one child", () => {
  it("only a coach of the child's team or an admin creates it, only for a player of that team", async () => {
    const carla = await person("Carla");
    await member(carla, wc, "coach");
    // Coach of another team, the child herself, a parent of the team
    expect((await childLink(await loginAs(carla))).status).toBe(403);
    expect((await childLink(await loginAs(lina))).status).toBe(403);
    const mara = await person("Mara");
    await guardian(mara, ole);
    expect((await childLink(await loginAs(mara))).status).toBe(403);
    // Not a player of this team, or a player link for one person
    const wcPlayer = await person("Wanda");
    await member(wcPlayer, wc);
    expect((await childLink(coachD, wcPlayer)).status).toBe(404);
    expect((await api(`/teams/${wd}/invites`, { cookie: coachD, body: { kind: "player", personId: lina } })).status).toBe(400);
    // Coach of the team and admin
    expect((await childLink()).status).toBe(201);
    expect((await childLink(await loginAs(await person("Ada", { admin: true })))).status).toBe(201);
    // Without parents in the team there is none
    await exec("UPDATE teams SET parents_enabled = 0 WHERE id = ?", wd);
    expect((await childLink()).status).toBe(409);
  });

  it("does not replace the team's parent link and is not shown as it", async () => {
    const teamLink = await api(`/teams/${wd}/invites`, { cookie: coachD, body: { kind: "parent" } });
    const first = await childLink();
    expect((await api("/join/info", { body: { token: tokenOf(teamLink.body) } })).status).toBe(200);
    expect((await api(`/teams/${wd}`, { cookie: coachD })).body.invites.parent.id).toBe(teamLink.body.id);
    // A new team link leaves the child's link alone; a new link for the child withdraws the previous one
    await api(`/teams/${wd}/invites`, { cookie: coachD, body: { kind: "parent" } });
    expect((await api("/join/info", { body: { token: tokenOf(first.body) } })).status).toBe(200);
    await childLink();
    expect((await api("/join/info", { body: { token: tokenOf(first.body) } })).body.error.code).toBe("invite_revoked");
  });

  it("links that child and no other", async () => {
    // Test persons first: the helper picks their ids, the sign-up takes the next free one
    const mara = await person("Mara");
    await guardian(mara, await person("Mats"));
    const link = await childLink();
    const token = tokenOf(link.body);
    const info = await api("/join/info", { body: { token } });
    expect(info.body).toMatchObject({ kind: "parent", forChild: true, persons: [{ id: lina, name: "Lina L." }] });
    // Another child of the team in the selection
    expect((await api("/join/options", { body: { token, firstName: "Paula", lastName: "Lauf", childIds: [ole] } })).status).toBe(400);
    expect((await api("/join/options", { body: { token, firstName: "Paula", lastName: "Lauf", childIds: [lina, ole] } })).status).toBe(400);
    // Without a selection the link picks the child
    expect(await joinAsParent(token, "Paula", "paula@example.org")).toEqual({ status: 200, code: undefined });
    const paula = await one<{ id: number }>("SELECT id FROM persons WHERE first_name = 'Paula'");
    expect(await rows("SELECT child_id FROM guardianships WHERE guardian_id = ?", paula.id)).toEqual([{ child_id: lina }]);

    // A signed-in parent links the child, and only that child
    const maraCookie = await loginAs(mara);
    const second = tokenOf((await childLink()).body);
    expect((await api("/join/link-children", { cookie: maraCookie, body: { token: second, childIds: [ole] } })).status).toBe(400);
    expect((await api("/join/link-children", { cookie: maraCookie, body: { token: second, childIds: [lina] } })).status).toBe(200);
    expect(await rows("SELECT child_id FROM guardianships WHERE guardian_id = ? AND child_id IN (?, ?)", mara, lina, ole)).toEqual([{ child_id: lina }]);
  });

  it("respects the limit of two parents and the child limits", async () => {
    // In a team whose children have no own access, the parents' link still works; the child cannot link herself
    await exec("UPDATE teams SET child_account = 0 WHERE id = ?", wd);
    expect((await api(`/teams/${wd}/invites`, { cookie: coachD, body: { kind: "player" } })).body.error.code).toBe("no_child_account");
    const link = await childLink();
    expect(link.status).toBe(201);
    const linaCookie = await loginAs(lina);
    expect((await api("/join/link-children", { cookie: linaCookie, body: { token: tokenOf(link.body), childIds: [lina] } })).status).toBe(400);

    // Two parents already: no link, and an older link stops at the info and at sign-up
    await guardian(await person("Mara"), lina);
    await guardian(await person("Mats"), lina);
    const full = await childLink();
    expect(full.status).toBe(409);
    expect(full.body.error.code).toBe("child_full");
    expect((await api("/join/info", { body: { token: tokenOf(link.body) } })).body.error.code).toBe("child_full");
    expect((await joinAsParent(tokenOf(link.body), "Paula", "paula@example.org")).code).toBe("child_full");
    expect(await rows("SELECT id FROM persons WHERE first_name = 'Paula'")).toEqual([]);
  });

  it("works once, and no longer when withdrawn or the child left the team", async () => {
    const mara = await loginAs(await person("Mara"));
    const token = tokenOf((await childLink()).body);
    // Two codes requested at the same time: only the first one redeemed sets up an access
    const a = await api("/join/email", { body: { token, firstName: "Paula", lastName: "Lauf", email: "paula@example.org" } });
    const codeA = codeOf();
    const b = await api("/join/email", { body: { token, firstName: "Peer", lastName: "Lauf", email: "peer@example.org" } });
    const codeB = codeOf();
    const verify = (requestId: string, code: string) => api("/auth/email/verify", { body: { requestId, code } });
    expect((await verify(a.body.requestId, codeA)).status).toBe(200);
    const late = await verify(b.body.requestId, codeB);
    expect(late.status).toBe(410);
    expect(await rows("SELECT first_name FROM persons WHERE first_name IN ('Paula', 'Peer')")).toEqual([{ first_name: "Paula" }]);
    expect((await api("/join/info", { body: { token } })).body.error.code).toBe("invite_used");
    expect((await api("/join/link-children", { cookie: mara, body: { token, childIds: [lina] } })).body.error.code).toBe("invite_used");

    // Withdrawn by the coach
    const withdrawn = await childLink(coachD, ole);
    expect((await api(`/invites/${withdrawn.body.id}`, { cookie: coachD, method: "DELETE" })).status).toBe(200);
    expect((await api("/join/info", { body: { token: tokenOf(withdrawn.body) } })).body.error.code).toBe("invite_revoked");

    // The child left the team
    const left = await childLink(coachD, ole);
    await exec("DELETE FROM team_memberships WHERE person_id = ? AND team_id = ?", ole, wd);
    expect((await api("/join/info", { body: { token: tokenOf(left.body) } })).body.error.code).toBe("child_gone");
  });
});
