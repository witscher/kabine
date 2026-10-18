// Abfragepläne der häufigsten Abfragen: Keine darf die Termintabelle komplett durchgehen.
// D1 rechnet jede angefasste Zeile ab; lokal meldet Miniflare keine gelesenen Zeilen, deshalb
// prüft der Test die Pläne (EXPLAIN QUERY PLAN) der tatsächlich ausgeführten Befehle.
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { type Actor, buildActor } from "../worker/auth/actor";
import type { SessionRow } from "../worker/auth/session";
import { ensureEventDuties, helperTeams, loadMyDuties } from "../worker/domain/duties";
import { loadEventPage, ownCandidates } from "../worker/domain/event-page";
import { listVisibleEvents } from "../worker/domain/events";
import { eventIn, exec, freshDb, guardian, member, person, season, team } from "./helpers";

interface Recorded {
  sql: string;
  params: unknown[];
}

/** D1 mit Mitschnitt aller vorbereiteten Befehle samt Parametern. */
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

async function fullScans(seen: Recorded[]): Promise<{ sql: string; plan: string[] }[]> {
  const out: { sql: string; plan: string[] }[] = [];
  for (const q of seen) {
    if (!/^\s*(SELECT|WITH)\b/i.test(q.sql)) continue;
    const plan = (
      await env.DB.prepare(`EXPLAIN QUERY PLAN ${q.sql}`)
        .bind(...q.params)
        .all<{ detail: string }>()
    ).results.map((r) => r.detail);
    // Erlaubt sind SCAN über json_each, die Vorauswahl ids oder kleine Tabellen. Nicht erlaubt:
    // alle Termine (SCAN) oder alle Termine eines Zeitraums (Bereich über events_starts)
    if (plan.some((d) => /\bSCAN (e|events)\b|USING (COVERING )?INDEX events_starts\b/.test(d))) {
      out.push({ sql: q.sql.replace(/\s+/g, " ").slice(0, 160), plan });
    }
  }
  return out;
}

const session: SessionRow = { id: "test", account_id: 0, created_at: "", expires_at: "", extended_at: "" };
let actor: Actor;
let eventIds: number[];

beforeAll(async () => {
  await freshDb();
  await season();
  const wd = await team("wD", "wD");
  await exec("UPDATE teams SET helper_plan = 1 WHERE id = ?", wd);
  const parent = await person("Paula");
  const child = await person("Lina");
  await member(child, wd);
  await guardian(parent, child);
  eventIds = [await eventIn(wd, 1), await eventIn(wd, 3, { kind: "game" }), await eventIn(wd, 5, { kind: "special", title: "Grillfest" })];
  actor = await buildActor(env.DB, session, { account_id: 0, person_id: parent, first_name: "Paula", last_name: "Muster", is_admin: 0 });
});

describe("Abfragepläne ohne Durchsuchen aller Termine", () => {
  it("Terminübersicht (sichtbare Termine)", async () => {
    const { db, seen } = recording(env.DB);
    await listVisibleEvents(db, actor, { from: "2000-01-01T00:00", to: "2099-01-01T00:00" });
    expect(seen.length).toBe(1);
    expect(await fullScans(seen)).toEqual([]);
  });

  it("Mannschaften im Reiter Helfer", async () => {
    const { db, seen } = recording(env.DB);
    await helperTeams(db, actor);
    expect(await fullScans(seen)).toEqual([]);
  });

  it("Seite der Terminübersicht, kommend und vergangen, samt großer Karte und Details", async () => {
    for (const past of [false, true]) {
      const { db, seen } = recording(env.DB);
      await loadEventPage(db, actor, { limit: 20, past, teamId: null });
      expect(seen.length).toBeGreaterThan(3);
      expect(await fullScans(seen)).toEqual([]);
    }
    const { db, seen } = recording(env.DB);
    await ownCandidates(db, actor, "2000-01-01T00:00", "2099-01-01T00:00");
    expect(await fullScans(seen)).toEqual([]);
  });

  it("eigene Dienste und Zeitblöcke in der Terminübersicht", async () => {
    const { db, seen } = recording(env.DB);
    await loadMyDuties(db, actor, eventIds);
    await ensureEventDuties(db, eventIds, "2000-01-01");
    expect(await fullScans(seen)).toEqual([]);
  });
});
