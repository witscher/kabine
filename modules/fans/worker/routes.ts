// API of the fans module, mounted under /api. Everything is about the signed-in account itself: whom it follows, its
// switches, and the game data of a game of the club. Nobody can read whom someone else follows.
import { t } from "@lingui/core/macro";
import { Hono } from "hono";
import { z } from "zod";
import { type AppEnv, intParam, requireActor } from "../../../worker/app";
import type { Actor } from "../../../worker/auth/actor";
import { loadLeagueTable } from "../../../worker/domain/league-table";
import { first } from "../../../worker/lib/db";
import { badRequest, notFound, parse, readJson } from "../../../worker/lib/http";
import type { FanGamePage, FollowView } from "../types";
import { fanGame, fanSettings, followTeams, ownTeamIds, setFanSetting, setFollow } from "./domain";

export const routes = new Hono<AppEnv>();

async function followView(db: D1Database, actor: Actor): Promise<FollowView> {
  const [teams, settings] = await Promise.all([followTeams(db, actor), fanSettings(db, actor.accountId)]);
  return { teams, ...settings };
}

/** All teams of the club, own ones fixed, followed ones marked; the switches "Home games only" and the calendar. */
routes.get("/fans/follows", async (c) => {
  const actor = requireActor(c);
  return c.json(await followView(c.env.DB, actor));
});

routes.put("/fans/follows/:teamId", async (c) => {
  const actor = requireActor(c);
  const teamId = intParam(c, "teamId");
  const { follow } = parse(z.object({ follow: z.boolean() }), await readJson(c.req.raw));
  const team = await first<{ kind: string }>(c.env.DB, "SELECT kind FROM teams WHERE id = ?", teamId);
  if (!team || team.kind !== "team") throw notFound(t`This team does not exist.`);
  if (follow && ownTeamIds(actor).includes(teamId)) throw badRequest(t`This is already your team.`, "own_team");
  await setFollow(c.env.DB, actor, teamId, follow);
  return c.json(await followView(c.env.DB, actor));
});

const settingsSchema = z.object({ homeOnly: z.boolean().optional(), calendar: z.boolean().optional() });

routes.put("/fans/settings", async (c) => {
  const actor = requireActor(c);
  const input = parse(settingsSchema, await readJson(c.req.raw));
  if (input.homeOnly !== undefined) await setFanSetting(c.env.DB, actor.accountId, "fan_home_only", input.homeOnly);
  if (input.calendar !== undefined) await setFanSetting(c.env.DB, actor.accountId, "fan_calendar", input.calendar);
  return c.json(await followView(c.env.DB, actor));
});

/**
 * A game of the club with its game data only: kick-off, venue, opponent, result, whether it takes place, and the
 * league table from the last sync (public data of the source).
 */
routes.get("/fans/games/:id", async (c) => {
  const actor = requireActor(c);
  const game = await fanGame(c.env.DB, actor, intParam(c, "id"));
  if (!game) throw notFound(t`This game does not exist.`);
  const page: FanGamePage = { ...game, standings: await loadLeagueTable(c.env.DB, game.teams.map((tm) => tm.id)) };
  return c.json(page);
});
