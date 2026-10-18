// Helper plan view of the youth referees (KiHaSL/JuHaSL): all upcoming youth home games of all teams that
// need a referee, with live updates. Builds on the helper plan of the duties module (required).
import { t } from "@lingui/core/macro";
import { Hono } from "hono";
import { type AppEnv, requireActor } from "../../../worker/app";
import { isCoachOf } from "../../../worker/auth/actor";
import { ensureEventDuties, loadDutyTypes, REFEREE_TEAM_SQL, refereeRoles } from "../../../worker/domain/duties";
import { dutyHubStub } from "../../../worker/duties/hub";
import { all, SHORT_NAME_SQL } from "../../../worker/lib/db";
import { badRequest, forbidden } from "../../../worker/lib/http";
import { nowLocal, todayLocal } from "../../../worker/lib/time";
import { blockView, type EventRow, eventView, loadBlocksAndEntries, REFEREE_HUB } from "../../duties/worker/routes";

export const refereePlanRoutes = new Hono<AppEnv>();

/**
 * KiHaSL/JuHaSL: all upcoming youth home games F–C of all teams, with the block.
 * For everyone with the role (oneself or a child), coaches and admins.
 */
refereePlanRoutes.get("/duties/referee", async (c) => {
  const actor = requireActor(c);
  const db = c.env.DB;
  const refRoles = await refereeRoles(db, actor);
  if (!refRoles.length && !actor.isAdmin && !actor.coachTeamIds.length) throw forbidden();
  const today = `${todayLocal()}T00:00`;
  const candidates = await all<{ id: number }>(
    db,
    `SELECT e.id FROM events e JOIN teams t ON t.id = (SELECT et.team_id FROM event_teams et WHERE et.event_id = e.id ORDER BY et.team_id LIMIT 1)
      WHERE e.kind = 'game' AND e.is_home = 1 AND ${REFEREE_TEAM_SQL("t")} AND e.starts_at >= ? AND e.cancelled_at IS NULL`,
    today,
  );
  await ensureEventDuties(db, candidates.map((x) => x.id), today);
  const events = await all<EventRow>(
    db,
    `SELECT e.id, e.kind, e.starts_at, e.ends_at, e.is_home, e.home_team, e.guest_team, e.title, e.cancelled_at, e.duty_hidden, e.external_ref,
            l.name AS location_name, t.id AS team_id, t.name AS team_name
       FROM events e
       JOIN teams t ON t.id = (SELECT et.team_id FROM event_teams et WHERE et.event_id = e.id ORDER BY et.team_id LIMIT 1)
       LEFT JOIN locations l ON l.id = e.location_id
      WHERE e.starts_at >= ? AND e.cancelled_at IS NULL
        AND EXISTS (SELECT 1 FROM event_duties ed JOIN duty_types dt ON dt.id = ed.duty_type_id AND dt.who_referees = 1 WHERE ed.event_id = e.id)
      ORDER BY e.starts_at`,
    today,
  );
  const eventIds = events.map((e) => e.id);
  const [{ blocks, entries }, types] = await Promise.all([loadBlocksAndEntries(db, eventIds), loadDutyTypes(db, eventIds)]);
  const now = nowLocal();
  return c.json({
    team: { teamId: 0, teamName: "KiHaSL/JuHaSL", canManage: actor.isAdmin, roles: refRoles, own: true },
    games: events.map((e) => ({
      ...eventView(e, now),
      teamId: e.team_id,
      teamName: e.team_name,
      canManage: isCoachOf(actor, e.team_id!),
      hidden: false,
      blocks: blocks
        .filter((b) => b.event_id === e.id && types.get(b.duty_type_id)?.whoReferees && (b.slots > 0 || isCoachOf(actor, e.team_id!)))
        .map((b) => blockView(b, types.get(b.duty_type_id)!, entries, actor, { team: null, refRoles, consents: new Set(), past: e.starts_at < now })),
    })),
  });
});

/** Everyone with the role, for “sign someone up” (coaches and admins). */
refereePlanRoutes.get("/duties/referee/people", async (c) => {
  const actor = requireActor(c);
  if (!actor.isAdmin && !actor.coachTeamIds.length) throw forbidden();
  const people = await all<{ id: number; name: string }>(
    c.env.DB,
    `SELECT p.id, ${SHORT_NAME_SQL("p")} AS name FROM referees r JOIN persons p ON p.id = r.person_id AND p.is_former = 0 ORDER BY 2`,
  );
  return c.json({ people: people.map((p) => ({ personId: p.id, name: p.name, childId: null, childName: null })) });
});

refereePlanRoutes.get("/duties/referee/live", async (c) => {
  const actor = requireActor(c);
  if (c.req.header("upgrade")?.toLowerCase() !== "websocket") throw badRequest(t`Expected a WebSocket connection.`);
  if (!(await refereeRoles(c.env.DB, actor)).length && !actor.isAdmin && !actor.coachTeamIds.length) throw forbidden();
  return dutyHubStub(c.env, REFEREE_HUB).fetch(new Request("https://duties.internal/connect", { headers: c.req.raw.headers }));
});
