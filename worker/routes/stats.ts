// Statistics: for coaches per team, for players and parents their own (docs/dev/design.md, Statistics).
import { t } from "@lingui/core/macro";
import { Hono } from "hono";
import type { StatsRange } from "../../shared/types";
import { type AppEnv, intParam, requireActor } from "../app";
import { requireCoach } from "../auth/actor";
import { requireTeam } from "../domain/groups";
import { loadMyStats, loadPersonStatsEvents, loadTeamStats, STATS_RANGES } from "../domain/stats";
import { badRequest } from "../lib/http";

export const statsRoutes = new Hono<AppEnv>();

export function rangeOf(value: string | undefined): StatsRange {
  if (value == null || value === "") return "4w";
  if (!(STATS_RANGES as string[]).includes(value)) throw badRequest(t`This time span does not exist.`, "bad_range");
  return value as StatsRange;
}

statsRoutes.get("/teams/:id/stats", async (c) => {
  const actor = requireActor(c);
  const teamId = intParam(c, "id");
  requireCoach(actor, teamId);
  await requireTeam(c.env.DB, teamId);
  return c.json(await loadTeamStats(c.env.DB, teamId, rangeOf(c.req.query("range"))));
});

statsRoutes.get("/teams/:id/stats/persons/:personId", async (c) => {
  const actor = requireActor(c);
  const teamId = intParam(c, "id");
  requireCoach(actor, teamId);
  return c.json({ events: await loadPersonStatsEvents(c.env.DB, teamId, intParam(c, "personId"), rangeOf(c.req.query("range"))) });
});

statsRoutes.get("/stats/me", async (c) => {
  const actor = requireActor(c);
  return c.json(await loadMyStats(c.env.DB, actor));
});
