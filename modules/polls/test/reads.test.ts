// Polls module, read load: participants of an order load only their own unit, the list counts votes only for
// managers, managers' team names come from the cache. Checked through the query plans of the statements that ran
// (Miniflare reports no rows read), like test/query-plans.test.ts. Names invented.
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_MODULES } from "../../../shared/modules";
import { api, freshDb, guardian, loginAs, member, one, person, season, team } from "../../../test/helpers";
import { buildActor } from "../../../worker/auth/actor";
import type { SessionRow } from "../../../worker/auth/session";
import { saveClub } from "../../../worker/domain/club";
import { addDays, todayLocal } from "../../../worker/lib/time";
import { type PollRow, pollDetail } from "../worker/domain";

interface Recorded {
  sql: string;
  params: unknown[];
}

/** D1 that records every prepared statement with its parameters. */
function recording(db: D1Database): { db: D1Database; seen: Recorded[] } {
  const seen: Recorded[] = [];
  const wrapped = new Proxy(db, {
    get(target, prop) {
      if (prop === "prepare") {
        return (sql: string) => {
          const entry: Recorded = { sql, params: [] };
          seen.push(entry);
          const statement = target.prepare(sql);
          return new Proxy(statement, {
            get(s, p) {
              if (p === "bind") return (...params: unknown[]) => ((entry.params = params), s.bind(...params));
              const v = Reflect.get(s, p);
              return typeof v === "function" ? v.bind(s) : v;
            },
          });
        };
      }
      const v = Reflect.get(target, prop);
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
  return { db: wrapped, seen };
}

/** Plan steps that go through every voter, vote or answer of a poll (searched by poll_id alone). */
async function wholePollReads(seen: Recorded[]): Promise<string[]> {
  const out: string[] = [];
  for (const q of seen) {
    if (!/^\s*(SELECT|WITH)\b/i.test(q.sql)) continue;
    const plan = (
      await env.DB.prepare(`EXPLAIN QUERY PLAN ${q.sql}`)
        .bind(...q.params)
        .all<{ detail: string }>()
    ).results.map((r) => r.detail);
    for (const d of plan) {
      if (/\b(poll_voters|poll_ballots|poll_answers|pv|b)\b.*\(poll_id=\?\)$/.test(d)) out.push(`${d} ← ${q.sql.replace(/\s+/g, " ").slice(0, 100)}`);
    }
  }
  return out;
}

const session: SessionRow = { id: "test", account_id: 0, created_at: "", expires_at: "", extended_at: "" };
const later = () => `${addDays(todayLocal(), 7)}T20:00`;
let wd: number;
let coach: number;
let mona: number;
let coachCookie: string;
let monaCookie: string;

beforeEach(async () => {
  await freshDb();
  await season();
  await saveClub(env.DB, { modules: { ...DEFAULT_MODULES, polls: true } });
  wd = await team("wD", "wD");
  coach = await person("Tara", { lastName: "Trainer" });
  mona = await person("Mona", { lastName: "Kraus" });
  await member(coach, wd, "coach");
  for (let i = 0; i < 6; i++) {
    const kid = await person(`Kind${i}`, { lastName: `Muster${i}` });
    await member(kid, wd);
    if (i === 0) await guardian(mona, kid);
  }
  coachCookie = await loginAs(coach);
  monaCookie = await loginAs(mona);
});

const create = async (body: Record<string, unknown>) => (await api("/polls", { cookie: coachCookie, body: { teamId: wd, whoPlayers: true, endsAt: later(), ...body } })).body.id as number;

describe("Leselast der Umfragen", () => {
  it("Bestellung für Teilnehmende: nur die eigene Einheit, nicht alle Stimmberechtigten", async () => {
    const id = await create({ kind: "order", title: "Wintermütze", perFamily: true, options: [{ label: "Mütze", priceCents: 2500 }] });
    const row = await one<PollRow>("SELECT * FROM polls WHERE id = ?", id);
    const actor = await buildActor(env.DB, session, { account_id: 0, person_id: mona, first_name: "Mona", last_name: "Kraus", is_admin: 0 });
    const { db, seen } = recording(env.DB);
    const d = await pollDetail(db, actor, row!);
    expect(d.myUnits).toHaveLength(1);
    expect(d.myUnits[0]!.who).toBe("family");
    expect(await wholePollReads(seen)).toEqual([]);
    // The same view still works after ordering
    const unit = d.myUnits[0]!.unitId;
    const ordered = await api(`/polls/${id}/ballot`, { method: "PUT", cookie: monaCookie, body: { unitId: unit, answers: [{ optionId: d.options[0]!.id, value: 2 }] } });
    expect(ordered.body.myUnits[0].payment.totalCents).toBe(5000);

    // Managers still read the whole poll (they see every order)
    const manager = await buildActor(env.DB, session, { account_id: 0, person_id: coach, first_name: "Tara", last_name: "Trainer", is_admin: 0 });
    const m = recording(env.DB);
    const md = await pollDetail(m.db, manager, row!);
    expect([md.voted, md.total]).toEqual([1, 6]);
    expect(await wholePollReads(m.seen)).not.toEqual([]);
    // Team names for the labels come from the cache: a second view reads no memberships
    const again = recording(env.DB);
    await pollDetail(again.db, manager, row!);
    expect(again.seen.filter((q) => /\bteam_memberships\b/.test(q.sql))).toEqual([]);
  });

  it("Zähler in der Liste nur für Verwalter, bei allen Arten", async () => {
    const order = await create({ kind: "order", title: "Wintermütze", perFamily: true, options: [{ label: "Mütze", priceCents: 2500 }] });
    const choice = await create({ kind: "choice", title: "Abschlussfahrt", options: [{ label: "Kino" }, { label: "Freibad" }] });
    const mine = (await api("/polls", { cookie: monaCookie })).body.polls;
    for (const id of [order, choice]) expect(mine.find((p: any) => p.id === id)).toMatchObject({ voted: 0, total: 0, canManage: false });
    const managed = (await api("/polls", { cookie: coachCookie })).body.polls;
    expect(managed.find((p: any) => p.id === order)).toMatchObject({ voted: 0, total: 6, canManage: true });
    expect(managed.find((p: any) => p.id === choice)).toMatchObject({ voted: 0, total: 6, canManage: true });
  });
});
