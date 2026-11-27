// League tables (docs/dev/connectors.md): a connector may deliver the table of the team's league with the schedule;
// the sync stores it per team (worker/domain/fixtures.ts, importGames), without an extra fetch. Public data of the
// source, so everyone who sees a game sees it. Only while the team still takes its games from that source.
import type { LeagueTable, LeagueTableRow } from "../../shared/types";
import type { ModuleId } from "../../shared/modules";
import { all, list } from "../lib/db";
import { isModuleOn } from "./club";
import { connectorById } from "./fixtures";

interface TableRow {
  team_id: number;
  connector: string;
  league_name: string | null;
  rows: string;
  comment: string | null;
  fetched_at: string;
}

/** Stored tables of these teams (all: undefined) whose source is still the team's and switched on. One query. */
async function currentTables(db: D1Database, teamIds: readonly number[] | undefined, columns = "l.league_name, l.rows, l.comment, l.fetched_at"): Promise<TableRow[]> {
  if (teamIds && !teamIds.length) return [];
  const rows = await all<TableRow>(
    db,
    `SELECT l.team_id, l.connector, ${columns}
       FROM league_tables l JOIN teams t ON t.id = l.team_id AND t.fixture_connector = l.connector
      ${teamIds ? "WHERE l.team_id IN (SELECT value FROM json_each(?))" : ""}`,
    ...(teamIds ? [list([...teamIds])] : []),
  );
  return rows.filter((r) => isModuleOn(r.connector as ModuleId) && connectorById(r.connector));
}

/** The table of the first of these teams (in this order) that has one, e.g. for a game of two own teams. */
export async function loadLeagueTable(db: D1Database, teamIds: readonly number[]): Promise<LeagueTable | null> {
  const tables = await currentTables(db, teamIds);
  const r = teamIds.map((id) => tables.find((x) => x.team_id === id)).find(Boolean);
  if (!r) return null;
  return {
    source: connectorById(r.connector)!.name,
    leagueName: r.league_name,
    comment: r.comment,
    fetchedAt: r.fetched_at,
    rows: JSON.parse(r.rows) as LeagueTableRow[],
  };
}

/**
 * Which of these teams play in a league with a table (one from their source is stored), e.g. to show what a result
 * means for the table. Without teamIds: all teams of the club. One query.
 */
export async function teamsWithLeagueTable(db: D1Database, teamIds?: readonly number[]): Promise<Set<number>> {
  return new Set((await currentTables(db, teamIds, "NULL AS rows")).map((r) => r.team_id));
}

/** Does this team's league have a table? */
export async function hasLeagueTable(db: D1Database, teamId: number): Promise<boolean> {
  return (await teamsWithLeagueTable(db, [teamId])).has(teamId);
}
