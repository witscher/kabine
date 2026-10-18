// Game schedule of a team from a fixture connector (modules of kind "fixtures"): link the team's page at
// the source, then sync at the press of a button. Sources that block servers are fetched by the coach's
// device (fetchFrom "device"), the others by the server. The sync itself is in domain/fixtures.ts.
import { t } from "@lingui/core/macro";
import { Hono } from "hono";
import { z } from "zod";
import { type AppEnv, intParam, requireActor } from "../app";
import { isCoachOf, requireAdmin, requireCoach } from "../auth/actor";
import { activeConnectors, allConnectors, type Connector, connectorById, importGames, TEAM_FIXTURES_SELECT, type TeamFixtures, teamSource } from "../domain/fixtures";
import { requireTeam } from "../domain/groups";
import { all, first, run } from "../lib/db";
import { ApiError, badRequest, conflict, notFound, parse, readJson } from "../lib/http";
import { nowLocal, utcIso } from "../lib/time";
import { FixtureFormatError } from "../module-api";

export const gameRoutes = new Hono<AppEnv>();

/** A reservation to fetch expires after this long. */
export const CLAIM_MS = 10 * 60_000;

// Without a fixtures module switched on, the schedule routes do not exist
gameRoutes.use("/teams/:id/games/*", async (c, next) => {
  if (!activeConnectors().length) throw new ApiError(404, "module_off", t`This function is switched off for this club.`);
  await next();
});

async function teamFixtures(db: D1Database, teamId: number): Promise<TeamFixtures> {
  const team = await first<TeamFixtures>(db, `${TEAM_FIXTURES_SELECT} WHERE id = ?`, teamId);
  if (!team) throw notFound(t`This team does not exist.`);
  return team;
}

/** The team's connector if it is linked and its module is on. */
function linked(team: TeamFixtures): { connector: Connector; source: NonNullable<ReturnType<typeof teamSource>> } | null {
  const connector = activeConnectors().find((x) => x.id === team.fixture_connector);
  const source = teamSource(team);
  return connector && source ? { connector, source } : null;
}

/** Upcoming games of the team that came from its source (they stay, unsynced, when the source changes). */
async function linkedGames(db: D1Database, team: TeamFixtures): Promise<number> {
  if (!team.fixture_connector) return 0;
  const row = await first<{ n: number }>(
    db,
    `SELECT count(*) AS n FROM events e JOIN event_teams et ON et.event_id = e.id
      WHERE et.team_id = ? AND e.kind = 'game' AND e.external_ref LIKE ? ESCAPE '\\' AND e.starts_at > ?`,
    team.id,
    `${team.fixture_connector.replace(/[\\%_]/g, (ch) => `\\${ch}`)}:%`,
    nowLocal(),
  );
  return row?.n ?? 0;
}

async function sourceView(db: D1Database, team: TeamFixtures) {
  const link = linked(team);
  const stored = connectorById(team.fixture_connector);
  return {
    configured: !!link,
    connector: link ? { id: link.connector.id, name: link.connector.name, fetchFrom: link.connector.fetchFrom } : null,
    description: link ? link.connector.describe(link.source) : null,
    fetchUrl: link && link.connector.fetchFrom === "device" ? link.connector.request(link.source).url : null,
    importedAt: team.fixture_synced_at,
    error: team.fixture_error,
    /** The team's source while its module is switched off (sync paused), else null. */
    paused: !link && stored && teamSource(team) ? { id: stored.id, name: stored.name } : null,
    /** Upcoming games from the team's source; switching or removing the source leaves them unsynced. */
    linkedGames: await linkedGames(db, team),
    /** Sources a coach can choose (switched-on fixture modules), with the texts for the link field. One per team. */
    connectors: activeConnectors().map((x) => ({ id: x.id, name: x.name, link: x.linkField() })),
  };
}

gameRoutes.get("/teams/:id/games/source", async (c) => {
  const actor = requireActor(c);
  const teamId = intParam(c, "id");
  requireCoach(actor, teamId);
  return c.json(await sourceView(c.env.DB, await teamFixtures(c.env.DB, teamId)));
});

gameRoutes.put("/teams/:id/games/source", async (c) => {
  const actor = requireActor(c);
  const teamId = intParam(c, "id");
  requireCoach(actor, teamId);
  await requireTeam(c.env.DB, teamId);
  // A team has one source: the chosen connector (or, without a choice, the first that recognises the link)
  const { link, connector: chosen } = parse(
    z.object({ link: z.string().max(500).nullable(), connector: z.string().max(40).optional() }),
    await readJson(c.req.raw),
  );
  if (link === null) {
    await run(
      c.env.DB,
      "UPDATE teams SET fixture_connector = NULL, fixture_source = NULL, fixture_synced_at = NULL, fixture_error = NULL WHERE id = ?",
      teamId,
    );
    return c.json(await sourceView(c.env.DB, await teamFixtures(c.env.DB, teamId)));
  }
  const candidates = activeConnectors().filter((x) => !chosen || x.id === chosen);
  if (chosen && !candidates.length) throw badRequest(t`This game schedule source is not switched on.`);
  const match = candidates.map((connector) => ({ connector, source: connector.parseLink(link) })).find((x) => x.source);
  if (!match) {
    const names = candidates.map((x) => x.name).join(", ");
    throw badRequest(t`Please paste the link to your team's page at ${names}.`);
  }
  await run(
    c.env.DB,
    "UPDATE teams SET fixture_connector = ?, fixture_source = ?, fixture_synced_at = NULL, fixture_error = NULL WHERE id = ?",
    match.connector.id,
    JSON.stringify(match.source),
    teamId,
  );
  return c.json(await sourceView(c.env.DB, await teamFixtures(c.env.DB, teamId)));
});

/** Administration → Club: how many teams use each game schedule source, also while it is switched off. */
gameRoutes.get("/admin/fixture-sources", async (c) => {
  requireAdmin(requireActor(c));
  const rows = await all<{ fixture_connector: string; n: number }>(
    c.env.DB,
    "SELECT fixture_connector, count(*) AS n FROM teams WHERE fixture_connector IS NOT NULL GROUP BY fixture_connector",
  );
  return c.json({ sources: allConnectors().map((x) => ({ id: x.id, name: x.name, teams: rows.find((r) => r.fixture_connector === x.id)?.n ?? 0 })) });
});

/**
 * One device reserves the fetch, so several devices never query the source at the same time. Only at the
 * push of a button (`manual`), never automatically. Sources fetched by the server are synced right away.
 */
gameRoutes.post("/teams/:id/games/claim", async (c) => {
  const actor = requireActor(c);
  const teamId = intParam(c, "id");
  requireCoach(actor, teamId);
  const { manual } = parse(z.object({ manual: z.boolean().default(false) }), await readJson(c.req.raw));
  const team = await teamFixtures(c.env.DB, teamId);
  const link = linked(team);
  if (!link) throw conflict(t`No game schedule is linked for this team.`);
  const now = Date.now();
  if (!manual) return c.json({ claimed: false, reason: "manual_only" });
  if (team.fixture_synced_at && now - Date.parse(team.fixture_synced_at) < link.connector.minIntervalMs) {
    return c.json({ claimed: false, reason: "recent", retryAt: utcIso(Date.parse(team.fixture_synced_at) + link.connector.minIntervalMs) });
  }
  const res = await run(
    c.env.DB,
    "UPDATE teams SET fixture_claimed_at = ? WHERE id = ? AND (fixture_claimed_at IS NULL OR fixture_claimed_at < ?)",
    utcIso(now),
    teamId,
    utcIso(now - CLAIM_MS),
  );
  if (!res.meta.changes) return c.json({ claimed: false, reason: "busy" });
  if (link.connector.fetchFrom === "device") return c.json({ claimed: true, fetchUrl: link.connector.request(link.source).url });

  // Fetched by the server
  const { url, headers } = link.connector.request(link.source);
  let data: unknown;
  try {
    const fetched = await fetch(url, { headers, cf: { cacheTtl: 0 } } as RequestInit);
    if (!fetched.ok) throw new Error(`HTTP ${fetched.status}`);
    data = await fetched.json();
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    await run(c.env.DB, "UPDATE teams SET fixture_claimed_at = NULL, fixture_error = ? WHERE id = ?", t`Fetch failed: ${detail}`, teamId);
    throw new ApiError(503, "fetch_failed", t`Fetch failed: ${detail}`);
  }
  return c.json({ claimed: true, summary: await runImport(c.env, team, data, (id) => isCoachOf(actor, id)) });
});

/** Fetch on the device failed: release the reservation and remember the error. */
gameRoutes.post("/teams/:id/games/release", async (c) => {
  const actor = requireActor(c);
  const teamId = intParam(c, "id");
  requireCoach(actor, teamId);
  const { error } = parse(z.object({ error: z.string().max(300).default("") }), await readJson(c.req.raw));
  await run(c.env.DB, "UPDATE teams SET fixture_claimed_at = NULL, fixture_error = ? WHERE id = ?", error ? t`Fetch failed: ${error}` : null, teamId);
  return c.json({ ok: true });
});

/** The schedule the device fetched. */
gameRoutes.post("/teams/:id/games/import", async (c) => {
  const actor = requireActor(c);
  const teamId = intParam(c, "id");
  requireCoach(actor, teamId);
  const body = (await readJson(c.req.raw)) as { data?: unknown };
  const team = await teamFixtures(c.env.DB, teamId);
  if (!linked(team)) throw conflict(t`No game schedule is linked for this team.`);
  if (!team.fixture_claimed_at || Date.now() - Date.parse(team.fixture_claimed_at) > CLAIM_MS) {
    throw conflict(t`The fetch was not reserved or has expired. Please try again.`);
  }
  return c.json(await runImport(c.env, team, body.data, (id) => isCoachOf(actor, id)));
});

async function runImport(env: Env, team: TeamFixtures, data: unknown, mayCoach: (teamId: number) => boolean) {
  const name = connectorById(team.fixture_connector)?.name ?? "";
  try {
    return await importGames(env, team, data, Date.now(), mayCoach);
  } catch (err) {
    const detail = err instanceof Error ? err.message : "";
    const message =
      err instanceof FixtureFormatError ? t`Unexpected format from ${name}: ${detail}` : err instanceof ApiError ? err.message : t`The schedule could not be processed.`;
    await run(env.DB, "UPDATE teams SET fixture_error = ?, fixture_claimed_at = NULL WHERE id = ?", message, team.id);
    if (!(err instanceof FixtureFormatError) && !(err instanceof ApiError)) console.error("Schedule import", err);
    throw new ApiError(422, "import_failed", message);
  }
}
