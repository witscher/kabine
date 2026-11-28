// Abfragepläne der häufigsten Abfragen: Keine darf die Termintabelle komplett durchgehen.
// D1 rechnet jede angefasste Zeile ab; lokal meldet Miniflare keine gelesenen Zeilen, deshalb
// prüft der Test die Pläne (EXPLAIN QUERY PLAN) der tatsächlich ausgeführten Befehle.
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { type Actor, buildActor } from "../worker/auth/actor";
import type { SessionRow } from "../worker/auth/session";
import { canHelpOut, ensureEventDuties, hasClubDuties, helperTeams, loadHelpersNeeded, loadMyDuties } from "../worker/domain/duties";
import { loadCoachHints } from "../worker/domain/coach-hints";
import { elsewhereFor } from "../worker/domain/elsewhere";
import { loadEventPage, ownCandidates } from "../worker/domain/event-page";
import { SYNC_OVERVIEW_SQL } from "../worker/domain/fixtures";
import { listVisibleEvents } from "../worker/domain/events";
import { cacheVersions } from "../worker/lib/cache";
import { loadMyStats, loadPersonStatsEvents, loadTeamStats } from "../worker/domain/stats";
import { loadHelperStats, loadMyHelperStats } from "../modules/duties/worker/stats";
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
let teamId: number;
let childId: number;

beforeAll(async () => {
  await freshDb();
  await season();
  const wd = await team("wD", "wD");
  teamId = wd;
  await exec("UPDATE teams SET helper_plan = 1 WHERE id = ?", wd);
  const parent = await person("Paula");
  const child = await person("Lina");
  childId = child;
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
      await loadEventPage(db, actor, { limit: 20, past, teamIds: null });
      expect(seen.length).toBeGreaterThan(3);
      expect(await fullScans(seen)).toEqual([]);
    }
    // Team buttons and kind chips: the filter is part of the batch query
    {
      const { db, seen } = recording(env.DB);
      await loadEventPage(db, actor, { limit: 20, past: false, teamIds: [teamId], show: "game" });
      expect(seen.some((q) => q.sql.includes("ft.team_id"))).toBe(true);
      expect(await fullScans(seen)).toEqual([]);
    }
    const { db, seen } = recording(env.DB);
    await ownCandidates(db, actor, "2000-01-01T00:00", "2099-01-01T00:00");
    await ownCandidates(db, actor, "2000-01-01T00:00", "2099-01-01T00:00", { teamIds: [teamId], kinds: ["training"] });
    // Training groups: their special events move between the chips "Training" and "Other" inside the query
    for (const kinds of [["training"], ["special"]] as const) {
      await ownCandidates(db, actor, "2000-01-01T00:00", "2099-01-01T00:00", { teamIds: null, kinds: [...kinds], trainingGroups: [teamId] });
    }
    expect(seen.some((q) => q.sql.includes("tg.team_id"))).toBe(true);
    expect(await fullScans(seen)).toEqual([]);
  });

  it("Seite der Terminübersicht mit Trainingsgruppe (Chips Training und Sonstiges)", async () => {
    const group = await team("Torwartgruppe", "wD");
    await exec("UPDATE teams SET kind = 'group', training_group = 1 WHERE id = ?", group);
    await eventIn(group, 2, { kind: "special", title: "Torwarttraining" });
    const fresh = { ...actor, versions: await cacheVersions(env.DB) };
    for (const show of ["training", "other"] as const) {
      const { db, seen } = recording(env.DB);
      await loadEventPage(db, fresh, { limit: 20, past: false, teamIds: null, show });
      expect(seen.some((q) => q.sql.includes("tg.team_id"))).toBe(true);
      expect(await fullScans(seen)).toEqual([]);
    }
  });

  it("eigene Dienste und Zeitblöcke in der Terminübersicht", async () => {
    const { db, seen } = recording(env.DB);
    await loadMyDuties(db, actor, eventIds);
    await ensureEventDuties(db, eventIds, "2000-01-01");
    expect(await fullScans(seen)).toEqual([]);
  });

  it("Helferplan beim Start der App (Aushelfen, Vereinstermine) und „Helfer benötigt“", async () => {
    const { db, seen } = recording(env.DB);
    await canHelpOut(db, actor);
    await hasClubDuties(db, actor);
    await loadHelpersNeeded(db, actor, eventIds, "2000-01-01T00:00");
    expect(seen.length).toBeGreaterThan(3);
    expect(await fullScans(seen)).toEqual([]);
  });

  it("Hinweise für Trainer (Treffpunkt fehlt, Spielplan nicht abgeglichen)", async () => {
    await exec("UPDATE teams SET fixture_connector = 'handball4all', fixture_source = '{\"x\":1}' WHERE id = ?", teamId);
    const { db, seen } = recording(env.DB);
    await loadCoachHints(db, { ...actor, coachTeamIds: [teamId] });
    // Linked teams, games over without a result (sync by itself), upcoming games, meeting points
    expect(seen.length).toBe(4);
    expect(await fullScans(seen)).toEqual([]);
  });

  it("Elsewhere for coaches: from the people's other teams and nominations", async () => {
    const { db, seen } = recording(env.DB);
    await elsewhereFor(db, { personIds: [childId], from: "2000-01-01T00:00", to: "2099-01-01T00:00", excludeTeamIds: [] });
    await elsewhereFor(db, { personIds: [childId], from: "2000-01-01T00:00", to: "2099-01-01T00:00", excludeTeamIds: [teamId], excludeEventId: eventIds[0] });
    expect(seen.length).toBeGreaterThan(3);
    expect(await fullScans(seen)).toEqual([]);
  });

  it("Verwaltung → Spielplan: Spiele je Mannschaft über event_teams", async () => {
    expect(await fullScans([{ sql: SYNC_OVERVIEW_SQL, params: ["2000-01-01T00:00"] }])).toEqual([]);
  });

  it("Statistik der Mannschaft, einer Person und die eigene, mit Helfern", async () => {
    const { db, seen } = recording(env.DB);
    for (const range of ["4w", "season"] as const) {
      await loadTeamStats(db, teamId, range);
      await loadPersonStatsEvents(db, teamId, childId, range);
    }
    await loadMyStats(db, actor);
    await loadHelperStats(db, teamId, "2026-07-01");
    await loadMyHelperStats(db, actor);
    expect(seen.length).toBeGreaterThan(8);
    expect(await fullScans(seen)).toEqual([]);
  });

  it("Results in the list: league tables asked once, only when a game shown has a result", async () => {
    const tables = (seen: Recorded[]) => seen.filter((q) => q.sql.includes("league_tables"));
    {
      const { db, seen } = recording(env.DB);
      await loadEventPage(db, actor, { limit: 20, past: false, teamIds: null });
      expect(tables(seen)).toEqual([]);
    }
    const played = await eventIn(teamId, -2, { kind: "game" });
    await exec("UPDATE events SET is_home = 1, home_goals = 27, guest_goals = 25 WHERE id = ?", played);
    const { db, seen } = recording(env.DB);
    await loadEventPage(db, actor, { limit: 20, past: true, teamIds: null });
    expect(tables(seen)).toHaveLength(1);
    expect(await fullScans(seen)).toEqual([]);
  });
});
