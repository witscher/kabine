// Games entered by hand (friendlies, tournaments, games of teams without a game schedule) and hiding a
// game from the helper plan. Part of the core; the URLs sit next to the helper plan's for historic reasons
// (BASE_PATHS in shared/modules.ts keeps them out of the duties module).
import { t } from "@lingui/core/macro";
import { Hono } from "hono";
import { z } from "zod";
import { type AppEnv, intParam, requireActor } from "../app";
import { isCoachOf } from "../auth/actor";
import { loadClub } from "../domain/club";
import { managedEvent } from "../domain/duties";
import { teamGameMinutes } from "../domain/events";
import { requireTeam } from "../domain/groups";
import { notifyPersons, shortDate, shortTime } from "../domain/notify";
import { notifyDutyChange } from "../duties/hub";
import { all, first, run } from "../lib/db";
import { badRequest, forbidden, notFound, parse, readJson } from "../lib/http";
import { addMinutesLocal, isDate, isTime, nowLocal } from "../lib/time";

export const manualGameRoutes = new Hono<AppEnv>();

manualGameRoutes.patch("/duties/games/:id", async (c) => {
  const actor = requireActor(c);
  const event = await managedEvent(c.env.DB, actor, intParam(c, "id"));
  const { hidden } = parse(z.object({ hidden: z.boolean() }), await readJson(c.req.raw));
  await run(c.env.DB, "UPDATE events SET duty_hidden = ? WHERE id = ?", hidden ? 1 : 0, event.id);
  for (const t of event.teamIds) c.executionCtx.waitUntil(notifyDutyChange(c.env, t));
  return c.json({ ok: true });
});

const manualGameSchema = z.object({
  opponent: z.string().trim().min(1).max(80),
  isHome: z.boolean(),
  date: z.string().refine(isDate, { error: () => t`Invalid date.` }),
  time: z.string().refine(isTime, { error: () => t`Invalid time.` }),
  locationId: z.number().int().positive().nullable().optional(),
});

/** Game not from a game schedule (friendlies, tournaments, Bambinis, Minis). The team is notified. */
manualGameRoutes.post("/duties/teams/:id/games", async (c) => {
  const actor = requireActor(c);
  const teamId = intParam(c, "id");
  if (!isCoachOf(actor, teamId)) throw forbidden(t`Only coaches of this team can do this.`);
  await requireTeam(c.env.DB, teamId);
  const input = parse(manualGameSchema, await readJson(c.req.raw));
  const startsAt = `${input.date}T${input.time}`;
  if (startsAt <= nowLocal()) throw badRequest(t`The game must be in the future.`);
  const own = (await loadClub(c.env.DB)).name;
  const row = await first<{ id: number }>(
    c.env.DB,
    `INSERT INTO events (kind, starts_at, ends_at, location_id, home_team, guest_team, is_home)
     VALUES ('game', ?, ?, ?, ?, ?, ?) RETURNING id`,
    startsAt,
    addMinutesLocal(startsAt, await teamGameMinutes(c.env.DB, teamId)),
    input.locationId ?? null,
    input.isHome ? own : input.opponent,
    input.isHome ? input.opponent : own,
    input.isHome ? 1 : 0,
  );
  await run(c.env.DB, "INSERT INTO event_teams (event_id, team_id) VALUES (?, ?)", row!.id, teamId);
  c.executionCtx.waitUntil(notifyDutyChange(c.env, teamId));

  const team = await first<{ name: string }>(c.env.DB, "SELECT name FROM teams WHERE id = ?", teamId);
  const loc = input.locationId ? await first<{ name: string }>(c.env.DB, "SELECT name FROM locations WHERE id = ?", input.locationId) : null;
  const players = await all<{ person_id: number }>(
    c.env.DB,
    `SELECT tm.person_id FROM team_memberships tm JOIN persons p ON p.id = tm.person_id
      WHERE tm.team_id = ? AND tm.role = 'player' AND p.is_active = 1 AND p.is_former = 0`,
    teamId,
  );
  const opponent = input.opponent;
  const place = loc?.name;
  c.executionCtx.waitUntil(
    notifyPersons(
      c.env,
      players.map((p) => p.person_id),
      "events",
      () => {
        const teamName = team?.name ?? t`Game`;
        const date = shortDate(startsAt);
        const time = shortTime(startsAt);
        return {
          title: input.isHome ? t`New game: ${teamName} vs ${opponent}` : t`New game: ${teamName} at ${opponent}`,
          body: place
            ? t`${date}, ${time}, ${place}. The coach will announce the squad.`
            : t`${date}, ${time}. The coach will announce the squad.`,
          url: `/termine/${row!.id}`,
        };
      },
      { teamIds: [teamId], exclude: [actor.accountId] },
    ),
  );
  return c.json({ id: row!.id }, 201);
});

manualGameRoutes.delete("/duties/games/:id", async (c) => {
  const actor = requireActor(c);
  const event = await managedEvent(c.env.DB, actor, intParam(c, "id"));
  const row = await first<{ kind: string; external_ref: string | null }>(c.env.DB, "SELECT kind, external_ref FROM events WHERE id = ?", event.id);
  if (row?.kind !== "game") throw notFound();
  if (row.external_ref) throw badRequest(t`Games from a game schedule cannot be deleted, only hidden.`);
  await run(c.env.DB, "DELETE FROM events WHERE id = ?", event.id);
  for (const t of event.teamIds) c.executionCtx.waitUntil(notifyDutyChange(c.env, t));
  return c.json({ ok: true });
});
