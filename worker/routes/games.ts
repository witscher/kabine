import { t } from "@lingui/core/macro";
import { Hono } from "hono";
import { z } from "zod";
import { type AppEnv, intParam, requireActor } from "../app";
import { isCoachOf, requireCoach } from "../auth/actor";
import { syncAutoSquads } from "../domain/auto-squad";
import { H4aFormatError, h4aFetchUrl, matchdayHost, matchdayIsHome, ownTeamName, parsePortalUrl, parseSchedule } from "../domain/h4a";
import { requireTeam } from "../domain/groups";
import { notifyPersons, shortDate, shortTime } from "../domain/notify";
import { all, first, list, run, stmt } from "../lib/db";
import { ApiError, badRequest, conflict, notFound, parse, readJson } from "../lib/http";
import { addMinutesLocal, nowLocal, utcIso } from "../lib/time";
import { LOCALES } from "../../shared/i18n";
import { withLocale } from "../i18n";

export const gameRoutes = new Hono<AppEnv>();

/** Sync by hand only, at most every 10 minutes. */
export const CLAIM_MS = 10 * 60_000;
/** Cancel reason of games that disappeared from the schedule; stored in the language of the import. */
const importCancelReason = () => t`Game no longer in the schedule (handball4all)`;
/** Recognises the reason in any language (the import may have run in another one). */
const isImportCancelReason = (reason: string | null) => LOCALES.some((l) => withLocale(l, importCancelReason) === reason);

interface TeamH4a {
  id: number;
  name: string;
  h4a_org_id: number | null;
  h4a_league_id: number | null;
  h4a_team_id: number | null;
  h4a_imported_at: string | null;
  h4a_import_error: string | null;
  h4a_claimed_at: string | null;
}

async function teamH4a(db: D1Database, teamId: number): Promise<TeamH4a> {
  const team = await first<TeamH4a>(
    db,
    "SELECT id, name, h4a_org_id, h4a_league_id, h4a_team_id, h4a_imported_at, h4a_import_error, h4a_claimed_at FROM teams WHERE id = ?",
    teamId,
  );
  if (!team) throw notFound(t`This team does not exist.`);
  return team;
}

function sourceView(team: TeamH4a) {
  const configured = team.h4a_org_id != null && team.h4a_league_id != null && team.h4a_team_id != null;
  return {
    configured,
    ids: configured ? { orgId: team.h4a_org_id, leagueId: team.h4a_league_id, teamId: team.h4a_team_id } : null,
    fetchUrl: configured ? h4aFetchUrl(team.h4a_org_id!, team.h4a_league_id!, team.h4a_team_id!) : null,
    importedAt: team.h4a_imported_at,
    error: team.h4a_import_error,
  };
}

gameRoutes.get("/teams/:id/games/source", async (c) => {
  const actor = requireActor(c);
  const teamId = intParam(c, "id");
  requireCoach(actor, teamId);
  return c.json(sourceView(await teamH4a(c.env.DB, teamId)));
});

gameRoutes.put("/teams/:id/games/source", async (c) => {
  const actor = requireActor(c);
  const teamId = intParam(c, "id");
  requireCoach(actor, teamId);
  await requireTeam(c.env.DB, teamId);
  const { portalUrl } = parse(z.object({ portalUrl: z.string().max(500).nullable() }), await readJson(c.req.raw));
  if (portalUrl === null) {
    await run(c.env.DB, "UPDATE teams SET h4a_org_id = NULL, h4a_league_id = NULL, h4a_team_id = NULL, h4a_portal = NULL, h4a_import_error = NULL WHERE id = ?", teamId);
    return c.json(sourceView(await teamH4a(c.env.DB, teamId)));
  }
  const ids = parsePortalUrl(portalUrl);
  if (!ids) throw badRequest(t`Please paste the link to the team page from the handball4all portal (with ogId, lId and tId).`);
  await run(
    c.env.DB,
    "UPDATE teams SET h4a_org_id = ?, h4a_league_id = ?, h4a_team_id = ?, h4a_portal = ?, h4a_imported_at = NULL, h4a_import_error = NULL WHERE id = ?",
    ids.orgId,
    ids.leagueId,
    ids.teamId,
    ids.portal,
    teamId,
  );
  return c.json(sourceView(await teamH4a(c.env.DB, teamId)));
});

/**
 * One device reserves the fetch, so several devices never query handball4all
 * at the same time. The server rejects fetches without `manual` (fair use).
 */
gameRoutes.post("/teams/:id/games/claim", async (c) => {
  const actor = requireActor(c);
  const teamId = intParam(c, "id");
  requireCoach(actor, teamId);
  const { manual } = parse(z.object({ manual: z.boolean().default(false) }), await readJson(c.req.raw));
  const team = await teamH4a(c.env.DB, teamId);
  const view = sourceView(team);
  if (!view.configured) throw conflict(t`No handball4all link is set for this team.`);
  const now = Date.now();
  // handball4all is fair use: only at the push of a button by a coach or admin, never automatically
  if (!manual) return c.json({ claimed: false, reason: "manual_only" });
  if (team.h4a_imported_at && now - Date.parse(team.h4a_imported_at) < CLAIM_MS) {
    return c.json({ claimed: false, reason: "recent", retryAt: utcIso(Date.parse(team.h4a_imported_at) + CLAIM_MS) });
  }
  const res = await run(
    c.env.DB,
    "UPDATE teams SET h4a_claimed_at = ? WHERE id = ? AND (h4a_claimed_at IS NULL OR h4a_claimed_at < ?)",
    utcIso(now),
    teamId,
    utcIso(now - CLAIM_MS),
  );
  if (!res.meta.changes) return c.json({ claimed: false, reason: "busy" });
  return c.json({ claimed: true, fetchUrl: view.fetchUrl });
});

/** Fetch on the device failed: release the reservation and remember the error. */
gameRoutes.post("/teams/:id/games/release", async (c) => {
  const actor = requireActor(c);
  const teamId = intParam(c, "id");
  requireCoach(actor, teamId);
  const { error } = parse(z.object({ error: z.string().max(300).default("") }), await readJson(c.req.raw));
  await run(
    c.env.DB,
    "UPDATE teams SET h4a_claimed_at = NULL, h4a_import_error = ? WHERE id = ?",
    error ? t`Fetch failed: ${error}` : null,
    teamId,
  );
  return c.json({ ok: true });
});

gameRoutes.post("/teams/:id/games/import", async (c) => {
  const actor = requireActor(c);
  const teamId = intParam(c, "id");
  requireCoach(actor, teamId);
  const body = (await readJson(c.req.raw)) as { data?: unknown };
  const team = await teamH4a(c.env.DB, teamId);
  if (!team.h4a_claimed_at || Date.now() - Date.parse(team.h4a_claimed_at) > CLAIM_MS) {
    throw conflict(t`The fetch was not reserved or has expired. Please try again.`);
  }
  try {
    const summary = await importGames(c.env, team, body.data, Date.now(), (id) => isCoachOf(actor, id));
    return c.json(summary);
  } catch (err) {
    const detail = err instanceof Error ? err.message : "";
    const message =
      err instanceof H4aFormatError
        ? t`Unexpected format from handball4all: ${detail}`
        : err instanceof ApiError
          ? err.message
          : t`The schedule could not be processed.`;
    await run(c.env.DB, "UPDATE teams SET h4a_import_error = ?, h4a_claimed_at = NULL WHERE id = ?", message, teamId);
    if (!(err instanceof H4aFormatError) && !(err instanceof ApiError)) console.error("Schedule import", err);
    throw new ApiError(422, "import_failed", message);
  }
});

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
 * The schedule comes from the coach's browser and is not trusted: it must name the team's league, and a game that
 * already belongs to another team is only linked when the importer may coach that team too (`mayCoach`).
 */
export async function importGames(
  env: Env,
  team: TeamH4a,
  data: unknown,
  now = Date.now(),
  mayCoach: (teamId: number) => boolean = () => false,
): Promise<ImportSummary> {
  const db = env.DB;
  const schedule = parseSchedule(data);
  if (team.h4a_league_id != null && schedule.leagueId !== String(team.h4a_league_id)) {
    throw new H4aFormatError(schedule.leagueId ? t`The data belongs to another league` : t`The data names no league`);
  }
  const halls = await all<{ id: number; h4a_gym_id: number | null }>(db, "SELECT id, h4a_gym_id FROM locations WHERE kind = 'hall'");
  const homeGyms = new Set(halls.map((h) => h.h4a_gym_id).filter((x): x is number => x != null));
  const hint = schedule.teams.find((t) => t.teamId === String(team.h4a_team_id))?.teamName ?? null;
  // Matchdays carry the placeholder "Spieltag …" in every entry; the own name only appears in real games
  const own = ownTeamName(
    schedule.games.filter((g) => matchdayHost(g) == null),
    hint,
    homeGyms,
  );

  // Create or reuse halls
  const gymIds = [...new Set(schedule.games.map((g) => g.gymId).filter((x): x is number => x != null))];
  const missing = new Map<number, (typeof schedule.games)[number]>();
  const known = await all<{ id: number; h4a_gym_id: number }>(
    db,
    "SELECT id, h4a_gym_id FROM locations WHERE h4a_gym_id IN (SELECT value FROM json_each(?))",
    list(gymIds),
  );
  for (const g of schedule.games) if (g.gymId != null && !known.some((k) => k.h4a_gym_id === g.gymId)) missing.set(g.gymId, g);
  if (missing.size) {
    await db.batch(
      [...missing.values()].map((g) =>
        stmt(
          db,
          "INSERT OR IGNORE INTO locations (name, address, map_url, kind, h4a_gym_id) VALUES (?, ?, ?, 'external', ?)",
          g.gymName ?? t`Hall`,
          g.gymAddress,
          g.gymAddress ? `https://www.openstreetmap.org/search?query=${encodeURIComponent(g.gymAddress)}` : null,
          g.gymId,
        ),
      ),
    );
  }
  const locationByGym = new Map(
    (
      await all<{ id: number; h4a_gym_id: number }>(
        db,
        "SELECT id, h4a_gym_id FROM locations WHERE h4a_gym_id IN (SELECT value FROM json_each(?))",
        list(gymIds),
      )
    ).map((l) => [l.h4a_gym_id, l.id]),
  );

  const existing = await all<{
    id: number;
    h4a_game_id: string;
    starts_at: string;
    location_id: number | null;
    cancelled_at: string | null;
    cancelled_by: number | null;
    cancel_reason: string | null;
    shared: number;
  }>(
    db,
    `SELECT e.id, e.h4a_game_id, e.starts_at, e.location_id, e.cancelled_at, e.cancelled_by, e.cancel_reason,
            EXISTS (SELECT 1 FROM event_teams o WHERE o.event_id = e.id AND o.team_id <> et.team_id) AS shared
       FROM events e JOIN event_teams et ON et.event_id = e.id
      WHERE et.team_id = ? AND e.kind = 'game' AND e.h4a_game_id IS NOT NULL`,
    team.id,
  );
  const byId = new Map(existing.map((e) => [e.h4a_game_id, e]));
  // Games of the schedule that other teams already have (e.g. two own teams in the same league)
  const others = new Map(
    (
      await all<{ id: number; h4a_game_id: string; teams: string }>(
        db,
        `SELECT e.id, e.h4a_game_id, (SELECT json_group_array(team_id) FROM event_teams WHERE event_id = e.id) AS teams
           FROM events e WHERE e.h4a_game_id IN (SELECT value FROM json_each(?))`,
        list(schedule.games.map((g) => g.gameId).filter((id) => !byId.has(id))),
      )
    ).map((e) => [e.h4a_game_id, { id: e.id, teams: JSON.parse(e.teams) as number[] }]),
  );
  const nowL = nowLocal(now);
  const statements: D1PreparedStatement[] = [];
  const summary: ImportSummary = { created: 0, updated: 0, moved: 0, cancelled: 0, skipped: schedule.skipped, foreign: 0 };
  const movedEvents: { id: number; startsAt: string; locationId: number | null }[] = [];

  for (const g of schedule.games) {
    const startsAt = `${g.date}T${g.time}`;
    const endsAt = addMinutesLocal(startsAt, 90);
    const locationId = g.gymId != null ? (locationByGym.get(g.gymId) ?? null) : null;
    const isHome =
      matchdayHost(g) != null ? (matchdayIsHome(g, hint, homeGyms) ? 1 : 0) : own == null ? null : g.home === own ? 1 : g.guest === own ? 0 : null;
    const ex = byId.get(g.gameId);
    const other = ex ? undefined : others.get(g.gameId);
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
          `INSERT OR IGNORE INTO events (kind, starts_at, ends_at, location_id, h4a_game_id, h4a_game_no, home_team, guest_team, is_home, home_goals, guest_goals)
           VALUES ('game', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          startsAt,
          endsAt,
          locationId,
          g.gameId,
          g.gameNo,
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
           SELECT id, ? FROM events WHERE h4a_game_id = ? AND NOT EXISTS (SELECT 1 FROM event_teams WHERE event_id = events.id)`,
          team.id,
          g.gameId,
        ),
      );
      summary.created++;
      continue;
    }
    const moved = ex.starts_at !== startsAt || ex.location_id !== locationId;
    const reopen = ex.cancelled_at != null && ex.cancelled_by == null && isImportCancelReason(ex.cancel_reason);
    statements.push(
      stmt(
        db,
        `UPDATE events SET starts_at = ?, ends_at = ?, location_id = ?, h4a_game_no = ?, home_team = ?, guest_team = ?, is_home = ?,
           home_goals = ?, guest_goals = ?, cancelled_at = CASE WHEN ? = 1 THEN NULL ELSE cancelled_at END,
           cancel_reason = CASE WHEN ? = 1 THEN NULL ELSE cancel_reason END, updated_at = ?
         WHERE id = ?`,
        startsAt,
        endsAt,
        locationId,
        g.gameNo,
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
  const delivered = new Set(schedule.games.map((g) => g.gameId));
  const cancelReason = importCancelReason();
  for (const ex of existing) {
    if (!delivered.has(ex.h4a_game_id) && ex.starts_at > nowL && !ex.cancelled_at && !ex.shared) {
      statements.push(
        stmt(db, "UPDATE events SET cancelled_at = ?, cancel_reason = ?, cancelled_by = NULL WHERE id = ?", utcIso(now), cancelReason, ex.id),
      );
      summary.cancelled++;
    }
  }
  statements.push(
    stmt(db, "UPDATE teams SET h4a_imported_at = ?, h4a_import_error = NULL, h4a_claimed_at = NULL WHERE id = ?", utcIso(now), team.id),
  );
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
            body: location ? t`New throw-off: ${date}, ${time}, ${location}.` : t`New throw-off: ${date}, ${time}.`,
            url: `/termine/${m.id}`,
          };
        },
        { teamIds: [team.id] },
      );
    }
  }
  return summary;
}
