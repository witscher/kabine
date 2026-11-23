// Fans module, read load: the games of followed teams start at the teams (index event_teams_team), the push starts at
// the game's teams (index fan_follows_team). Checked through the query plans of the statements that ran (Miniflare
// reports no rows read), like test/query-plans.test.ts. Names invented.
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { eventIn, exec, freshDb, loginAs, member, one, person, season, team } from "../../../test/helpers";
import { type Actor, buildActor } from "../../../worker/auth/actor";
import type { SessionRow } from "../../../worker/auth/session";
import { addDays, todayLocal } from "../../../worker/lib/time";
import { fanGames, followedTeams, notifyFans } from "../worker/domain";

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

/** Plan steps that go through all events, all events of a period, or all follows. */
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
      if (/\bSCAN (e|events|f|fan_follows)\b|USING (COVERING )?INDEX events_starts\b/.test(d)) out.push(`${d} ← ${q.sql.replace(/\s+/g, " ").slice(0, 100)}`);
    }
  }
  return out;
}

const session: SessionRow = { id: "test", account_id: 0, created_at: "", expires_at: "", extended_at: "" };
let actor: Actor;
let wc: number;
let gameId: number;

beforeAll(async () => {
  await freshDb();
  await season();
  const wd = await team("wD", "wD");
  wc = await team("wC", "wC");
  const frida = await person("Frida");
  await member(frida, wd);
  await loginAs(frida);
  const account = await one<{ id: number }>("SELECT id FROM accounts WHERE person_id = ?", frida);
  await exec("INSERT INTO fan_follows (account_id, team_id) VALUES (?, ?)", account.id, wc);
  for (let d = 1; d < 30; d++) await eventIn(wd, d);
  gameId = await eventIn(wc, 1, { kind: "game" });
  await eventIn(wc, 3, { kind: "game" });
  actor = await buildActor(env.DB, { ...session, account_id: account.id }, { account_id: account.id, person_id: frida, first_name: "Frida", last_name: "Muster", is_admin: 0 });
});

describe("fans: query plans", () => {
  it("games of followed teams start at the teams", async () => {
    const { db, seen } = recording(env.DB);
    const teams = await followedTeams(db, actor);
    const { games } = await fanGames(db, actor, { teamIds: teams.map((tm) => tm.id), from: `${todayLocal()}T00:00`, to: "9999-12-31T00:00", limit: 20 });
    expect(games.length).toBe(2);
    expect(await wideReads(seen)).toEqual([]);
  });

  it("the push starts at the game's teams", async () => {
    const { db, seen } = recording(env.DB);
    const starts = `${addDays(todayLocal(), 1)}T18:00`;
    await notifyFans({ ...env, DB: db }, { change: "cancelled", eventId: gameId, kind: "game", teamIds: [wc], before: starts, startsAt: starts, exclude: [] });
    expect(seen.length).toBeGreaterThan(1);
    expect(await wideReads(seen)).toEqual([]);
  });
});
