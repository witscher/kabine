// Game schedules from fixture connectors (modules of kind "fixtures", worker/module-api.ts): which
// connector a team uses, and the sync that is the same for every source: halls, home or away, new,
// moved and cancelled games, results, the league table, notifications, and when a schedule syncs by
// itself. The connector only knows its source.
import { plural, select, t } from "@lingui/core/macro";
import { LOCALES } from "../../shared/i18n";
import type { ModuleId } from "../../shared/modules";
import { withLocale } from "../i18n";
import { all, first, list, stmt } from "../lib/db";
import { addMinutesLocal, nowLocal, utcIso } from "../lib/time";
import type { FixtureConnector, FixtureGame, FixtureSource } from "../module-api";
import { moduleEventChanged, WORKER_MODULES } from "../modules";
import { syncAutoSquads } from "./auto-squad";
import { isModuleOn, ownVenue } from "./club";
import { notifyCoaches, notifyPersons, shortDate, shortTime } from "./notify";
import type { FixtureTable, LeagueTableRow } from "../../shared/types";

/** A connector with the id of its module. */
export interface Connector extends FixtureConnector {
  id: string;
}

/** Every connector, on or off. */
export function allConnectors(): Connector[] {
  return WORKER_MODULES.filter((m) => m.fixtures).map((m) => ({ ...m.fixtures!, id: m.manifest.id }));
}

/** Connectors the club has switched on. */
export function activeConnectors(): Connector[] {
  return allConnectors().filter((c) => isModuleOn(c.id as ModuleId));
}

export function connectorById(id: string | null): Connector | null {
  return allConnectors().find((c) => c.id === id) ?? null;
}

/** Reference of a game or hall from a connector in events/locations.external_ref. */
export const externalRef = (connector: string, id: string) => `${connector}:${id}`;

/** The connector and id of an external_ref ("handball4all:123" → { connector, id }). */
export function splitRef(ref: string | null): { connector: string; id: string } | null {
  const i = ref?.indexOf(":") ?? -1;
  return ref && i > 0 ? { connector: ref.slice(0, i), id: ref.slice(i + 1) } : null;
}

export interface TeamFixtures {
  id: number;
  name: string;
  fixture_connector: string | null;
  fixture_source: string | null;
  fixture_synced_at: string | null;
  fixture_error: string | null;
  fixture_claimed_at: string | null;
}

export const TEAM_FIXTURES_SELECT = "SELECT id, name, fixture_connector, fixture_source, fixture_synced_at, fixture_error, fixture_claimed_at FROM teams";

/** All teams with their fixture state and game counts (Administration → game schedule); binds the local now. */
export const SYNC_OVERVIEW_SQL = `SELECT t.id, t.name, t.fixture_connector, t.fixture_source, t.fixture_synced_at, t.fixture_error, t.fixture_claimed_at,
    (SELECT count(*) FROM event_teams et JOIN events e ON e.id = et.event_id
      WHERE et.team_id = t.id AND e.kind = 'game' AND e.cancelled_at IS NULL AND e.starts_at > ?) AS upcoming,
    (SELECT count(*) FROM event_teams et JOIN events e ON e.id = et.event_id
      WHERE et.team_id = t.id AND e.kind = 'game' AND e.cancelled_at IS NULL) AS games
  FROM teams t WHERE t.kind = 'team' ORDER BY t.name`;

export function teamSource(team: Pick<TeamFixtures, "fixture_source">): FixtureSource | null {
  if (!team.fixture_source) return null;
  try {
    return JSON.parse(team.fixture_source) as FixtureSource;
  } catch {
    return null;
  }
}

/** League table of the team's source, if it has one and its module is on. */
export function teamTableUrl(team: Pick<TeamFixtures, "fixture_connector" | "fixture_source">): { url: string; name: string; connector: string } | null {
  const connector = connectorById(team.fixture_connector);
  const source = teamSource(team);
  if (!connector || !source || !isModuleOn(connector.id as ModuleId)) return null;
  const url = connector.tableUrl?.(source) ?? null;
  return url ? { url, name: connector.name, connector: connector.id } : null;
}

/** What the team's connector fetches, if its module is on. */
export function teamScheduleUrl(team: Pick<TeamFixtures, "fixture_connector" | "fixture_source">): string | null {
  const connector = connectorById(team.fixture_connector);
  const source = teamSource(team);
  if (!connector || !source || !isModuleOn(connector.id as ModuleId)) return null;
  return connector.request(source).url;
}

// Matchdays ------------------------------------------------------------------------

/**
 * Matchday instead of a single game (F youth and younger): the schedule lists it as a game of the host
 * against the placeholder "Spieltag gF"; all teams of the division take part.
 */
export function isMatchdayName(name: string | null | undefined): boolean {
  return /^Spieltag\b/i.test(name?.trim() ?? "");
}

/** For matchdays: the host (the other side of the placeholder), else null. */
export function matchdayHost(g: Pick<FixtureGame, "home" | "guest">): string | null {
  if (isMatchdayName(g.guest)) return g.home;
  if (isMatchdayName(g.home)) return g.guest;
  return null;
}

/** Matchday: home matchday if the own club hosts or it is played in an own hall. */
export function matchdayIsHome(g: FixtureGame, hint: string | null, homeVenues: Set<string>): boolean {
  const host = matchdayHost(g)?.toLowerCase() ?? "";
  const own = hint?.toLowerCase() ?? "";
  if (own && host && (host === own || own.startsWith(host) || host.startsWith(own))) return true;
  return g.venue != null && homeVenues.has(g.venue.externalId);
}

/** Which name in the games is the own team? When the source filters by team it appears in every game. */
export function ownTeamName(games: FixtureGame[], hint: string | null, homeVenues: Set<string>): string | null {
  if (!games.length) return null;
  const counts = new Map<string, number>();
  for (const g of games) {
    counts.set(g.home, (counts.get(g.home) ?? 0) + 1);
    if (g.guest !== g.home) counts.set(g.guest, (counts.get(g.guest) ?? 0) + 1);
  }
  const inAll = [...counts.entries()].filter(([, n]) => n === games.length).map(([name]) => name);
  if (inAll.length === 1) return inAll[0]!;
  if (hint) {
    const lower = hint.toLowerCase();
    const match = [...counts.keys()].find((n) => n.toLowerCase() === lower || lower.startsWith(n.toLowerCase()));
    if (match) return match;
  }
  const atHome = games.find((g) => g.venue != null && homeVenues.has(g.venue.externalId));
  return atHome?.home ?? null;
}

// Sync by itself --------------------------------------------------------------------
//
// Sources that allow it sync from a coach's device without a button (docs/dev/connectors.md, fair use): once the
// last sync is `autoSyncDays` old, and with `autoSyncResults` after each game until its result is there. The state
// lives on the team and the game, so several coaches cause one fetch, not one each; the server refuses a sync by
// itself that is not due and never fetches on its own.

/** A reservation to fetch expires after this long; no two devices fetch a team's schedule at the same time. */
export const CLAIM_MS = 10 * 60_000;
/** After kick-off plus the playing time, wait this long: by then the result is usually entered. */
export const RESULT_DELAY_MINUTES = 60;
/** Between two tries to fetch a missing result. */
export const RESULT_RETRY_MS = 3 * 3_600_000;
/** At most this many tries per game, then quiet until the next game (or the weekly sync). */
export const RESULT_MAX_TRIES = 2;
/** Games longer ago than this are not waited for. */
const RESULT_WINDOW_DAYS = 7;
/** The button for coaches of a team that syncs by itself: at most this often (admins only the source's minimum). */
export const MANUAL_COACH_MS = 3_600_000;

/** Does the source sync by itself at all? Then the button is only a fallback. */
export function syncsByItself(connector: Pick<FixtureConnector, "autoSyncDays" | "autoSyncResults">): boolean {
  return !!(connector.autoSyncDays || connector.autoSyncResults);
}

/** Last sync at least this many days ago (or never); 0 = never due. */
export function syncOlderThan(syncedAt: string | null, days: number, now: number): boolean {
  return days > 0 && (!syncedAt || now - Date.parse(syncedAt) >= days * 86_400_000);
}

/**
 * Games of these teams from their source that are over (kick-off plus the age class's playing time plus an hour, at
 * most a week back), still have no result and have a try left. Only teams whose source syncs results by itself.
 * One query for all teams, starting from their games.
 */
export async function resultDueGames(
  db: D1Database,
  teams: Pick<TeamFixtures, "id" | "fixture_connector">[],
  now: number,
): Promise<{ id: number; teamId: number; externalId: string }[]> {
  const connectorOf = new Map(
    teams.flatMap((tm) => {
      const c = connectorById(tm.fixture_connector);
      return c?.autoSyncResults && isModuleOn(c.id as ModuleId) ? [[tm.id, c.id] as const] : [];
    }),
  );
  if (!connectorOf.size) return [];
  const nowL = nowLocal(now);
  const rows = await all<{ id: number; team_id: number; external_ref: string; starts_at: string; game_minutes: number | null }>(
    db,
    `SELECT e.id, et.team_id, e.external_ref, e.starts_at, ac.game_minutes
       FROM json_each(?1) j CROSS JOIN event_teams et ON et.team_id = j.value CROSS JOIN events e ON e.id = et.event_id
       JOIN teams t ON t.id = et.team_id
       LEFT JOIN age_classes ac ON ac.code = t.age_class_code AND ac.season_id = (SELECT id FROM seasons WHERE is_current = 1)
      WHERE e.kind = 'game' AND e.external_ref IS NOT NULL AND e.cancelled_at IS NULL AND e.home_goals IS NULL
        AND e.starts_at >= ?2 AND e.starts_at < ?3
        AND e.result_tries < ?4 AND (e.result_tried_at IS NULL OR e.result_tried_at < ?5)`,
    list([...connectorOf.keys()]),
    addMinutesLocal(nowL, -RESULT_WINDOW_DAYS * 24 * 60),
    nowL,
    RESULT_MAX_TRIES,
    utcIso(now - RESULT_RETRY_MS),
  );
  return rows.flatMap((r) => {
    const ref = splitRef(r.external_ref);
    if (!ref || ref.connector !== connectorOf.get(r.team_id)) return [];
    if (addMinutesLocal(r.starts_at, (r.game_minutes ?? 90) + RESULT_DELAY_MINUTES) > nowL) return [];
    return [{ id: r.id, teamId: r.team_id, externalId: ref.id }];
  });
}

/** Is a sync by itself due for the team: after a game without a result, or once the last sync is old enough? */
export async function autoSyncDue(db: D1Database, team: TeamFixtures, connector: FixtureConnector, now = Date.now()): Promise<"result" | "weekly" | null> {
  if (connector.autoSyncResults && (await resultDueGames(db, [team], now)).length) return "result";
  if (syncOlderThan(team.fixture_synced_at, connector.autoSyncDays ?? 0, now)) return "weekly";
  return null;
}

// League table ----------------------------------------------------------------------

const MAX_TABLE_ROWS = 40;
const int = (v: unknown, max = 9999): number => (typeof v === "number" && Number.isInteger(v) && Math.abs(v) <= max ? v : 0);
const text = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

/**
 * A connector's table, checked again before it is stored: it comes from a coach's browser for device sources. Rows
 * without a team name are dropped; null when nothing is left.
 */
export function cleanTable(table: FixtureTable | null | undefined): FixtureTable | null {
  if (!table || !Array.isArray(table.rows)) return null;
  const rows: LeagueTableRow[] = [];
  for (const r of table.rows.slice(0, MAX_TABLE_ROWS)) {
    const team = text(r?.team, 80);
    if (!team) continue;
    const pos = int(r.pos, 99);
    rows.push({
      pos: pos > 0 ? pos : null,
      team,
      own: r.own === true,
      games: int(r.games),
      won: int(r.won),
      draw: int(r.draw),
      lost: int(r.lost),
      goalsFor: int(r.goalsFor),
      goalsAgainst: int(r.goalsAgainst),
      pointsPlus: int(r.pointsPlus),
      pointsMinus: r.pointsMinus == null ? null : int(r.pointsMinus),
    });
  }
  return rows.length ? { leagueName: text(table.leagueName, 120), comment: text(table.comment, 400), rows } : null;
}

// Sync -----------------------------------------------------------------------------

/** Cancel reason of games that disappeared from the schedule; stored in the language of the import. */
const importCancelReason = (name: string) => t`Game no longer in the schedule (${name})`;
/** Recognises the reason in any language and for any source (the import may have run in another one). */
const isImportCancelReason = (reason: string | null, name: string) => LOCALES.some((l) => withLocale(l, () => importCancelReason(name)) === reason);

export interface ImportSummary {
  created: number;
  updated: number;
  moved: number;
  cancelled: number;
  skipped: number;
  /** Games already in the app for teams the importer does not coach: left alone. */
  foreign: number;
}

/**
 * Syncs a fetched schedule into the team's games. The data may come from a coach's browser and is not
 * trusted: the connector checks it, and a game that already belongs to another team is only linked when
 * the importer may coach that team too (`mayCoach`).
 */
export async function importGames(
  env: Env,
  team: TeamFixtures,
  data: unknown,
  now = Date.now(),
  mayCoach: (teamId: number) => boolean = () => false,
): Promise<ImportSummary> {
  const db = env.DB;
  const connector = connectorById(team.fixture_connector);
  const source = teamSource(team);
  if (!connector || !source) throw new Error(`Team ${team.id} has no game schedule source`);
  const schedule = connector.parse(data, source);
  const ref = (id: string) => externalRef(connector.id, id);

  const halls = await all<{ external_ref: string | null }>(db, "SELECT external_ref FROM locations WHERE kind = 'hall'");
  const homeVenues = new Set(
    halls.map((h) => splitRef(h.external_ref)).flatMap((r) => (r && r.connector === connector.id ? [r.id] : [])),
  );
  const hint = schedule.ownTeamHint;
  // Matchdays carry the placeholder "Spieltag …" in every entry; the own name only appears in real games
  const own = ownTeamName(
    schedule.games.filter((g) => matchdayHost(g) == null),
    hint,
    homeVenues,
  );

  // Create or reuse halls
  const venueRefs = [...new Set(schedule.games.flatMap((g) => (g.venue ? [ref(g.venue.externalId)] : [])))];
  const known = new Set(
    (await all<{ external_ref: string }>(db, "SELECT external_ref FROM locations WHERE external_ref IN (SELECT value FROM json_each(?))", list(venueRefs))).map(
      (l) => l.external_ref,
    ),
  );
  const venue = ownVenue();
  const missing = new Map<string, FixtureGame["venue"]>();
  for (const g of schedule.games) if (g.venue && !known.has(ref(g.venue.externalId))) missing.set(ref(g.venue.externalId), g.venue);
  if (missing.size) {
    await db.batch(
      [...missing.entries()].map(([r, v]) =>
        stmt(
          db,
          "INSERT OR IGNORE INTO locations (name, address, map_url, kind, external_ref) VALUES (?, ?, ?, 'external', ?)",
          v!.name ?? select(venue, { hall: "Hall", pitch: "Pitch", other: "Venue" }),
          v!.address,
          v!.address ? `https://www.openstreetmap.org/search?query=${encodeURIComponent(v!.address)}` : null,
          r,
        ),
      ),
    );
  }
  const locationByRef = new Map(
    (await all<{ id: number; external_ref: string }>(db, "SELECT id, external_ref FROM locations WHERE external_ref IN (SELECT value FROM json_each(?))", list(venueRefs))).map(
      (l) => [l.external_ref, l.id],
    ),
  );

  const existing = await all<{
    id: number;
    external_ref: string;
    starts_at: string;
    location_id: number | null;
    cancelled_at: string | null;
    cancelled_by: number | null;
    cancel_reason: string | null;
    shared: number;
  }>(
    db,
    `SELECT e.id, e.external_ref, e.starts_at, e.location_id, e.cancelled_at, e.cancelled_by, e.cancel_reason,
            EXISTS (SELECT 1 FROM event_teams o WHERE o.event_id = e.id AND o.team_id <> et.team_id) AS shared
       FROM events e JOIN event_teams et ON et.event_id = e.id
      WHERE et.team_id = ? AND e.kind = 'game' AND e.external_ref LIKE ? ESCAPE '\\'`,
    team.id,
    `${connector.id.replace(/[\\%_]/g, (c) => `\\${c}`)}:%`,
  );
  const byRef = new Map(existing.map((e) => [e.external_ref, e]));
  // Games of the schedule that other teams already have (e.g. two own teams in the same league)
  const others = new Map(
    (
      await all<{ id: number; external_ref: string; teams: string }>(
        db,
        `SELECT e.id, e.external_ref, (SELECT json_group_array(team_id) FROM event_teams WHERE event_id = e.id) AS teams
           FROM events e WHERE e.external_ref IN (SELECT value FROM json_each(?))`,
        list(schedule.games.map((g) => ref(g.externalId)).filter((r) => !byRef.has(r))),
      )
    ).map((e) => [e.external_ref, { id: e.id, teams: JSON.parse(e.teams) as number[] }]),
  );
  const nowL = nowLocal(now);
  // Games waiting for their result, before this sync writes any
  const resultDue = await resultDueGames(db, [team], now);
  const statements: D1PreparedStatement[] = [];
  const summary: ImportSummary = { created: 0, updated: 0, moved: 0, cancelled: 0, skipped: schedule.skipped, foreign: 0 };
  const movedEvents: { id: number; before: string; startsAt: string; locationId: number | null; cancelled: boolean }[] = [];
  /** Games no longer in the schedule (cancelled by the sync) and games back in it. */
  const dropped: { id: number; startsAt: string }[] = [];
  const reopened: { id: number; startsAt: string }[] = [];
  let newGames = 0;

  for (const g of schedule.games) {
    const gameRef = ref(g.externalId);
    const startsAt = `${g.date}T${g.time}`;
    const endsAt = addMinutesLocal(startsAt, 90);
    const locationId = g.venue ? (locationByRef.get(ref(g.venue.externalId)) ?? null) : null;
    const isHome =
      matchdayHost(g) != null ? (matchdayIsHome(g, hint, homeVenues) ? 1 : 0) : own == null ? null : g.home === own ? 1 : g.guest === own ? 0 : null;
    const ex = byRef.get(gameRef);
    const other = ex ? undefined : others.get(gameRef);
    if (other) {
      if (other.teams.every(mayCoach)) {
        statements.push(stmt(db, "INSERT OR IGNORE INTO event_teams (event_id, team_id) VALUES (?, ?)", other.id, team.id));
        summary.updated++;
      } else summary.foreign++;
      continue;
    }
    if (!ex) {
      statements.push(
        stmt(
          db,
          `INSERT OR IGNORE INTO events (kind, starts_at, ends_at, location_id, external_ref, game_no, home_team, guest_team, is_home, home_goals, guest_goals)
           VALUES ('game', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          startsAt,
          endsAt,
          locationId,
          gameRef,
          g.number,
          g.home,
          g.guest,
          isHome,
          g.homeGoals,
          g.guestGoals,
        ),
        // Only if nobody else created the game in the meantime
        stmt(
          db,
          `INSERT OR IGNORE INTO event_teams (event_id, team_id)
           SELECT id, ? FROM events WHERE external_ref = ? AND NOT EXISTS (SELECT 1 FROM event_teams WHERE event_id = events.id)`,
          team.id,
          gameRef,
        ),
      );
      summary.created++;
      if (startsAt > nowL) newGames++;
      continue;
    }
    const moved = ex.starts_at !== startsAt || ex.location_id !== locationId;
    const reopen = ex.cancelled_at != null && ex.cancelled_by == null && isImportCancelReason(ex.cancel_reason, connector.name);
    statements.push(
      stmt(
        db,
        `UPDATE events SET starts_at = ?, ends_at = ?, location_id = ?, game_no = ?, home_team = ?, guest_team = ?, is_home = ?,
           home_goals = ?, guest_goals = ?, cancelled_at = CASE WHEN ? = 1 THEN NULL ELSE cancelled_at END,
           cancel_reason = CASE WHEN ? = 1 THEN NULL ELSE cancel_reason END, updated_at = ?
         WHERE id = ?`,
        startsAt,
        endsAt,
        locationId,
        g.number,
        g.home,
        g.guest,
        isHome,
        g.homeGoals,
        g.guestGoals,
        reopen ? 1 : 0,
        reopen ? 1 : 0,
        utcIso(now),
        ex.id,
      ),
    );
    summary.updated++;
    if (reopen && startsAt > nowL) reopened.push({ id: ex.id, startsAt });
    if (moved && startsAt > nowL) {
      summary.moved++;
      movedEvents.push({ id: ex.id, before: ex.starts_at, startsAt, locationId, cancelled: ex.cancelled_at != null && !reopen });
    }
  }

  // Future games no longer delivered count as cancelled, but only those of this team alone
  const delivered = new Set(schedule.games.map((g) => ref(g.externalId)));
  const cancelReason = importCancelReason(connector.name);
  for (const ex of existing) {
    if (!delivered.has(ex.external_ref) && ex.starts_at > nowL && !ex.cancelled_at && !ex.shared) {
      statements.push(stmt(db, "UPDATE events SET cancelled_at = ?, cancel_reason = ?, cancelled_by = NULL WHERE id = ?", utcIso(now), cancelReason, ex.id));
      summary.cancelled++;
      dropped.push({ id: ex.id, startsAt: ex.starts_at });
    }
  }
  // Still no result: count the try, so the sync by itself does not come back for it forever
  const byId = new Map(schedule.games.map((g) => [g.externalId, g]));
  for (const d of resultDue) {
    const g = byId.get(d.externalId);
    if (g?.homeGoals == null || g.guestGoals == null) {
      statements.push(stmt(db, "UPDATE events SET result_tries = result_tries + 1, result_tried_at = ? WHERE id = ?", utcIso(now), d.id));
    }
  }
  // League table from the same response; without one the stored table stays
  const table = cleanTable(schedule.table);
  if (table) {
    statements.push(
      stmt(
        db,
        `INSERT INTO league_tables (team_id, connector, league_name, rows, comment, fetched_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (team_id) DO UPDATE SET connector = excluded.connector, league_name = excluded.league_name, rows = excluded.rows,
           comment = excluded.comment, fetched_at = excluded.fetched_at`,
        team.id,
        connector.id,
        table.leagueName,
        JSON.stringify(table.rows),
        table.comment,
        utcIso(now),
      ),
    );
  }
  statements.push(stmt(db, "UPDATE teams SET fixture_synced_at = ?, fixture_error = NULL, fixture_claimed_at = NULL WHERE id = ?", utcIso(now), team.id));
  for (let i = 0; i < statements.length; i += 80) await db.batch(statements.slice(i, i + 80));
  // With an automatic squad, new games get the core squad right away (without push)
  await syncAutoSquads(db, [team.id], now);

  await notifySync(env, team, connector.name, { moved: movedEvents, dropped, reopened, newGames: team.fixture_synced_at ? newGames : 0 });
  return summary;
}

/**
 * Pushes after a sync, the same by button or by itself (docs/dev/connectors.md): a move to the team (players, parents,
 * staff) and to the coaches with old and new time; a game no longer in the schedule counts as cancelled, and one back
 * in it takes place after all, both to the team and the coaches; fans of the game hear of all three at short notice
 * (hook eventChanged). New games only to the coaches (the team hears of them with the squad), not on a team's first
 * sync. Results without push.
 */
async function notifySync(
  env: Env,
  team: TeamFixtures,
  source: string,
  changes: {
    moved: { id: number; before: string; startsAt: string; locationId: number | null; cancelled: boolean }[];
    dropped: { id: number; startsAt: string }[];
    reopened: { id: number; startsAt: string }[];
    newGames: number;
  },
): Promise<void> {
  const db = env.DB;
  const { moved: movedEvents, dropped, reopened, newGames } = changes;
  const teamName = team.name;
  // The team (players, helpers, staff; parents through notifyPersons), loaded once when needed
  let teamPeople: number[] | null = null;
  const playersOnce = async () =>
    (teamPeople ??= (
      await all<{ person_id: number }>(
        db,
        `SELECT tm.person_id FROM team_memberships tm JOIN persons p ON p.id = tm.person_id
          WHERE tm.team_id = ? AND tm.role IN ('player', 'helper', 'staff') AND p.is_active = 1 AND p.is_former = 0`,
        team.id,
      )
    ).map((r) => r.person_id));

  // The throw-off time or hall changed
  if (movedEvents.length) {
    const players = await playersOnce();
    for (const m of movedEvents) {
      const loc = m.locationId ? await first<{ name: string }>(db, "SELECT name FROM locations WHERE id = ?", m.locationId) : null;
      const location = loc?.name ?? null;
      await notifyPersons(
        env,
        players,
        "events",
        () => {
          const date = shortDate(m.startsAt);
          const time = shortTime(m.startsAt);
          return {
            title: t`Game moved (${teamName})`,
            body: location ? t`New start of play: ${date}, ${time}, ${location}.` : t`New start of play: ${date}, ${time}.`,
            url: `/termine/${m.id}`,
          };
        },
        { teamIds: [team.id] },
      );
      if (m.cancelled) continue;
      // The coaches with the old time, so they can check with the opponent or the hall
      await notifyCoaches(env, [team.id], () => {
        const oldDate = shortDate(m.before);
        const oldTime = shortTime(m.before);
        const date = shortDate(m.startsAt);
        const time = shortTime(m.startsAt);
        return {
          title: t`Game moved (${teamName})`,
          body: location
            ? t`According to ${source} from ${oldDate}, ${oldTime} to ${date}, ${time}, ${location}.`
            : t`According to ${source} from ${oldDate}, ${oldTime} to ${date}, ${time}.`,
          url: `/termine/${m.id}`,
        };
      });
      // Others (fans of the game) after the team
      await moduleEventChanged(env, { change: "moved", eventId: m.id, kind: "game", teamIds: [team.id], before: m.before, startsAt: m.startsAt, exclude: [] });
    }
  }

  // No longer in the schedule, or back in it. The text names the source: games sometimes vanish there only for a while.
  for (const [items, change] of [
    [dropped, "cancelled"],
    [reopened, "restored"],
  ] as const) {
    if (!items.length) continue;
    const players = await playersOnce();
    for (const m of items) {
      const content = () => {
        const when = `${shortDate(m.startsAt)}, ${shortTime(m.startsAt)}`;
        return change === "cancelled"
          ? { title: t`Game cancelled (${teamName})`, body: t`The game on ${when} is no longer in the schedule of ${source} and counts as cancelled.`, url: `/termine/${m.id}` }
          : { title: t`Game going ahead (${teamName})`, body: t`The game on ${when} is back in the schedule of ${source}.`, url: `/termine/${m.id}` };
      };
      await notifyPersons(env, players, "events", content, { teamIds: [team.id] });
      await notifyCoaches(env, [team.id], content);
      await moduleEventChanged(env, { change, eventId: m.id, kind: "game", teamIds: [team.id], before: m.startsAt, startsAt: m.startsAt, exclude: [] });
    }
  }

  if (newGames) {
    await notifyCoaches(env, [team.id], () => ({
      title: t`New games (${teamName})`,
      body: plural(newGames, { one: `One new game is in the schedule of ${source}.`, other: `# new games are in the schedule of ${source}.` }),
      url: `/team/${team.id}`,
    }));
  }
}
