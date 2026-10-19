// Game schedules from fixture connectors (modules of kind "fixtures", worker/module-api.ts): which
// connector a team uses, and the sync that is the same for every source: halls, home or away, new,
// moved and cancelled games, notifications. The connector only knows its source.
import { select, t } from "@lingui/core/macro";
import { LOCALES } from "../../shared/i18n";
import type { ModuleId } from "../../shared/modules";
import { withLocale } from "../i18n";
import { all, first, list, stmt } from "../lib/db";
import { addMinutesLocal, nowLocal, utcIso } from "../lib/time";
import type { FixtureConnector, FixtureGame, FixtureSource } from "../module-api";
import { WORKER_MODULES } from "../modules";
import { syncAutoSquads } from "./auto-squad";
import { isModuleOn, ownVenue } from "./club";
import { notifyPersons, shortDate, shortTime } from "./notify";

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
  const statements: D1PreparedStatement[] = [];
  const summary: ImportSummary = { created: 0, updated: 0, moved: 0, cancelled: 0, skipped: schedule.skipped, foreign: 0 };
  const movedEvents: { id: number; startsAt: string; locationId: number | null }[] = [];

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
    if (moved && startsAt > nowL) {
      summary.moved++;
      movedEvents.push({ id: ex.id, startsAt, locationId });
    }
  }

  // Future games no longer delivered count as cancelled, but only those of this team alone
  const delivered = new Set(schedule.games.map((g) => ref(g.externalId)));
  const cancelReason = importCancelReason(connector.name);
  for (const ex of existing) {
    if (!delivered.has(ex.external_ref) && ex.starts_at > nowL && !ex.cancelled_at && !ex.shared) {
      statements.push(stmt(db, "UPDATE events SET cancelled_at = ?, cancel_reason = ?, cancelled_by = NULL WHERE id = ?", utcIso(now), cancelReason, ex.id));
      summary.cancelled++;
    }
  }
  statements.push(stmt(db, "UPDATE teams SET fixture_synced_at = ?, fixture_error = NULL, fixture_claimed_at = NULL WHERE id = ?", utcIso(now), team.id));
  for (let i = 0; i < statements.length; i += 80) await db.batch(statements.slice(i, i + 80));
  // With an automatic squad, new games get the core squad right away (without push)
  await syncAutoSquads(db, [team.id], now);

  // Push when the throw-off time or hall changed
  if (movedEvents.length) {
    const players = await all<{ person_id: number }>(
      db,
      `SELECT tm.person_id FROM team_memberships tm JOIN persons p ON p.id = tm.person_id
        WHERE tm.team_id = ? AND tm.role IN ('player', 'helper', 'staff') AND p.is_active = 1 AND p.is_former = 0`,
      team.id,
    );
    for (const m of movedEvents) {
      const loc = m.locationId ? await first<{ name: string }>(db, "SELECT name FROM locations WHERE id = ?", m.locationId) : null;
      const teamName = team.name;
      const location = loc?.name ?? null;
      await notifyPersons(
        env,
        players.map((p) => p.person_id),
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
    }
  }
  return summary;
}
