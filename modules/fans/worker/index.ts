// Worker part of the fans module: API, the games of followed teams in the event list on home and in the personal
// calendar, the push for games moved or cancelled at short notice, cleanup.
import { t } from "@lingui/core/macro";
import { stmt } from "../../../worker/lib/db";
import { defineWorkerModule } from "../../../worker/module-api";
import manifest from "../module";
import type { FansPage } from "../types";
import { clubTeamIds, fanGames, fanSettings, followedTeams, followerAccounts, notifyFans, withLeagueTables } from "./domain";
import { routes } from "./routes";

export default defineWorkerModule({
  manifest,
  routes,
  /**
   * The list on home: the teams one follows (for the star button), and with `fans.games=1` their games, with
   * `fans.club=1` the games of every team of the club (the view of all games), each in the page's window.
   */
  eventPage: async (db, actor, q): Promise<FansPage | null> => {
    const club = q.params.club === "1";
    const teams = await followedTeams(db, actor);
    if (!teams.length && !club) return null;
    const wanted = (club || q.params.games === "1") && (!q.kinds || q.kinds.includes("game"));
    if (!wanted) return { teams, games: [], more: null };
    const { homeOnly } = club ? { homeOnly: false } : await fanSettings(db, actor.accountId);
    const { games, more } = await fanGames(db, actor, {
      teamIds: club ? await clubTeamIds(db) : teams.map((tm) => tm.id),
      following: teams.map((tm) => tm.id),
      from: q.from,
      to: q.to,
      desc: q.past,
      homeOnly,
      limit: q.limit,
    });
    // Whole days, as the core's page: a day cut off at the limit is left for "More events"
    const lastDay = more ? games.at(-1)?.startsAt.slice(0, 10) : undefined;
    const whole = lastDay && games.some((g) => g.startsAt.slice(0, 10) !== lastDay) ? games.filter((g) => g.startsAt.slice(0, 10) !== lastDay) : games;
    return { teams, games: await withLeagueTables(db, whole), more: more ? (whole.at(-1)?.startsAt ?? null) : null };
  },
  // Followed teams for other modules (the home game day tells fans about the day)
  follows: {
    teams: async (db, actor) => (await followedTeams(db, actor)).map((tm) => tm.id),
    accounts: followerAccounts,
  },
  eventChanged: async (env, change) => {
    await notifyFans(env, change);
  },
  /** "Games as a fan" in the personal calendar, if ticked: game data only, with "Home games only". */
  calendarItems: async (db, feed) => {
    const settings = await fanSettings(db, feed.actor.accountId);
    if (!settings.calendar) return [];
    const teams = await followedTeams(db, feed.actor);
    const { games } = await fanGames(db, feed.actor, { teamIds: teams.map((tm) => tm.id), from: feed.from, to: feed.to, homeOnly: settings.homeOnly });
    return games.map((g) => {
      const team = g.teams.map((tm) => tm.name).join(" + ");
      const throwOff = g.startsAt.slice(11, 16);
      const title = g.title;
      const minutes = g.endsAt && g.endsAt > g.startsAt ? (Date.parse(`${g.endsAt}:00Z`) - Date.parse(`${g.startsAt}:00Z`)) / 60_000 : 120;
      return {
        // The same UID as an own event, so the entry stays one entry if one joins the team later
        uid: `event-${g.id}@${feed.uidHost}`,
        start: g.startsAt,
        durationMinutes: minutes,
        summary: g.cancelled ? t`Not taking place: ${title}` : title,
        location: g.location ? [g.location.name, g.location.address].filter(Boolean).join(", ") : null,
        description: [t`Start of play ${throwOff}`, t`You follow ${team} as a fan.`, `${feed.origin}/spiel/${g.id}`].join("\n"),
        cancelled: !!g.cancelled,
      };
    });
  },
  // Someone leaves the club: the account is disabled, its choices go
  personLeaves: (db, personId) =>
    ["fan_follows", "fan_home_only", "fan_calendar"].map((table) =>
      stmt(db, `DELETE FROM ${table} WHERE account_id IN (SELECT id FROM accounts WHERE person_id = ?)`, personId),
    ),
  // Follows survive the season change: the teams stay, only the people are reassigned (README)
  exportTables: ["fan_follows", "fan_home_only"],
  // Belongs to the calendar link, which is not exported either
  exportExcluded: ["fan_calendar"],
});
