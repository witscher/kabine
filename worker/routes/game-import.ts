// Game schedule from a CSV table (base function, for clubs without a fixture connector).
// Preview first, then create; games already in the app (same team, kick-off and opponent) and
// games in the past are skipped.
import { t } from "@lingui/core/macro";
import { plural } from "@lingui/core/macro";
import { Hono } from "hono";
import { z } from "zod";
import { parseGameCsv } from "../../shared/game-csv";
import { type AppEnv, intParam, requireActor } from "../app";
import { isCoachOf } from "../auth/actor";
import { loadClub } from "../domain/club";
import { teamGameMinutes } from "../domain/events";
import { requireTeam } from "../domain/groups";
import { notifyPersons } from "../domain/notify";
import { all, first, stmt } from "../lib/db";
import { forbidden, parse, readJson } from "../lib/http";
import { addMinutesLocal, nowLocal } from "../lib/time";

export const gameImportRoutes = new Hono<AppEnv>();

const importSchema = z.object({
  csv: z.string().max(200_000),
  /** false: only show what would happen */
  commit: z.boolean().default(false),
});

gameImportRoutes.post("/teams/:id/game-import", async (c) => {
  const actor = requireActor(c);
  const teamId = intParam(c, "id");
  if (!isCoachOf(actor, teamId)) throw forbidden(t`Only coaches of this team can do this.`);
  await requireTeam(c.env.DB, teamId);
  const input = parse(importSchema, await readJson(c.req.raw));
  const { games, problems } = parseGameCsv(input.csv);
  const now = nowLocal();
  const existing = await all<{ starts_at: string; home_team: string | null; guest_team: string | null }>(
    c.env.DB,
    `SELECT e.starts_at, e.home_team, e.guest_team FROM events e JOIN event_teams et ON et.event_id = e.id
      WHERE et.team_id = ? AND e.kind = 'game' AND e.starts_at >= ?`,
    teamId,
    now.slice(0, 10),
  );
  const known = new Set(existing.flatMap((e) => [`${e.starts_at}|${e.home_team ?? ""}`, `${e.starts_at}|${e.guest_team ?? ""}`]));
  const rows = games.map((g) => {
    const startsAt = `${g.date}T${g.time}`;
    return { ...g, startsAt, past: startsAt <= now, duplicate: known.has(`${startsAt}|${g.opponent}`) };
  });
  const fresh = rows.filter((r) => !r.past && !r.duplicate);
  if (!input.commit || !fresh.length) return c.json({ games: rows, problems, created: 0 });

  const db = c.env.DB;
  const own = (await loadClub(db)).name;
  const minutes = await teamGameMinutes(db, teamId);
  // Venues by name; unknown ones are created (own venues as custom places, others as opponents' halls)
  const venues = new Map(
    (await all<{ id: number; name: string }>(db, "SELECT id, name FROM locations")).map((l) => [l.name.trim().toLowerCase(), l.id]),
  );
  for (const r of fresh) {
    if (!r.venue || venues.has(r.venue.toLowerCase())) continue;
    const loc = await first<{ id: number }>(db, "INSERT INTO locations (name, kind) VALUES (?, ?) RETURNING id", r.venue, r.isHome ? "custom" : "external");
    venues.set(r.venue.toLowerCase(), loc!.id);
  }
  const statements = fresh.flatMap((r) => [
    stmt(
      db,
      `INSERT INTO events (kind, starts_at, ends_at, location_id, home_team, guest_team, is_home) VALUES ('game', ?, ?, ?, ?, ?, ?)`,
      r.startsAt,
      addMinutesLocal(r.startsAt, minutes),
      r.venue ? (venues.get(r.venue.toLowerCase()) ?? null) : null,
      r.isHome ? own : r.opponent,
      r.isHome ? r.opponent : own,
      r.isHome ? 1 : 0,
    ),
    stmt(db, "INSERT INTO event_teams (event_id, team_id) VALUES ((SELECT max(id) FROM events), ?)", teamId),
  ]);
  for (let i = 0; i < statements.length; i += 80) await db.batch(statements.slice(i, i + 80));

  const team = await first<{ name: string }>(db, "SELECT name FROM teams WHERE id = ?", teamId);
  const players = await all<{ person_id: number }>(
    db,
    `SELECT tm.person_id FROM team_memberships tm JOIN persons p ON p.id = tm.person_id
      WHERE tm.team_id = ? AND tm.role = 'player' AND p.is_active = 1 AND p.is_former = 0`,
    teamId,
  );
  const count = fresh.length;
  c.executionCtx.waitUntil(
    notifyPersons(
      c.env,
      players.map((p) => p.person_id),
      "events",
      () => {
        const teamName = team?.name ?? "";
        return {
          title: plural(count, { one: `New game for ${teamName}`, other: `# new games for ${teamName}` }),
          body: t`The game schedule is in the app. Please check when you can play.`,
          url: "/termine",
        };
      },
      { teamIds: [teamId], exclude: [actor.accountId] },
    ),
  );
  return c.json({ games: rows, problems, created: count });
});
