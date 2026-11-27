// API of the home game day module, mounted under /api: the page of the day for the people involved and admins, the
// settings for admins. The mascot's pictures come from the mascot module (hook mascot, club profile).
import { t } from "@lingui/core/macro";
import { Hono } from "hono";
import { z } from "zod";
import { type AppEnv, requireActor } from "../../../worker/app";
import { requireAdmin } from "../../../worker/auth/actor";
import { isModuleOn } from "../../../worker/domain/club";
import { loadHelpersNeeded } from "../../../worker/domain/duties";
import { cachedTeamInfo, EVENT_COLUMNS, EVENT_JOINS, type EventRow, eventTitle, gameLiveMinutes, gameSource, gameTable, type TeamInfo } from "../../../worker/domain/events";
import { all, list } from "../../../worker/lib/db";
import { notFound, parse, readJson } from "../../../worker/lib/http";
import { addDays, isDate, nowLocal, todayLocal } from "../../../worker/lib/time";
import { GAMEDAY_HOURS, type GamedayDetail, type GamedayGame, type GamedaySettingsView } from "../types";
import { gamedaysFrom, involvement, loadGameday, loadSettings, recipients, saveSettings } from "./domain";

export const routes = new Hono<AppEnv>();

/**
 * The page of the day: every home game with game data that is public anyway (kick-off, venue, opponent, result for the
 * live link), own and followed games marked, open helper slots. Only for the people involved and admins.
 */
routes.get("/gameday/days/:date", async (c) => {
  const actor = requireActor(c);
  const date = c.req.param("date");
  if (!isDate(date)) throw notFound();
  const db = c.env.DB;
  const settings = await loadSettings(db, actor.versions);
  const gd = await loadGameday(db, actor.versions, date, settings.minTeams);
  const inv = gd ? (await involvement(db, actor, [gd])).get(gd.date)! : null;
  if (!gd || !inv || (!inv.own.length && !inv.fan.length && !inv.duty && !actor.isAdmin)) {
    throw notFound(t`There is no home game day on this date, or you are not involved in it.`);
  }
  const ids = [...new Set(gd.games.map((g) => g.id))];
  const [rows, teams, needed] = await Promise.all([
    all<EventRow & { team_ids: string }>(
      db,
      `SELECT ${EVENT_COLUMNS}, (SELECT json_group_array(team_id) FROM event_teams WHERE event_id = e.id) AS team_ids
         FROM events e${EVENT_JOINS}
        WHERE e.id IN (SELECT value FROM json_each(?))
        ORDER BY e.starts_at, e.id`,
      list(ids),
    ),
    cachedTeamInfo(db, actor.versions),
    isModuleOn("duties") ? loadHelpersNeeded(db, actor, ids, nowLocal()) : Promise.resolve(null),
  ]);
  const info = new Map(teams.map((tm) => [tm.id, tm]));
  const own = new Set(inv.own);
  const fan = new Set(inv.fan);
  const fansPage = isModuleOn("fans");
  const games: GamedayGame[] = rows.map((e) => {
    const list = (JSON.parse(e.team_ids) as number[]).map((id) => info.get(id)).filter((tm): tm is TeamInfo => !!tm);
    const isOwn = list.some((tm) => own.has(tm.id));
    return {
      id: e.id,
      kind: "game",
      startsAt: e.starts_at,
      cancelled: null,
      title: eventTitle(e, list),
      teams: list.map((tm) => ({ id: tm.id, name: tm.name })),
      location: e.loc_name,
      own: isOwn,
      fan: !isOwn && list.some((tm) => fan.has(tm.id)),
      // Own games open the event page, all others the game page of the fans module (game data only), if it is on
      href: isOwn ? `/termine/${e.id}` : fansPage ? `/spiel/${e.id}` : null,
      game: {
        homeTeam: e.home_team,
        guestTeam: e.guest_team,
        isHome: true,
        homeGoals: e.home_goals,
        guestGoals: e.guest_goals,
        table: gameTable(list),
        source: gameSource(e, list),
        liveMinutes: gameLiveMinutes(list.map((tm) => tm.game_minutes)),
      },
    };
  });
  const body: GamedayDetail = {
    date: gd.date,
    teams: gd.teamIds.length,
    hall: gd.hall,
    first: gd.first,
    last: gd.last,
    games,
    helpersNeeded: needed ? [...needed.values()].reduce((a, b) => a + b, 0) : null,
  };
  return c.json(body);
});

routes.get("/gameday/settings", async (c) => {
  const actor = requireActor(c);
  requireAdmin(actor);
  const db = c.env.DB;
  const settings = await loadSettings(db, actor.versions);
  const today = todayLocal();
  const next = (await gamedaysFrom(db, actor.versions, addDays(today, 1), settings.minTeams)).find((d) => d.date <= addDays(today, 90));
  const body: GamedaySettingsView = {
    ...settings,
    next: next
      ? {
          date: next.date,
          teams: next.teamIds.length,
          sendAt: `${addDays(next.date, -1)}T${String(settings.hour).padStart(2, "0")}:00`,
          recipients: (await recipients(db, next, actor.versions)).size,
        }
      : null,
  };
  return c.json(body);
});

const settingsSchema = z.object({
  enabled: z.boolean(),
  minTeams: z.number().int().min(2).max(20),
  hour: z.number().refine((h) => (GAMEDAY_HOURS as readonly number[]).includes(h), { error: () => t`Please choose 12, 18 or 20 o'clock.` }),
});

routes.put("/gameday/settings", async (c) => {
  const actor = requireActor(c);
  requireAdmin(actor);
  const input = parse(settingsSchema, await readJson(c.req.raw));
  const current = await loadSettings(c.env.DB, actor.versions);
  await saveSettings(c.env.DB, { ...current, ...input, hour: input.hour as (typeof GAMEDAY_HOURS)[number] });
  return c.json({ ok: true });
});
