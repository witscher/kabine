// Home game day, read load: the list on home reads nothing for people without a home game day ahead (days and
// settings from the cache, versions with the actor), and the queries of the card, the page and the push never go
// through all events or all events of a period. Checked through the query plans of the statements that ran, like
// test/query-plans.test.ts. Names invented.
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_MODULES } from "../../../shared/modules";
import { eventIn, exec, freshDb, loginAs, member, one, person, season, team } from "../../../test/helpers";
import { type Actor, buildActor } from "../../../worker/auth/actor";
import type { SessionRow } from "../../../worker/auth/session";
import { enterClubContext, saveClub } from "../../../worker/domain/club";
import { cacheVersions } from "../../../worker/lib/cache";
import { addDays, todayLocal } from "../../../worker/lib/time";
import { homeData, loadGameday, recipients } from "../worker/domain";

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

/** Plan steps that go through all events, all events of a period (events_starts), all duties or all follows. */
async function wideReads(seen: Recorded[]): Promise<string[]> {
  const out: string[] = [];
  for (const q of seen) {
    if (!/^\s*(SELECT|WITH)\b/i.test(q.sql)) continue;
    const plan = (
      await env.DB.prepare(`EXPLAIN QUERY PLAN ${q.sql}`)
        .bind(...q.params)
        .all<{ detail: string }>()
    ).results.map((r) => r.detail);
    for (const d of plan) {
      if (/\bSCAN (e|events|d|duties|f|fan_follows)\b|USING (COVERING )?INDEX events_starts\b/.test(d)) out.push(`${d} ← ${q.sql.replace(/\s+/g, " ").slice(0, 100)}`);
    }
  }
  return out;
}

const session: SessionRow = { id: "test", account_id: 0, created_at: "", expires_at: "", extended_at: "" };

async function actorOf(personId: number, firstName: string): Promise<Actor> {
  await loginAs(personId);
  const account = await one<{ id: number }>("SELECT id FROM accounts WHERE person_id = ?", personId);
  return buildActor(env.DB, { ...session, account_id: account.id }, { account_id: account.id, person_id: personId, first_name: firstName, last_name: "Muster", is_admin: 0 });
}

let teams: number[];
let date: string;

beforeAll(async () => {
  await freshDb();
  await season();
  await saveClub(env.DB, { modules: { ...DEFAULT_MODULES, gameday: true, fans: true } });
  await enterClubContext(env.DB);
  teams = [];
  for (const name of ["wE", "wD", "wC", "wB", "Damen"]) teams.push(await team(name, name === "Damen" ? "F" : name));
  // Many trainings and away games, and one home game day in 20 days
  for (let d = 1; d < 30; d++) await eventIn(teams[0]!, d);
  for (let d = 1; d < 20; d += 3) await eventIn(teams[1]!, d, { kind: "game" });
  date = addDays(todayLocal(), 20);
  for (const id of teams) {
    const ev = await eventIn(id, 20, { kind: "game", time: "14:00" });
    await exec("UPDATE events SET is_home = 1 WHERE id = ?", ev);
  }
});

describe("home game day: query plans", () => {
  it("the list on home reads nothing while no home game day lies in the window", async () => {
    const olga = await person("Olga");
    const actor = await actorOf(olga, "Olga");
    // The first call fills the cache of this Worker instance
    await homeData(env.DB, actor, { to: `${addDays(todayLocal(), 10)}T00:00` });
    const { db, seen } = recording(env.DB);
    expect(await homeData(db, actor, { to: `${addDays(todayLocal(), 10)}T00:00` })).toBeNull();
    expect(seen).toEqual([]);
  });

  it("the card and the later days for someone involved start at the person", async () => {
    const lena = await person("Lena");
    await member(lena, teams[1]!);
    const actor = await actorOf(lena, "Lena");
    const { db, seen } = recording(env.DB);
    const data = await homeData(db, actor, { to: "9999-12-31T00:00" });
    expect(data?.later).toEqual([{ date, startsAt: `${date}T14:00` }]);
    expect(await wideReads(seen)).toEqual([]);
    // Without follows or duties to look up beyond the own teams: a duty check for days not settled by teams only
    const hanna = await person("Hanna");
    const other = await actorOf(hanna, "Hanna");
    const second = recording(env.DB);
    expect(await homeData(second.db, other, { to: "9999-12-31T00:00" })).toBeNull();
    expect(await wideReads(second.seen)).toEqual([]);
  });

  it("the push and the page read the day's games, not all games", async () => {
    const gd = (await loadGameday(env.DB, await cacheVersions(env.DB), date, 5))!;
    expect(gd.teamIds).toHaveLength(5);
    const { db, seen } = recording(env.DB);
    await recipients(db, gd);
    expect(seen.length).toBeGreaterThan(1);
    expect(await wideReads(seen)).toEqual([]);
  });
});
