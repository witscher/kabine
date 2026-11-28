// Fans: follow other teams of the club and see their games (modules/fans/README.md). Fans only get data that is
// public anyway (kick-off, venue, opponent, result, cancellation), so fan games do not go through the event context
// and summaries of the core (squad, responses, names), but through this narrow query of their own.
import { t } from "@lingui/core/macro";
import type { TeamRef } from "../../../shared/types";
import type { Actor } from "../../../worker/auth/actor";
import { cachedTeamInfo, EVENT_COLUMNS, EVENT_JOINS, type EventRow, eventTitle, gameLiveMinutes, gameSource, gameTable, shortGameTitle, type TeamInfo } from "../../../worker/domain/events";
import { enqueuePush, shortDate, shortTime } from "../../../worker/domain/notify";
import { cacheVersions } from "../../../worker/lib/cache";
import { all, first, list, run } from "../../../worker/lib/db";
import { teamsWithLeagueTable } from "../../../worker/domain/league-table";
import { localToInstant } from "../../../worker/lib/time";
import type { EventChange } from "../../../worker/module-api";
import type { FanGame, FollowTeam } from "../types";

/** Teams whose events one sees anyway: one's own (any role) and the children's where parents are involved. */
export function ownTeamIds(actor: Actor): number[] {
  const ids = new Set(actor.memberships.map((m) => m.teamId));
  for (const ms of actor.childMemberships.values()) for (const m of ms) if (m.parentsEnabled) ids.add(m.teamId);
  return [...ids];
}

/** Teams of the club (not groups), from the cache per Worker instance. */
async function clubTeams(db: D1Database): Promise<TeamInfo[]> {
  return (await cachedTeamInfo(db, await cacheVersions(db))).filter((tm) => tm.kind === "team");
}

/** Ids of every team of the club (the view of all its games). */
export async function clubTeamIds(db: D1Database): Promise<number[]> {
  return (await clubTeams(db)).map((tm) => tm.id);
}

/** Every team of the club for the page "Fan of …", own ones fixed. */
export async function followTeams(db: D1Database, actor: Actor): Promise<FollowTeam[]> {
  const [teams, followed] = await Promise.all([clubTeams(db), followedTeams(db, actor)]);
  const own = new Set(ownTeamIds(actor));
  const following = new Set(followed.map((tm) => tm.id));
  return teams.map((tm) => ({ id: tm.id, name: tm.name, own: own.has(tm.id), following: following.has(tm.id) }));
}

/** Teams one follows, without one's own (a follow stays when one joins the team, but means nothing then). */
export async function followedTeams(db: D1Database, actor: Actor): Promise<TeamRef[]> {
  const rows = await all<{ team_id: number }>(db, "SELECT team_id FROM fan_follows WHERE account_id = ?", actor.accountId);
  if (!rows.length) return [];
  const ids = new Set(rows.map((r) => r.team_id));
  const own = new Set(ownTeamIds(actor));
  return (await clubTeams(db)).filter((tm) => ids.has(tm.id) && !own.has(tm.id)).map((tm) => ({ id: tm.id, name: tm.name }));
}

/** Accounts following any of these teams (hook follows, e.g. the home game day): starts at the teams (fan_follows_team). */
export async function followerAccounts(db: D1Database, teamIds: number[]): Promise<{ accountId: number; teamId: number }[]> {
  if (!teamIds.length) return [];
  return all<{ accountId: number; teamId: number }>(
    db,
    `SELECT f.account_id AS accountId, f.team_id AS teamId FROM fan_follows f JOIN accounts a ON a.id = f.account_id AND a.disabled_at IS NULL
      WHERE f.team_id IN (SELECT value FROM json_each(?))`,
    list(teamIds),
  );
}

export async function setFollow(db: D1Database, actor: Actor, teamId: number, follow: boolean): Promise<void> {
  if (follow) await run(db, "INSERT OR IGNORE INTO fan_follows (account_id, team_id) VALUES (?, ?)", actor.accountId, teamId);
  else await run(db, "DELETE FROM fan_follows WHERE account_id = ? AND team_id = ?", actor.accountId, teamId);
}

/** The switches of the account: "Home games only" and "Games as a fan" in the calendar (a row means on). */
export async function fanSettings(db: D1Database, accountId: number): Promise<{ homeOnly: boolean; calendar: boolean }> {
  const row = await first<{ home: number; cal: number }>(
    db,
    `SELECT EXISTS (SELECT 1 FROM fan_home_only WHERE account_id = ?1) AS home, EXISTS (SELECT 1 FROM fan_calendar WHERE account_id = ?1) AS cal`,
    accountId,
  );
  return { homeOnly: row?.home === 1, calendar: row?.cal === 1 };
}

export async function setFanSetting(db: D1Database, accountId: number, table: "fan_home_only" | "fan_calendar", on: boolean): Promise<void> {
  if (on) await run(db, `INSERT OR IGNORE INTO ${table} (account_id) VALUES (?)`, accountId);
  else await run(db, `DELETE FROM ${table} WHERE account_id = ?`, accountId);
}

type GameRow = EventRow & { team_ids: string };

/**
 * Games of these teams in the window, without games of one's own teams (they are listed as one's own events).
 * Starts at the teams (index event_teams_team), so it reads only their games. With `limit`, at most that many and
 * `more` when there are further ones.
 */
export async function fanGames(
  db: D1Database,
  actor: Actor,
  opts: { teamIds: number[]; from: string; to: string; desc?: boolean; homeOnly?: boolean; limit?: number; following?: number[] },
): Promise<{ games: FanGame[]; more: boolean }> {
  if (!opts.teamIds.length) return { games: [], more: false };
  const limit = opts.limit ?? 500;
  const rows = await all<GameRow>(
    db,
    `WITH ids(id) AS MATERIALIZED (SELECT DISTINCT event_id FROM event_teams WHERE team_id IN (SELECT value FROM json_each(?1)))
     SELECT ${EVENT_COLUMNS}, (SELECT json_group_array(team_id) FROM event_teams WHERE event_id = e.id) AS team_ids
       FROM ids CROSS JOIN events e ON e.id = ids.id${EVENT_JOINS}
      WHERE e.kind = 'game' AND e.starts_at >= ?2 AND e.starts_at < ?3${opts.homeOnly ? " AND e.is_home = 1" : ""}
        AND NOT EXISTS (SELECT 1 FROM event_teams x WHERE x.event_id = e.id AND x.team_id IN (SELECT value FROM json_each(?4)))
      ORDER BY e.starts_at${opts.desc ? " DESC" : ""}, e.id${opts.desc ? " DESC" : ""}
      LIMIT ?5`,
    list(opts.teamIds),
    opts.from,
    opts.to,
    list(ownTeamIds(actor)),
    limit + 1,
  );
  const more = rows.length > limit;
  const teams = new Map((await clubTeams(db)).map((tm) => [tm.id, tm]));
  const following = new Set(opts.following ?? opts.teamIds);
  return { games: rows.slice(0, limit).map((e) => toFanGame(e, teams, following)), more };
}

function toFanGame(e: GameRow, info: Map<number, TeamInfo>, following: Set<number>): FanGame {
  const ids = JSON.parse(e.team_ids) as number[];
  const teams = ids.map((id) => info.get(id)).filter((tm): tm is TeamInfo => !!tm);
  return {
    id: e.id,
    kind: "game",
    title: eventTitle(e, teams),
    shortTitle: shortGameTitle(e, teams),
    startsAt: e.starts_at,
    endsAt: e.ends_at,
    teams: teams.map((tm) => ({ id: tm.id, name: tm.name })),
    isHome: e.is_home == null ? null : e.is_home === 1,
    location: e.loc_name ? { name: e.loc_name, address: e.loc_address, mapUrl: e.loc_map_url } : null,
    cancelled: e.cancelled_at ? { at: e.cancelled_at } : null,
    result: e.home_goals != null && e.guest_goals != null ? { home: e.home_goals, guest: e.guest_goals } : null,
    game: {
      homeTeam: e.home_team,
      guestTeam: e.guest_team,
      isHome: e.is_home == null ? null : e.is_home === 1,
      homeGoals: e.home_goals,
      guestGoals: e.guest_goals,
      table: gameTable(teams),
      source: gameSource(e, teams),
      liveMinutes: gameLiveMinutes(teams.map((tm) => tm.game_minutes)),
    },
    following: ids.some((id) => following.has(id)),
  };
}

/**
 * Games with a result learn whether their league has a table (then the result shows the outcome word, src/result.tsx).
 * One query, and only when a game has a result.
 */
export async function withLeagueTables(db: D1Database, games: FanGame[]): Promise<FanGame[]> {
  const scored = games.filter((g) => g.result && g.game);
  if (!scored.length) return games;
  const tables = await teamsWithLeagueTable(db, [...new Set(scored.flatMap((g) => g.teams.map((tm) => tm.id)))]);
  return games.map((g) => (g.result && g.game ? { ...g, game: { ...g.game, inTable: g.teams.some((tm) => tables.has(tm.id)) } } : g));
}

/**
 * One game of a team of the club with its game data (page `/spiel/:id`): for fans and for the view of all games of
 * the club. The data is public anyway, so every signed-in person may see it; games of groups are not games of the club.
 */
export async function fanGame(db: D1Database, actor: Actor, eventId: number): Promise<FanGame | null> {
  const e = await first<GameRow>(
    db,
    `SELECT ${EVENT_COLUMNS}, (SELECT json_group_array(team_id) FROM event_teams WHERE event_id = e.id) AS team_ids
       FROM events e${EVENT_JOINS}
      WHERE e.id = ? AND e.kind = 'game'`,
    eventId,
  );
  if (!e) return null;
  const teams = new Map((await clubTeams(db)).map((tm) => [tm.id, tm]));
  if (!(JSON.parse(e.team_ids) as number[]).some((id) => teams.has(id))) return null;
  const followed = (await followedTeams(db, actor)).map((tm) => tm.id);
  return toFanGame(e, teams, new Set(followed));
}

/** Short notice: at most this many hours before kick-off. */
export const SHORT_NOTICE_HOURS = 72;

/**
 * Push to the fans of a game moved or cancelled at short notice: only while it is still ahead and at most 72 hours
 * before kick-off (the earlier of the old and the new start that is still ahead). Without the reason. Whoever belongs
 * to one of the game's teams (any role, or as a parent where parents are involved) already got the team's push and
 * gets nothing here. Topic
 * `fans` of the account's own person; with "Home games only" only home games.
 */
export async function notifyFans(env: Env, change: EventChange, now = Date.now()): Promise<number> {
  if (change.kind !== "game" || !change.teamIds.length) return 0;
  const ahead = [change.before, change.startsAt].filter((s) => localToInstant(s) > now).sort();
  const start = ahead[0];
  if (!start || localToInstant(start) - now > SHORT_NOTICE_HOURS * 3_600_000) return 0;
  const event = await first<EventRow & { team_ids: string }>(
    env.DB,
    `SELECT ${EVENT_COLUMNS}, (SELECT json_group_array(team_id) FROM event_teams WHERE event_id = e.id) AS team_ids
       FROM events e${EVENT_JOINS} WHERE e.id = ?`,
    change.eventId,
  );
  if (!event) return 0;
  // A game moved while it does not take place is no news; one that was moved back takes place again
  if (change.change === "moved" && event.cancelled_at) return 0;
  const rows = await all<{ id: number }>(
    env.DB,
    `SELECT DISTINCT a.id FROM fan_follows f JOIN accounts a ON a.id = f.account_id AND a.disabled_at IS NULL
      WHERE f.team_id IN (SELECT value FROM json_each(?1))
        AND NOT EXISTS (SELECT 1 FROM team_memberships tm WHERE tm.person_id = a.person_id AND tm.team_id IN (SELECT value FROM json_each(?1)))
        -- Parents of a player, where parents are involved in the team (as ownTeamIds)
        AND NOT EXISTS (SELECT 1 FROM guardianships g JOIN team_memberships tm ON tm.person_id = g.child_id
                          JOIN teams pt ON pt.id = tm.team_id AND pt.parents_enabled = 1
                         WHERE g.guardian_id = a.person_id AND tm.team_id IN (SELECT value FROM json_each(?1)))
        AND NOT EXISTS (SELECT 1 FROM notification_settings ns
                         WHERE ns.account_id = a.id AND ns.person_id = a.person_id AND ns.topic = 'fans' AND ns.enabled = 0)
        AND (?2 = 1 OR NOT EXISTS (SELECT 1 FROM fan_home_only h WHERE h.account_id = a.id))`,
    list(change.teamIds),
    event.is_home === 1 ? 1 : 0,
  );
  if (!rows.length) return 0;
  const teams = new Map((await clubTeams(env.DB)).map((tm) => [tm.id, tm]));
  const eventTeams = (JSON.parse(event.team_ids) as number[]).map((id) => teams.get(id)).filter((tm): tm is TeamInfo => !!tm);
  const url = `/spiel/${event.id}`;
  // Per recipient language (worker/domain/notify.ts); the texts name the game, never the reason or who changed it
  return enqueuePush(
    env,
    rows.map((r) => r.id),
    () => {
      const label = eventTitle(event, eventTeams);
      const when = `${shortDate(change.before)}, ${shortTime(change.before)}`;
      const date = shortDate(event.starts_at);
      const time = shortTime(event.starts_at);
      const location = event.loc_name;
      if (change.change === "cancelled") return { title: t`Not taking place: ${label}`, body: t`${label} on ${when} is not taking place.`, url };
      if (change.change === "restored") return { title: t`Going ahead: ${label}`, body: t`${label} on ${when} is going ahead after all.`, url };
      return {
        title: t`Game moved: ${label}`,
        body: location ? t`New start of play: ${date}, ${time}, ${location}.` : t`New start of play: ${date}, ${time}.`,
        url,
      };
    },
    { exclude: change.exclude },
  );
}
