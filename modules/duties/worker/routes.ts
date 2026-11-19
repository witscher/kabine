// Helper plan API. Rules in worker/domain/duties.ts (core: the event views use them too).
import { t } from "@lingui/core/macro";
import { isModuleOn, loadClub } from "../../../worker/domain/club";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { type AppEnv, intParam, requireActor } from "../../../worker/app";
import { type Actor, isCoachOf, isCoachOfAny, requireAdmin } from "../../../worker/auth/actor";
import {
  adultSql,
  allTeamIds,
  blockFromItem,
  blockRoles,
  CLUB_KEY,
  clubHelperTeam,
  dutyManagers,
  type DutyType,
  ensureEventDuties,
  HELPER_COLUMNS,
  type HelperColumns,
  type HelperMode,
  helperSource,
  type HelperSource,
  helperTeams,
  helperTeamsOf,
  type HelperRole,
  type HelperTeam,
  itemSource,
  loadBlock,
  loadDutyTypes,
  mayManageDuties,
  managedEvent,
  mayTake,
  resetTeamDuties,
  publicHelperTeam,
  loadSkills,
  qualifiedRoles,
  REQUIRED_DUTIES_SQL,
  rolesFor,
  SHORT_NAME_SQL,
  type Skills,
  skillConsents,
  teamRolesFor,
  templateItems,
  whoSql,
} from "../../../worker/domain/duties";
import { requireTeam } from "../../../worker/domain/groups";
import { dutyHubStub, notifyDutyChange, notifyDutyHubs } from "../../../worker/duties/hub";
import { sendDutyAssigned } from "./notify";
import { notifyPersons, shortDate, shortTime } from "../../../worker/domain/notify";
import { textsOn } from "../../../worker/domain/texts";
import { all, first, run, stmt } from "../../../worker/lib/db";
import { badRequest, conflict, forbidden, notFound, parse, readJson, upgradeHeaders } from "../../../worker/lib/http";
import { teamGameMinutes } from "../../../worker/domain/events";
import { addDays, addMinutesLocal, isDate, isLocalDateTime, isTime, nowLocal, todayLocal } from "../../../worker/lib/time";

export const dutyRoutes = new Hono<AppEnv>();

/** Past games stay visible for 90 days (top helpers, review). */
const PAST_DAYS = 90;

/** Live channel of the list of a qualification taken from all teams (team IDs are always > 0, the club list is 0). */
export const qualifiedHub = (dutyTypeId: number) => -dutyTypeId;

/** How far the "help out" list looks ahead (blocks from templates are generated for it in advance). */
const HELP_OUT_DAYS = 60;

/** "Helpers from" on template lines and time blocks (worker/domain/duties.ts, HelperSource). */
const helperSourceSchema = {
  helperMode: z.enum(["default", "teams", "rotate"]).default("default"),
  helperTeams: z.array(z.number().int().positive()).max(30).default([]),
};

/** Checks "helpers from": existing teams (no groups), at least one for teams and rotate; rotate only in templates. */
async function checkHelperSource(db: D1Database, mode: HelperMode, teams: number[], allowRotate: boolean): Promise<{ mode: HelperMode; teams: number[] }> {
  if (mode === "default") return { mode, teams: [] };
  if (mode === "rotate" && !allowRotate) throw badRequest(t`Taking turns only works in templates.`, "bad_helper_source");
  const ids = [...new Set(teams)];
  if (!ids.length) throw badRequest(t`Please choose at least one team under “Helpers from”.`, "bad_helper_source");
  const known = await all<{ id: number }>(db, "SELECT id FROM teams WHERE kind = 'team' AND id IN (SELECT value FROM json_each(?))", JSON.stringify(ids));
  if (known.length !== ids.length) throw badRequest(t`Unknown team under “Helpers from”.`, "unknown_team");
  return { mode, teams: ids };
}

/** Names of all teams (for "helpers from"), few rows. */
async function teamNames(db: D1Database): Promise<Map<number, string>> {
  return new Map((await all<{ id: number; name: string }>(db, "SELECT id, name FROM teams")).map((tm) => [tm.id, tm.name]));
}

dutyRoutes.get("/duties/teams", async (c) => {
  const actor = requireActor(c);
  return c.json({ teams: (await helperTeams(c.env.DB, actor)).map(publicHelperTeam) });
});

export interface EventRow {
  id: number;
  kind: "game" | "special";
  starts_at: string;
  ends_at: string | null;
  is_home: number | null;
  home_team: string | null;
  guest_team: string | null;
  title: string | null;
  cancelled_at: string | null;
  duty_hidden: number;
  external_ref: string | null;
  location_name: string | null;
  team_id?: number;
  team_name?: string;
}

interface BlockOut extends HelperColumns {
  id: number;
  event_id: number;
  duty_type_id: number;
  starts_at: string;
  ends_at: string;
  slots: number;
}

interface EntryRow {
  id: number;
  event_duty_id: number;
  person_id: number | null;
  name: string | null;
  child_id: number | null;
  child_name: string | null;
  manual_name: string | null;
  note: string | null;
}

export async function loadBlocksAndEntries(db: D1Database, eventIds: number[]) {
  if (!eventIds.length) return { blocks: [] as BlockOut[], entries: [] as EntryRow[] };
  const ids = JSON.stringify(eventIds);
  const [blocks, entries] = await Promise.all([
    all<BlockOut>(
      db,
      `SELECT ed.id, ed.event_id, ed.duty_type_id, ed.starts_at, ed.ends_at, ed.slots, ${HELPER_COLUMNS}
         FROM event_duties ed WHERE ed.event_id IN (SELECT value FROM json_each(?)) ORDER BY ed.starts_at, ed.sort, ed.id`,
      ids,
    ),
    all<EntryRow>(
      db,
      `SELECT d.id, d.event_duty_id, d.person_id, ${SHORT_NAME_SQL("p")} AS name, d.child_id, ${SHORT_NAME_SQL("ch")} AS child_name, d.manual_name, d.note
         FROM duties d LEFT JOIN persons p ON p.id = d.person_id LEFT JOIN persons ch ON ch.id = d.child_id
        WHERE d.event_id IN (SELECT value FROM json_each(?)) ORDER BY d.id`,
      ids,
    ),
  ]);
  return { blocks, entries };
}

/**
 * Taking turns: does the team in charge have an event of its own at the time of the block (game, training, special
 * event)? Only a hint for managers, the assignment stays.
 */
async function rotationConflicts(db: D1Database, blocks: BlockOut[], names: Map<number, string>): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  for (const b of blocks) {
    if (b.helper_mode !== "rotate" || b.rotate_team_id == null) continue;
    const hit = await first<{ kind: string; starts_at: string }>(
      db,
      `SELECT e.kind, e.starts_at FROM event_teams et JOIN events e ON e.id = et.event_id
        WHERE et.team_id = ?1 AND e.cancelled_at IS NULL AND e.id <> ?4 AND e.starts_at < ?3 AND e.starts_at >= date(?2, '-1 day')
          AND coalesce(e.ends_at, strftime('%Y-%m-%dT%H:%M', e.starts_at, '+120 minutes')) > ?2
        ORDER BY e.starts_at LIMIT 1`,
      b.rotate_team_id,
      b.starts_at,
      b.ends_at,
      b.event_id,
    );
    if (!hit) continue;
    const team = names.get(b.rotate_team_id) ?? "?";
    const clock = hit.starts_at.slice(11, 16);
    out.set(
      b.id,
      hit.kind === "game"
        ? t`${team} has a game at the same time (${clock}).`
        : hit.kind === "training"
          ? t`${team} has training at the same time (${clock}).`
          : t`${team} has an event at the same time (${clock}).`,
    );
  }
  return out;
}

/** A block for the client: duty type, time, places, entries and whether/as whom one can sign up. */
export function blockView(
  b: BlockOut,
  type: DutyType,
  entries: EntryRow[],
  actor: Actor,
  opts: { team: HelperTeam | null; skills: Skills; past: boolean; names?: Map<number, string>; conflicts?: Map<number, string> },
) {
  const childIds = new Set(actor.children.map((ch) => ch.id));
  const source = helperSource(b);
  const teamRoles = type.whoQualified ? qualifiedRoles(actor, opts.skills, type.id) : blockRoles(actor, opts.team ? [opts.team] : [], type, source);
  const teamName = (id: number) => opts.names?.get(id) ?? "?";
  // Approved by an admin: in a team the one signing up does the duty, so they need the approval (for types taken
  // from all teams qualifiedRoles already holds only the approved people); coaches still enter anyone
  const byAdmin = type.needsSkill && type.skillGrant === "admin";
  const roles = byAdmin && !type.whoQualified && !mayTake(type, opts.skills, actor.personId) ? [] : teamRoles;
  return {
    id: b.id,
    dutyTypeId: type.id,
    label: type.name,
    mode: type.mode,
    referee: type.whoQualified,
    special: type.eventId != null,
    startsAt: b.starts_at,
    endsAt: b.ends_at,
    total: b.slots,
    noteAllowed: type.noteAllowed,
    needsSkill: type.needsSkill,
    /** Prior knowledge approved by an admin: no profile link, "Only with approval" */
    skillByAdmin: byAdmin,
    skillMissing: type.needsSkill && (byAdmin ? !roles.length && teamRoles.length > 0 : !opts.skills.consents.has(type.id)),
    /** Assigned by the coach: free places without "Sign up" */
    assignOnly: type.assignOnly,
    adultsOnly: type.adultsOnly,
    roles: opts.past ? [] : roles,
    /** "Helpers from": the teams (for taking turns the list and the team in charge), a hint on overlaps for managers */
    helperFrom:
      source.mode === "default"
        ? null
        : {
            mode: source.mode,
            teams: source.pool.map((id) => ({ id, name: teamName(id) })),
            current: source.rotateTeamId != null ? { id: source.rotateTeamId, name: teamName(source.rotateTeamId) } : null,
            conflict: opts.conflicts?.get(b.id) ?? null,
          },
    entries: entries
      .filter((x) => x.event_duty_id === b.id)
      .map((x) => ({
        id: x.id,
        name: x.manual_name ?? x.name ?? "?",
        child: x.child_id != null && x.child_id !== x.person_id ? x.child_name : null,
        note: x.note,
        mine: x.person_id === actor.personId,
        forMyChild: x.child_id != null && childIds.has(x.child_id),
      })),
  };
}

export function eventView(e: EventRow, now: string) {
  return {
    id: e.id,
    kind: e.kind,
    startsAt: e.starts_at,
    endsAt: e.ends_at,
    isPast: e.starts_at < now,
    isHome: e.is_home == null ? null : e.is_home === 1,
    homeTeam: e.home_team,
    guestTeam: e.guest_team,
    title: e.title,
    location: e.location_name,
    cancelled: e.cancelled_at != null,
    hidden: e.duty_hidden === 1,
    manual: e.kind === "game" && e.external_ref == null,
  };
}

/** Events with helper duties of one team, as in the list of the Helpers tab. */
async function teamDutyGames(
  db: D1Database,
  actor: Actor,
  team: HelperTeam,
  ctx: { skills: Skills; from: string; now: string },
) {
  const helperPlan = (await first<{ helper_plan: number }>(db, "SELECT helper_plan FROM teams WHERE id = ?", team.teamId))?.helper_plan === 1;
  const events = await all<EventRow>(
    db,
    `SELECT ${EVENT_COLUMNS}
       FROM events e JOIN event_teams et ON et.event_id = e.id AND et.team_id = ?1
       LEFT JOIN locations l ON l.id = e.location_id
      WHERE e.starts_at >= ?2
        AND ((e.kind = 'game' AND ?4 = 1) OR (e.kind = 'special' AND EXISTS (SELECT 1 FROM event_duties ed WHERE ed.event_id = e.id)))
        AND (?3 = 1 OR (e.cancelled_at IS NULL AND (e.kind = 'special' OR e.duty_hidden = 0)))
      ORDER BY e.starts_at`,
    team.teamId,
    ctx.from,
    team.canManage ? 1 : 0,
    helperPlan ? 1 : 0,
  );
  await ensureEventDuties(db, events.filter((e) => e.kind === "game").map((e) => e.id), ctx.from);
  const eventIds = events.map((e) => e.id);
  const [{ blocks, entries }, allTypes, managers, names] = await Promise.all([
    loadBlocksAndEntries(db, eventIds),
    loadDutyTypes(db, eventIds),
    dutyManagers(db, eventIds),
    teamNames(db),
  ]);
  // Hints on taking turns only for managers (one query per such block)
  const conflicts = team.canManage ? await rotationConflicts(db, blocks.filter((b) => b.starts_at >= ctx.now), names) : new Map<number, string>();
  return events.map((e) => {
    const past = e.starts_at < ctx.now;
    // Managing: coaches of this team, or (for special events of several teams) creator and organisers
    const canManage = team.canManage || mayManageDuties(actor, [], managers.get(e.id));
    return {
      ...eventView(e, ctx.now),
      teamId: team.teamId,
      teamName: team.teamName,
      canManage,
      blocks: blocks
        .filter((b) => b.event_id === e.id && allTypes.has(b.duty_type_id))
        // Places set to 0: only visible to managers (to restore them)
        .filter((b) => b.slots > 0 || canManage)
        // Approved by an admin: hidden for people without the approval, unless they manage the event or already
        // have an entry in it (own or for a child, e.g. after the approval was taken back)
        .filter((b) => visibleBlock(allTypes.get(b.duty_type_id)!, b, entries, actor, ctx.skills, canManage))
        .map((b) => blockView(b, allTypes.get(b.duty_type_id)!, entries, actor, { team, skills: ctx.skills, past, names, conflicts })),
    };
  });
}

/** Approved by an admin: only visible to the approved people, managers and those with an entry (own or a child's). */
function visibleBlock(type: DutyType, b: { id: number }, entries: EntryRow[], actor: Actor, skills: Skills, canManage: boolean): boolean {
  if (!type.needsSkill || type.skillGrant !== "admin" || type.whoQualified || canManage) return true;
  if (entries.some((x) => x.event_duty_id === b.id && (x.person_id === actor.personId || (x.child_id != null && actor.children.some((ch) => ch.id === x.child_id))))) return true;
  return mayTake(type, skills, actor.personId);
}

const EVENT_COLUMNS = `e.id, e.kind, e.starts_at, e.ends_at, e.is_home, e.home_team, e.guest_team, e.title, e.cancelled_at, e.duty_hidden, e.external_ref,
            l.name AS location_name`;

/**
 * List "Whole club" in the Helpers tab: club events with time blocks. Everyone sees all duties; whoever fits "who helps"
 * across all teams (or a block's teams) signs up. No "helpers wanted" push.
 */
dutyRoutes.get("/duties/club", async (c) => {
  const actor = requireActor(c);
  const db = c.env.DB;
  const now = nowLocal();
  const events = await all<EventRow>(
    db,
    `SELECT ${EVENT_COLUMNS}
       FROM events e LEFT JOIN locations l ON l.id = e.location_id
      WHERE e.club_wide = 1 AND e.kind = 'special' AND e.starts_at >= ?1
        AND EXISTS (SELECT 1 FROM event_duties ed WHERE ed.event_id = e.id)
        AND (?2 = 1 OR e.cancelled_at IS NULL)
      ORDER BY e.starts_at`,
    `${addDays(todayLocal(), -PAST_DAYS)}T00:00`,
    actor.isAdmin ? 1 : 0,
  );
  const eventIds = events.map((e) => e.id);
  const [{ blocks, entries }, types, managers, club, skills, names] = await Promise.all([
    loadBlocksAndEntries(db, eventIds),
    loadDutyTypes(db, eventIds),
    dutyManagers(db, eventIds),
    clubHelperTeam(db, actor),
    loadSkills(db, actor),
    teamNames(db),
  ]);
  const clubName = t`Whole club`;
  return c.json({
    team: { teamId: CLUB_KEY, teamName: clubName, canManage: actor.isAdmin, roles: [], own: true },
    games: events.map((e) => {
      const canManage = mayManageDuties(actor, [], managers.get(e.id));
      const team = { ...club, canManage };
      return {
        ...eventView(e, now),
        teamId: CLUB_KEY,
        teamName: clubName,
        club: true,
        canManage,
        blocks: blocks
          .filter((b) => b.event_id === e.id && types.has(b.duty_type_id))
          .filter((b) => b.slots > 0 || canManage)
          .filter((b) => visibleBlock(types.get(b.duty_type_id)!, b, entries, actor, skills, canManage))
          .map((b) => blockView(b, types.get(b.duty_type_id)!, entries, actor, { team, skills, past: e.starts_at < now, names })),
      };
    }),
  });
});

dutyRoutes.get("/duties/club/live", async (c) => {
  requireActor(c);
  if (c.req.header("upgrade")?.toLowerCase() !== "websocket") throw badRequest(t`Expected a WebSocket connection.`);
  // Everyone sees the club's duties (club events are visible to all)
  return dutyHubStub(c.env, CLUB_KEY).fetch(new Request("https://duties.internal/connect", { headers: upgradeHeaders(c.req.raw) }));
});

/** Teams (no groups) for "helpers from": coaches and admins choose them on templates and time blocks. */
dutyRoutes.get("/duties/team-options", async (c) => {
  const actor = requireActor(c);
  // Organisers of special events choose too; they are not necessarily coaches
  const organizer = async () =>
    !!(await first(c.env.DB, "SELECT 1 AS ok FROM event_organizers WHERE person_id = ?1 UNION ALL SELECT 1 FROM events WHERE created_by = ?1 AND kind = 'special' LIMIT 1", actor.personId));
  if (!actor.isAdmin && !actor.coachTeamIds.length && !(await organizer())) throw forbidden();
  return c.json({ teams: await all<{ id: number; name: string }>(c.env.DB, "SELECT id, name FROM teams WHERE kind = 'team' ORDER BY name") });
});

/** Teams in which oneself or a child (parents involved) plays: the base for "helpers from". */
function playingTeams(actor: Actor): number[] {
  const own = actor.memberships.filter((m) => m.role === "player").map((m) => m.teamId);
  const kids = [...actor.childMemberships.values()].flat().filter((m) => m.role === "player" && m.parentsEnabled).map((m) => m.teamId);
  return [...new Set([...own, ...kids])];
}

/**
 * Help out: upcoming events of other teams with blocks whose "helpers from" names a team in which oneself or a child
 * plays (taking turns: only when it is that team's turn). Only these duties.
 */
dutyRoutes.get("/duties/help-out", async (c) => {
  const actor = requireActor(c);
  const db = c.env.DB;
  const myTeams = playingTeams(actor);
  const header = { teamId: null, teamName: t`Help out`, canManage: false, roles: [], own: true };
  if (!myTeams.length) return c.json({ team: header, games: [] });
  const today = `${todayLocal()}T00:00`;
  // Blocks from templates only appear when a helper plan is opened: generate them for the coming games
  const pending = await all<{ id: number }>(
    db,
    `SELECT e.id FROM events e
      WHERE e.kind = 'game' AND e.starts_at >= ?1 AND e.starts_at < ?2 AND e.cancelled_at IS NULL AND (e.duties_generated & 1) = 0
        AND EXISTS (SELECT 1 FROM event_teams et JOIN teams t ON t.id = et.team_id AND t.helper_plan = 1 WHERE et.event_id = e.id)`,
    today,
    `${addDays(todayLocal(), HELP_OUT_DAYS)}T00:00`,
  );
  await ensureEventDuties(db, pending.map((p) => p.id), todayLocal());
  const [types, candidates] = await Promise.all([
    loadDutyTypes(db),
    all<{ id: number; duty_type_id: number } & HelperColumns>(
      db,
      // helper_mode <> 'default': through the partial index event_duties_helper_from
      `SELECT ed.id, ed.duty_type_id, ${HELPER_COLUMNS} FROM event_duties ed JOIN events e ON e.id = ed.event_id
        WHERE ed.helper_mode <> 'default' AND e.starts_at >= ?1 AND e.cancelled_at IS NULL AND ed.slots > 0
          AND (e.kind = 'special' OR e.duty_hidden = 0)
          AND ((ed.helper_mode = 'teams' AND EXISTS (SELECT 1 FROM json_each(ed.helper_teams) h WHERE h.value IN (SELECT value FROM json_each(?2))))
               OR (ed.helper_mode = 'rotate' AND ed.rotate_team_id IN (SELECT value FROM json_each(?2))))`,
      today,
      JSON.stringify(myTeams),
    ),
  ]);
  const wanted = new Set(
    candidates
      .filter((b) => {
        const type = types.get(b.duty_type_id);
        return !!type && !type.archived && teamRolesFor(actor, type, helperTeamsOf(helperSource(b))).length > 0;
      })
      .map((b) => b.id),
  );
  if (!wanted.size) return c.json({ team: header, games: [] });
  const events = await all<EventRow>(
    db,
    `SELECT ${EVENT_COLUMNS}, t.id AS team_id, t.name AS team_name
       FROM events e
       LEFT JOIN teams t ON t.id = (SELECT et.team_id FROM event_teams et WHERE et.event_id = e.id ORDER BY et.team_id LIMIT 1)
       LEFT JOIN locations l ON l.id = e.location_id
      WHERE e.id IN (SELECT ed.event_id FROM event_duties ed WHERE ed.id IN (SELECT value FROM json_each(?1)))
      ORDER BY e.starts_at`,
    JSON.stringify([...wanted]),
  );
  const eventIds = events.map((e) => e.id);
  const [{ blocks, entries }, skills, names] = await Promise.all([loadBlocksAndEntries(db, eventIds), loadSkills(db, actor), teamNames(db)]);
  const now = nowLocal();
  return c.json({
    team: header,
    games: events.map((e) => ({
      ...eventView(e, now),
      teamId: e.team_id ?? CLUB_KEY,
      teamName: e.team_name ?? t`Whole club`,
      canManage: false,
      hidden: false,
      blocks: blocks
        .filter((b) => b.event_id === e.id && wanted.has(b.id))
        .map((b) => blockView(b, types.get(b.duty_type_id)!, entries, actor, { team: null, skills, past: e.starts_at < now, names })),
    })),
  });
});

/**
 * One event with its blocks for managing (event page "Manage helper duties"), also without blocks: the same shape as
 * an event of the list in the Helpers tab.
 */
dutyRoutes.get("/duties/events/:id/manage", async (c) => {
  const actor = requireActor(c);
  const db = c.env.DB;
  const managed = await managedEvent(db, actor, intParam(c, "id"));
  const e = (await first<EventRow>(db, `SELECT ${EVENT_COLUMNS} FROM events e LEFT JOIN locations l ON l.id = e.location_id WHERE e.id = ?`, managed.id))!;
  if (e.kind === "game") await ensureEventDuties(db, [e.id], todayLocal());
  const now = nowLocal();
  const [{ blocks, entries }, types, skills, names] = await Promise.all([loadBlocksAndEntries(db, [e.id]), loadDutyTypes(db, [e.id]), loadSkills(db, actor), teamNames(db)]);
  const conflicts = await rotationConflicts(db, blocks.filter((b) => b.starts_at >= now), names);
  const teamId = managed.teamIds[0] ?? null;
  return c.json({
    ...eventView(e, now),
    teamId: teamId ?? CLUB_KEY,
    teamName: teamId ? (names.get(teamId) ?? null) : t`Whole club`,
    club: managed.club_wide === 1,
    canManage: true,
    blocks: blocks
      .filter((b) => types.has(b.duty_type_id))
      .map((b) => blockView(b, types.get(b.duty_type_id)!, entries, actor, { team: null, skills, past: e.starts_at < now, names, conflicts })),
  });
});

/**
 * List of the Helpers tab: one team (?teamId=) or several together (?teamIds=1,2, the app's default "all").
 * An event of several teams is listed once, with the first of them.
 */
dutyRoutes.get("/duties", async (c) => {
  const actor = requireActor(c);
  const db = c.env.DB;
  const raw = c.req.query("teamIds") ?? c.req.query("teamId") ?? "";
  const ids = [...new Set(raw.split(",").map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 40);
  const types = await loadDutyTypes(db);
  const visible = await helperTeams(db, actor, types);
  const teams = ids.map((id) => visible.find((ht) => ht.teamId === id)).filter((ht): ht is HelperTeam => !!ht);
  if (!teams.length || teams.length !== ids.length) throw forbidden(t`This team has no helper plan, or you are not part of it.`);
  const ctx = { skills: await loadSkills(db, actor), from: `${addDays(todayLocal(), -PAST_DAYS)}T00:00`, now: nowLocal() };
  const lists = await Promise.all(teams.map((ht) => teamDutyGames(db, actor, ht, ctx)));
  const seen = new Set<number>();
  const games = lists
    .flat()
    .filter((g) => !seen.has(g.id) && seen.add(g.id))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  return c.json({ team: teams.length === 1 ? publicHelperTeam(teams[0]!) : null, teams: teams.map(publicHelperTeam), games });
});

const signupSchema = z.object({
  blockId: z.number().int().positive(),
  childId: z.number().int().positive().nullable().optional(),
  note: z.string().trim().max(200).nullable().optional(),
  onBehalfPersonId: z.number().int().positive().optional(),
  manualName: z.string().trim().min(1).max(60).optional(),
});

dutyRoutes.post("/duties", async (c) => {
  const actor = requireActor(c);
  const db = c.env.DB;
  const input = parse(signupSchema, await readJson(c.req.raw));
  const block = await loadBlock(db, input.blockId);
  if (!block) throw notFound(t`This duty does not exist.`);
  const types = await loadDutyTypes(db, [block.event_id]);
  const type = types.get(block.duty_type_id);
  if (!type) throw notFound(t`This duty does not exist.`);
  if (block.event_starts_at < nowLocal()) throw badRequest(t`The event is in the past.`, "game_in_past");
  if (type.whoQualified) return qualifiedSignup(c, actor, block, type, input);

  const club = block.club_wide === 1;
  // Club event: "who helps" across all teams; organisers manage it as for special events of teams
  const teams = club
    ? [{ ...(await clubHelperTeam(db, actor)), canManage: mayManageDuties(actor, [], (await dutyManagers(db, [block.event_id])).get(block.event_id)) }]
    : (await helperTeams(db, actor, types)).filter((t) => block.teamIds.includes(t.teamId));
  const team = teams.find((t) => t.canManage) ?? teams[0];
  // "Helpers from" on the block: the players of those teams do not belong to the event's team
  const source = helperSource(block);
  const sourceRoles = teamRolesFor(actor, type, helperTeamsOf(source));
  if (!team && !sourceRoles.length) throw forbidden(t`You cannot sign up for this team.`);
  if (block.cancelled_at || (block.duty_hidden && block.event_kind === "game" && !team?.canManage) || block.slots === 0) {
    throw badRequest(t`This duty does not exist for this event.`, "game_unavailable");
  }
  const note = type.noteAllowed ? input.note || null : null;

  let personId: number | null = null;
  let childId: number | null = null;
  let manualName: string | null = null;
  if (input.onBehalfPersonId != null || input.manualName != null) {
    if (!mayManageDuties(actor, block.teamIds, (await dutyManagers(db, [block.event_id])).get(block.event_id))) {
      throw forbidden(t`Only coaches, admins and the organisers of the event can sign up others.`);
    }
    if (input.manualName != null) {
      manualName = input.manualName;
    } else {
      // Any active person in the club, regardless of “who helps” and skills (except for the rules below)
      const exists = await first<{ minor: number }>(db, `SELECT NOT ${adultSql("persons.id")} AS minor FROM persons WHERE id = ? AND is_former = 0`, input.onBehalfPersonId!);
      if (!exists) throw badRequest(t`This person does not exist.`, "unknown_person");
      const duty = type.name;
      if (type.adultsOnly && exists.minor) throw badRequest(t`Only adults take on ${duty}.`, "adults_only");
      personId = input.onBehalfPersonId!;
      childId = input.childId ?? null;
      // Assigned by the coach: only whom "who helps" of the duty type (or the block's teams) allows
      if (type.assignOnly) {
        // ?2 always used: with only "helpers from" teams it does not appear in the expression itself
        const fits = await first<{ ok: number }>(
          db,
          `SELECT ${whoSql(type, "?1", "SELECT value FROM json_each(?2)", source)} AS ok FROM (SELECT ?2 AS team_ids)`,
          personId,
          JSON.stringify(club ? await allTeamIds(db) : block.teamIds),
        );
        if (!fits?.ok) throw badRequest(t`This person does not fit “who helps” of ${duty}.`, "not_in_who");
      }
      if (childId != null) {
        const isChild = await first(db, "SELECT 1 AS ok FROM guardianships WHERE guardian_id = ? AND child_id = ?", personId, childId);
        if (!isChild) childId = null;
      }
      // Helpers from other teams: an assigned child is linked as the child too, so the parents see it and can remove it
      if (childId == null && source.mode !== "default") {
        const hasParents = await first(db, "SELECT 1 AS ok FROM guardianships WHERE child_id = ?", personId);
        if (hasParents) childId = personId;
      }
    }
  } else {
    const allowed = blockRoles(actor, teams, type, source);
    const roles = input.childId != null ? allowed.filter((r) => r.childId === input.childId) : allowed;
    const duty = type.name;
    if (!roles.length && type.assignOnly) throw forbidden(t`The coach assigns ${duty}.`, "assign_only");
    // Without the age limit there would have been a role: say clearly why not
    if (!roles.length && type.adultsOnly && blockRoles(actor, teams, { ...type, adultsOnly: false }, source).length) throw forbidden(t`Only adults take on ${duty}.`, "adults_only");
    if (!roles.length) {
      throw input.childId != null
        ? badRequest(t`This child is not in the team.`, "child_not_in_team")
        : forbidden(t`Others take on this duty.`, "not_allowed");
    }
    // Helpers from other teams: when the child does the duty, the child is the person in the entry (as for approved
    // children); without a choice only when it is clear
    const doers = roles.filter((r) => r.doer);
    const doer = input.childId != null ? doers.find((r) => r.childId === input.childId) : !roles.some((r) => !r.doer) && doers.length === 1 ? doers[0] : undefined;
    if (!doer && input.childId == null && !roles.some((r) => !r.doer)) throw badRequest(t`Who are you signing up for?`, "child_required");
    if (doer) {
      personId = doer.childId;
      childId = doer.childId;
    } else {
      // Otherwise the entry is for oneself; a child in the team is linked automatically (the first if there are
      // several) so that the other parent sees the duty
      personId = actor.personId;
      childId = input.childId ?? roles.find((r) => r.childId != null && !r.doer)?.childId ?? null;
    }
    if (!mayTake(type, await loadSkills(db, actor), actor.personId)) {
      const duty = type.name;
      throw type.skillGrant === "admin"
        ? badRequest(t`Only people approved by an admin can take on ${duty}.`, "skill_missing")
        : badRequest(t`You can take on ${duty} once you switch it on in your profile under “I can do this”.`, "skill_missing");
    }
  }
  await insertEntry(db, block, type, { personId, childId, manualName, note, createdBy: actor.personId });
  notifyDutyHubs(c.env, block.teamIds, (p) => c.executionCtx.waitUntil(p));
  // Assigned: the person learns it at once (not only with the reminder three days before)
  if (type.assignOnly && personId != null && personId !== actor.personId) {
    c.executionCtx.waitUntil(sendDutyAssigned(c.env, { blockId: block.id, personId, byName: actor.firstName }));
  }
  return c.json({ ok: true }, 201);
});

/** Atomic: only sign up while a place in the block is free. */
async function insertEntry(
  db: D1Database,
  block: { id: number; event_id: number },
  type: DutyType,
  e: { personId: number | null; childId: number | null; manualName: string | null; note: string | null; createdBy: number },
) {
  let res: D1Result;
  try {
    res = await run(
      db,
      `INSERT INTO duties (event_id, event_duty_id, duty_type_id, person_id, child_id, manual_name, note, created_by)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8
        WHERE (SELECT count(*) FROM duties WHERE event_duty_id = ?2) < (SELECT slots FROM event_duties WHERE id = ?2)`,
      block.event_id,
      block.id,
      type.id,
      e.personId,
      e.childId,
      e.manualName,
      e.note,
      e.createdBy,
    );
  } catch (err) {
    if (err instanceof Error && /UNIQUE/.test(err.message)) throw conflict(t`You are already signed up for this duty.`, "already_signed_up");
    throw err;
  }
  if (!res.meta.changes) throw conflict(t`Sorry, this place has already been taken.`, "slot_taken");
}

/**
 * Sign up for a type taken by qualified people from all teams (e.g. youth referee): only with the type's approval
 * (oneself or a child), regardless of the team.
 */
async function qualifiedSignup(
  c: Context<AppEnv>,
  actor: Actor,
  block: NonNullable<Awaited<ReturnType<typeof loadBlock>>>,
  type: DutyType,
  input: z.infer<typeof signupSchema>,
) {
  const db = c.env.DB;
  const duty = type.name;
  if (block.cancelled_at || block.slots === 0) throw badRequest(t`This game does not need ${duty}.`, "game_unavailable");
  const manage = isCoachOfAny(actor, block.teamIds);
  let personId: number | null = null;
  let childId: number | null = null;
  let manualName: string | null = null;
  if (input.onBehalfPersonId != null || input.manualName != null) {
    if (!manage) throw forbidden(t`Only coaches and admins can sign up others.`);
    if (input.manualName != null) manualName = input.manualName;
    else {
      const granted = await first(db, "SELECT 1 AS ok FROM skill_grants WHERE person_id = ? AND duty_type_id = ?", input.onBehalfPersonId!, type.id);
      if (!granted) throw badRequest(t`This person is not approved for ${duty}.`, "not_qualified");
      personId = input.onBehalfPersonId!;
    }
  } else {
    const roles = qualifiedRoles(actor, await loadSkills(db, actor), type.id);
    const role = input.childId != null ? roles.find((r) => r.childId === input.childId) : roles.length === 1 ? roles[0] : roles.find((r) => r.childId == null);
    if (!role) {
      throw roles.length ? badRequest(t`Who are you signing up for?`, "child_required") : forbidden(t`Only people approved for ${duty} can sign up.`, "not_qualified");
    }
    // The person doing the duty is the person in the entry. For a child also child_id, so the parents see it.
    personId = role.childId ?? actor.personId;
    childId = role.childId;
  }
  await insertEntry(db, block, type, { personId, childId, manualName, note: null, createdBy: actor.personId });
  notifyDutyHubs(c.env, block.teamIds, (p) => c.executionCtx.waitUntil(p));
  c.executionCtx.waitUntil(notifyDutyChange(c.env, qualifiedHub(type.id)));
  return c.json({ ok: true }, 201);
}

async function loadEntry(db: D1Database, id: number) {
  const row = await first<{
    id: number;
    event_id: number;
    event_duty_id: number;
    person_id: number | null;
    child_id: number | null;
    starts_at: string;
    note_allowed: number;
    duty_type_id: number;
    who_referees: number;
    team_ids: string;
  }>(
    db,
    `SELECT d.id, d.event_id, d.event_duty_id, d.person_id, d.child_id, e.starts_at, dt.note_allowed, dt.id AS duty_type_id, dt.who_referees,
            (SELECT json_group_array(team_id) FROM (SELECT et.team_id FROM event_teams et WHERE et.event_id = e.id ORDER BY et.team_id)) AS team_ids
       FROM duties d JOIN events e ON e.id = d.event_id JOIN duty_types dt ON dt.id = d.duty_type_id WHERE d.id = ?`,
    id,
  );
  return row ? { ...row, teamIds: JSON.parse(row.team_ids) as number[] } : null;
}

async function mayManageEntry(db: D1Database, actor: Actor, entry: { event_id: number; teamIds: number[] }) {
  return mayManageDuties(actor, entry.teamIds, (await dutyManagers(db, [entry.event_id])).get(entry.event_id));
}

dutyRoutes.patch("/duties/:id", async (c) => {
  const actor = requireActor(c);
  const entry = await loadEntry(c.env.DB, intParam(c, "id"));
  if (!entry) throw notFound(t`This entry does not exist.`);
  if (entry.person_id !== actor.personId && !(await mayManageEntry(c.env.DB, actor, entry))) throw forbidden();
  if (entry.note_allowed !== 1) throw badRequest(t`This duty has no note.`);
  const { note } = parse(z.object({ note: z.string().trim().max(200).nullable() }), await readJson(c.req.raw));
  await run(c.env.DB, "UPDATE duties SET note = ? WHERE id = ?", note || null, entry.id);
  notifyDutyHubs(c.env, entry.teamIds, (p) => c.executionCtx.waitUntil(p));
  return c.json({ ok: true });
});

dutyRoutes.delete("/duties/:id", async (c) => {
  const actor = requireActor(c);
  const entry = await loadEntry(c.env.DB, intParam(c, "id"));
  if (!entry) throw notFound(t`This entry does not exist.`);
  const manage = await mayManageEntry(c.env.DB, actor, entry);
  const own = entry.person_id === actor.personId || (entry.child_id != null && actor.children.some((ch) => ch.id === entry.child_id));
  if (!manage && !own) throw forbidden();
  if (!manage && entry.starts_at < nowLocal()) throw badRequest(t`The event is in the past.`, "game_in_past");
  await run(c.env.DB, "DELETE FROM duties WHERE id = ?", entry.id);
  notifyDutyHubs(c.env, entry.teamIds, (p) => c.executionCtx.waitUntil(p));
  if (entry.who_referees === 1) c.executionCtx.waitUntil(notifyDutyChange(c.env, qualifiedHub(entry.duty_type_id)));
  return c.json({ ok: true });
});

// Managing blocks (coaches and admins) -------------------------------------------


const blockTimeSchema = z.string().refine(isLocalDateTime, { error: () => t`Invalid time.` });
const slotsSchema = z.number().int().min(0).max(20);

const newBlockSchema = z
  .object({
    dutyTypeId: z.number().int().positive().optional(),
    /** Special duty only for this event (coaches may do this for special events) */
    newTypeName: z.string().trim().min(1).max(40).optional(),
    startsAt: blockTimeSchema,
    endsAt: blockTimeSchema,
    slots: slotsSchema,
    /** "Helpers from": as the duty type or certain teams (taking turns only through templates) */
    ...helperSourceSchema,
  })
  .refine((v) => (v.dutyTypeId == null) !== (v.newTypeName == null), { error: () => t`Please choose a duty.` });

/** Create a time block. With newTypeName a special duty only for this event is created. */
dutyRoutes.post("/duties/events/:id/blocks", async (c) => {
  const actor = requireActor(c);
  const db = c.env.DB;
  const event = await managedEvent(db, actor, intParam(c, "id"));
  const input = parse(newBlockSchema, await readJson(c.req.raw));
  if (input.endsAt < input.startsAt) throw badRequest(t`The end must be after the start.`);
  const source = await checkHelperSource(db, input.helperMode, input.helperTeams, false);
  let typeId = input.dutyTypeId ?? null;
  if (typeId != null) {
    const type = (await loadDutyTypes(db, [event.id])).get(typeId);
    if (!type || type.archived || (type.eventId != null && type.eventId !== event.id)) throw badRequest(t`This duty does not exist.`);
  } else {
    const row = await first<{ id: number }>(
      db,
      "INSERT INTO duty_types (name, mode, who_parents, event_id, sort) VALUES (?, 'onsite', 1, ?, 50) RETURNING id",
      input.newTypeName!,
      event.id,
    );
    typeId = row!.id;
  }
  const row = await first<{ id: number }>(
    db,
    "INSERT INTO event_duties (event_id, duty_type_id, starts_at, ends_at, slots, sort, helper_mode, helper_teams) VALUES (?, ?, ?, ?, ?, 50, ?, ?) RETURNING id",
    event.id,
    typeId,
    input.startsAt,
    input.endsAt,
    input.slots,
    source.mode,
    source.mode === "default" ? null : JSON.stringify(source.teams),
  );
  notifyDutyHubs(c.env, event.teamIds, (p) => c.executionCtx.waitUntil(p));
  return c.json({ id: row!.id }, 201);
});

const updateBlockSchema = z.object({
  startsAt: blockTimeSchema.optional(),
  endsAt: blockTimeSchema.optional(),
  slots: slotsSchema.optional(),
  /** Taking turns: the team in charge this time (from the list) */
  rotateTeamId: z.number().int().positive().optional(),
  /** Change "helpers from": as the duty type or certain teams */
  helperMode: z.enum(["default", "teams"]).optional(),
  helperTeams: z.array(z.number().int().positive()).max(30).optional(),
});

dutyRoutes.patch("/duties/blocks/:id", async (c) => {
  const actor = requireActor(c);
  const db = c.env.DB;
  const block = await loadBlock(db, intParam(c, "id"));
  if (!block) throw notFound(t`This duty does not exist.`);
  if (!mayManageDuties(actor, block.teamIds, (await dutyManagers(db, [block.event_id])).get(block.event_id))) {
    throw forbidden(t`Only coaches of this team and the organisers of the event can do this.`);
  }
  const input = parse(updateBlockSchema, await readJson(c.req.raw));
  const startsAt = input.startsAt ?? block.starts_at;
  const endsAt = input.endsAt ?? block.ends_at;
  if (endsAt < startsAt) throw badRequest(t`The end must be after the start.`);
  if (input.slots != null) {
    const taken = await first<{ n: number }>(db, "SELECT count(*) AS n FROM duties WHERE event_duty_id = ?", block.id);
    if (input.slots < (taken?.n ?? 0)) throw badRequest(t`More people are already signed up. Please remove someone first.`, "slots_below_entries");
  }
  const statements = [stmt(db, "UPDATE event_duties SET starts_at = ?, ends_at = ?, slots = ? WHERE id = ?", startsAt, endsAt, input.slots ?? block.slots, block.id)];
  if (input.rotateTeamId != null) {
    if (block.helper_mode !== "rotate" || !helperSource(block).pool.includes(input.rotateTeamId)) throw badRequest(t`This team is not in the list here.`, "bad_helper_source");
    // A new team in charge: its chat is told (again)
    if (input.rotateTeamId !== block.rotate_team_id) {
      statements.push(stmt(db, "UPDATE event_duties SET rotate_team_id = ?, rotate_notified = NULL WHERE id = ?", input.rotateTeamId, block.id));
    }
  }
  if (input.helperMode != null) {
    if (block.helper_mode === "rotate") throw badRequest(t`When teams take turns, change the team in charge.`, "bad_helper_source");
    const source = await checkHelperSource(db, input.helperMode, input.helperTeams ?? [], false);
    statements.push(stmt(db, "UPDATE event_duties SET helper_mode = ?, helper_teams = ? WHERE id = ?", source.mode, source.mode === "default" ? null : JSON.stringify(source.teams), block.id));
  }
  await db.batch(statements);
  notifyDutyHubs(c.env, block.teamIds, (p) => c.executionCtx.waitUntil(p));
  c.executionCtx.waitUntil(notifyDutyChange(c.env, qualifiedHub(block.duty_type_id)));
  return c.json({ ok: true });
});

dutyRoutes.delete("/duties/blocks/:id", async (c) => {
  const actor = requireActor(c);
  const db = c.env.DB;
  const block = await loadBlock(db, intParam(c, "id"));
  if (!block) throw notFound(t`This duty does not exist.`);
  if (!mayManageDuties(actor, block.teamIds, (await dutyManagers(db, [block.event_id])).get(block.event_id))) {
    throw forbidden(t`Only coaches of this team and the organisers of the event can do this.`);
  }
  // The entries go with it (the app asks first); as when removing a single entry, without a notification
  const taken = await first<{ n: number }>(db, "SELECT count(*) AS n FROM duties WHERE event_duty_id = ?", block.id);
  await db.batch([
    stmt(db, "DELETE FROM duties WHERE event_duty_id = ?", block.id),
    stmt(db, "DELETE FROM event_duties WHERE id = ?", block.id),
    // Also remove a special duty without further blocks
    stmt(db, "DELETE FROM duty_types WHERE id = ? AND event_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM event_duties WHERE duty_type_id = ?)", block.duty_type_id, block.duty_type_id),
  ]);
  notifyDutyHubs(c.env, block.teamIds, (p) => c.executionCtx.waitUntil(p));
  // Entries of approved people from all teams went with it: their list reloads too
  if ((taken?.n ?? 0) > 0) c.executionCtx.waitUntil(notifyDutyChange(c.env, qualifiedHub(block.duty_type_id)));
  return c.json({ ok: true });
});

/** Apply a template to an event (special events), times from the start and end of the event. */
dutyRoutes.post("/duties/events/:id/apply-template", async (c) => {
  const actor = requireActor(c);
  const db = c.env.DB;
  const event = await managedEvent(db, actor, intParam(c, "id"));
  const { templateId } = parse(z.object({ templateId: z.number().int().positive() }), await readJson(c.req.raw));
  const items = await templateItems(db, templateId);
  if (!items.length) throw badRequest(t`This template is empty or does not exist.`);
  const types = await loadDutyTypes(db);
  const end = event.ends_at ?? addMinutesLocal(event.starts_at, 120);
  const statements: D1PreparedStatement[] = [];
  for (const [i, item] of items.entries()) {
    const type = types.get(item.dutyTypeId);
    if (!type || type.archived || type.whoQualified) continue;
    const b = blockFromItem(item, type.mode, event.starts_at, end);
    const src = await itemSource(db, item);
    statements.push(
      stmt(
        db,
        "INSERT INTO event_duties (event_id, duty_type_id, starts_at, ends_at, slots, sort, helper_mode, helper_teams, rotate_team_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        event.id,
        type.id,
        b.startsAt,
        b.endsAt,
        item.slots,
        i + 1,
        src.mode,
        src.teams,
        src.rotateTeamId,
      ),
    );
  }
  if (statements.length) await db.batch(statements);
  notifyDutyHubs(c.env, event.teamIds, (p) => c.executionCtx.waitUntil(p));
  return c.json({ ok: true, created: statements.length });
});

const ACCOUNT_ONLY_SQL =
  "AND EXISTS (SELECT 1 FROM accounts a WHERE a.person_id = p.id AND a.disabled_at IS NULL) AND EXISTS (SELECT 1 FROM club_members cm WHERE cm.person_id = p.id)";
// The search text goes in the body, not the URL: request logs record URLs, and the text is part of a name
const searchSchema = z.object({
  q: z.string().max(100),
  account: z.boolean().optional(),
  /** Assigning to this block: the rules of its duty type and "helpers from" apply */
  blockId: z.number().int().positive().optional(),
});

/**
 * SQL filter for "sign someone up" at a block (person expression): duties the coach assigns only list people fitting
 * "who helps" (or the block's teams), adults only no minors. Empty when nothing limits the choice.
 */
async function assignFilter(db: D1Database, event: { id: number; teamIds: number[]; club_wide: number }, blockId: number | undefined) {
  if (!blockId) return { who: (_: string) => "", pool: [] as number[] };
  const block = await first<HelperColumns & { event_id: number; duty_type_id: number }>(db, `SELECT ed.event_id, ed.duty_type_id, ${HELPER_COLUMNS} FROM event_duties ed WHERE ed.id = ?`, blockId);
  if (!block || block.event_id !== event.id) return { who: (_: string) => "", pool: [] as number[] };
  const type = (await loadDutyTypes(db, [event.id])).get(block.duty_type_id);
  const source = helperSource(block);
  // Team ids come from the database (integers), so they go into the SQL directly
  const scope = (event.club_wide === 1 ? await allTeamIds(db) : event.teamIds).filter(Number.isInteger);
  const teamSet = `SELECT value FROM json_each('${JSON.stringify(scope)}')`;
  const who = (person: string) => (type?.assignOnly ? `AND ${whoSql(type, person, teamSet, source)}` : type?.adultsOnly ? `AND ${adultSql(person)}` : "");
  return { who, pool: helperTeamsOf(source).filter(Number.isInteger) };
}

/** Search in the whole club (coaches and admins only), from 2 characters: short name and teams, no birth year. */
async function searchPeople(db: D1Database, text: string, accountOnly: boolean, who: (person: string) => string = () => "") {
  const q = text.trim().toLowerCase();
  if (q.length < 2) return [];
  const like = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
  const found = await all<{ id: number; name: string; teams: string | null }>(
    db,
    `SELECT p.id, ${SHORT_NAME_SQL("p")} AS name,
            (SELECT group_concat(t.name, ', ') FROM team_memberships tm JOIN teams t ON t.id = tm.team_id AND t.kind = 'team' WHERE tm.person_id = p.id) AS teams
       FROM persons p
      WHERE p.is_former = 0 ${accountOnly ? ACCOUNT_ONLY_SQL : ""} ${who("p.id")}
        AND (lower(p.first_name || ' ' || coalesce(p.last_name, '')) LIKE ?1 ESCAPE '\\' OR lower(coalesce(p.last_name, '')) LIKE ?1 ESCAPE '\\')
      ORDER BY p.first_name, p.last_name LIMIT 20`,
    like,
  );
  return found.map((p) => ({ personId: p.id, name: p.name, childId: null, childName: null, teams: p.teams }));
}

dutyRoutes.post("/duties/teams/:id/people/search", async (c) => {
  const actor = requireActor(c);
  if (!isCoachOf(actor, intParam(c, "id"))) throw forbidden();
  const input = parse(searchSchema, await readJson(c.req.raw));
  return c.json({ people: await searchPeople(c.env.DB, input.q, false) });
});

dutyRoutes.post("/duties/events/:id/people/search", async (c) => {
  const actor = requireActor(c);
  const event = await managedEvent(c.env.DB, actor, intParam(c, "id"));
  const input = parse(searchSchema, await readJson(c.req.raw));
  const { who } = await assignFilter(c.env.DB, event, input.blockId);
  return c.json({ people: await searchPeople(c.env.DB, input.q, !!input.account, who) });
});

/** Possible persons for "sign someone up": parents of the players, players, coaches. */
dutyRoutes.get("/duties/teams/:id/people", async (c) => {
  const actor = requireActor(c);
  const teamId = intParam(c, "id");
  if (!isCoachOf(actor, teamId)) throw forbidden();
  const people = await all<{ id: number; name: string; child_id: number | null; child_name: string | null }>(
    c.env.DB,
    `SELECT gp.id, ${SHORT_NAME_SQL("gp")} AS name, ch.id AS child_id, ch.first_name AS child_name
       FROM team_memberships tm JOIN persons ch ON ch.id = tm.person_id AND ch.is_former = 0
       JOIN guardianships g ON g.child_id = ch.id JOIN persons gp ON gp.id = g.guardian_id AND gp.is_former = 0
      WHERE tm.team_id = ?1 AND tm.role IN ('player', 'helper')
     UNION
     SELECT p.id, ${SHORT_NAME_SQL("p")}, NULL, NULL FROM team_memberships tm JOIN persons p ON p.id = tm.person_id AND p.is_former = 0
      WHERE tm.team_id = ?1
     ORDER BY 2`,
    teamId,
  );
  return c.json({ people: people.map((p) => ({ personId: p.id, name: p.name, childId: p.child_id, childName: p.child_name })) });
});

/**
 * Persons for “sign someone up” and the organiser choice of an event (managers of the event only): the persons
 * of the teams involved (parents with child, members; for club events all teams). Searching the whole club:
 * POST …/people/search. account=1: only full club members with active access (organisers). block=<id>: the rules of
 * that block (duties the coach assigns, adults only, the players of its "helpers from" teams).
 */
dutyRoutes.get("/duties/events/:id/people", async (c) => {
  const actor = requireActor(c);
  const db = c.env.DB;
  const event = await managedEvent(db, actor, intParam(c, "id"));
  const accountOnly = c.req.query("account") === "1";
  const { who, pool } = await assignFilter(db, event, Number(c.req.query("block") ?? 0) || undefined);
  const accountSql = (accountOnly ? ACCOUNT_ONLY_SQL : "") + ` ${who("p.id")}`;
  const ids = JSON.stringify(event.club_wide === 1 ? await allTeamIds(db) : event.teamIds);
  const people = await all<{ id: number; name: string; child_id: number | null; child_name: string | null }>(
    db,
    accountOnly
      ? `SELECT DISTINCT p.id, ${SHORT_NAME_SQL("p")} AS name, NULL AS child_id, NULL AS child_name
           FROM team_memberships tm JOIN persons p ON p.id = tm.person_id AND p.is_former = 0
          WHERE tm.team_id IN (SELECT value FROM json_each(?1)) ${accountSql}
         ORDER BY 2`
      : `SELECT gp.id, ${SHORT_NAME_SQL("gp")} AS name, ch.id AS child_id, ch.first_name AS child_name
           FROM team_memberships tm JOIN persons ch ON ch.id = tm.person_id AND ch.is_former = 0
           JOIN guardianships g ON g.child_id = ch.id JOIN persons gp ON gp.id = g.guardian_id AND gp.is_former = 0
          WHERE tm.team_id IN (SELECT value FROM json_each(?1)) AND tm.role IN ('player', 'helper') ${who("gp.id")}
         UNION
         SELECT p.id, ${SHORT_NAME_SQL("p")}, NULL, NULL FROM team_memberships tm JOIN persons p ON p.id = tm.person_id AND p.is_former = 0
          WHERE tm.team_id IN (SELECT value FROM json_each(?1)) ${who("p.id")}
         ${
           // "Helpers from": the players of the block's teams (ids from the database)
           pool.length
             ? `UNION SELECT p.id, ${SHORT_NAME_SQL("p")}, NULL, NULL FROM team_memberships tm JOIN persons p ON p.id = tm.person_id AND p.is_former = 0
                 WHERE tm.role = 'player' AND tm.team_id IN (${pool.join(", ")}) ${who("p.id")}`
             : ""
         }
         ORDER BY 2`,
    ids,
  );
  return c.json({ people: people.map((p) => ({ personId: p.id, name: p.name, childId: p.child_id, childName: p.child_name })) });
});

/** Top 10 helpers of a team (only within this team). */
dutyRoutes.get("/duties/teams/:id/top", async (c) => {
  const actor = requireActor(c);
  const teamId = intParam(c, "id");
  if (!(await helperTeams(c.env.DB, actor)).some((t) => t.teamId === teamId)) throw forbidden();
  const rows = await all<{ name: string; n: number }>(
    c.env.DB,
    `SELECT coalesce(d.manual_name, ${SHORT_NAME_SQL("p")}) AS name, count(*) AS n
       FROM duties d JOIN event_teams et ON et.event_id = d.event_id AND et.team_id = ?
       LEFT JOIN persons p ON p.id = d.person_id
      GROUP BY coalesce(d.person_id, 'm:' || d.manual_name) ORDER BY n DESC, name LIMIT 10`,
    teamId,
  );
  const best = rows[0]?.n ?? 0;
  return c.json({ top: rows.map((r) => ({ name: r.name, count: r.n, star: r.n === best })) });
});

dutyRoutes.get("/duties/teams/:id/live", async (c) => {
  const actor = requireActor(c);
  const teamId = intParam(c, "id");
  if (c.req.header("upgrade")?.toLowerCase() !== "websocket") throw badRequest(t`Expected a WebSocket connection.`);
  if (!(await helperTeams(c.env.DB, actor)).some((t) => t.teamId === teamId)) throw forbidden();
  return dutyHubStub(c.env, teamId).fetch(new Request("https://duties.internal/connect", { headers: upgradeHeaders(c.req.raw) }));
});

// Profile: “I can do this”, channels ---------------------------------------------

export const DUTY_TOPICS = ["duty_remind_3d", "duty_remind_1d", "duty_open", "duty_coach_open", "duty_referee_open"] as const;
export type DutyTopic = (typeof DUTY_TOPICS)[number];
/** Default when nothing is set: push on, mail off. */
export const DEFAULT_CHANNEL = { push: true, mail: false, sms: false };

dutyRoutes.get("/profile/duty-prefs", async (c) => {
  const actor = requireActor(c);
  const db = c.env.DB;
  const [rows, email, types, consents, skills] = await Promise.all([
    all<{ topic: DutyTopic; push: number; mail: number; sms: number }>(db, "SELECT topic, push, mail, sms FROM notification_channels WHERE account_id = ?", actor.accountId),
    first<{ email: string | null; email_verified_at: string | null; phone: string | null; phone_verified_at: string | null }>(
      db,
      "SELECT email, email_verified_at, phone, phone_verified_at FROM accounts WHERE id = ?",
      actor.accountId,
    ),
    loadDutyTypes(db),
    skillConsents(db, actor.accountId),
    loadSkills(db, actor),
  ]);
  const people = [{ id: actor.personId, name: null as string | null }, ...actor.children.map((ch) => ({ id: ch.id, name: ch.firstName }))];
  return c.json({
    // Duty types needing skills the person approves: only after consent (“I can do this”)
    skills: [...types.values()]
      .filter((dt) => dt.needsSkill && dt.skillGrant === "self" && !dt.archived)
      .map((dt) => ({ dutyTypeId: dt.id, code: dt.code, name: dt.name, on: consents.has(dt.id) })),
    // Approved by an admin, for oneself and the children: information only
    approved: [...types.values()]
      .filter((dt) => dt.needsSkill && dt.skillGrant === "admin" && !dt.archived)
      .flatMap((dt) => people.filter((p) => skills.grants.get(p.id)?.has(dt.id)).map((p) => ({ dutyTypeId: dt.id, name: dt.name, child: p.name }))),
    channels: Object.fromEntries(
      DUTY_TOPICS.map((t) => {
        const r = rows.find((x) => x.topic === t);
        return [t, r ? { push: r.push === 1, mail: r.mail === 1, sms: r.sms === 1 } : DEFAULT_CHANNEL];
      }),
    ),
    mailAddressVerified: !!email?.email && !!email.email_verified_at,
    // SMS only with the module on and a confirmed number
    smsAvailable: textsOn() && !!email?.phone && !!email.phone_verified_at,
  });
});

const prefsSchema = z.object({
  skills: z.array(z.object({ dutyTypeId: z.number().int().positive(), on: z.boolean() })).max(50).optional(),
  channels: z.partialRecord(z.enum(DUTY_TOPICS), z.object({ push: z.boolean(), mail: z.boolean(), sms: z.boolean().default(false) })).optional(),
});

dutyRoutes.put("/profile/duty-prefs", async (c) => {
  const actor = requireActor(c);
  const db = c.env.DB;
  const input = parse(prefsSchema, await readJson(c.req.raw));
  const statements: D1PreparedStatement[] = [];
  for (const s of input.skills ?? []) {
    statements.push(
      s.on
        ? stmt(db, "INSERT OR IGNORE INTO skill_consents (account_id, duty_type_id) SELECT ?, id FROM duty_types WHERE id = ? AND needs_skill = 1 AND skill_grant = 'self'", actor.accountId, s.dutyTypeId)
        : stmt(db, "DELETE FROM skill_consents WHERE account_id = ? AND duty_type_id = ?", actor.accountId, s.dutyTypeId),
    );
  }
  for (const [topic, ch] of Object.entries(input.channels ?? {})) {
    statements.push(
      stmt(
        db,
        `INSERT INTO notification_channels (account_id, topic, push, mail, sms) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (account_id, topic) DO UPDATE SET push = excluded.push, mail = excluded.mail, sms = excluded.sms`,
        actor.accountId,
        topic,
        ch.push ? 1 : 0,
        ch.mail ? 1 : 0,
        ch.sms ? 1 : 0,
      ),
    );
  }
  if (statements.length) await db.batch(statements);
  return c.json({ ok: true });
});

// Duty types and templates: all coaches read, only admins change -----------------

function requireCoachOrAdmin(actor: Actor) {
  if (!actor.isAdmin && !actor.coachTeamIds.length) throw forbidden();
}

interface DutyTypeUsage {
  blocks: number;
  templates: number;
  /** Age groups whose home games get this duty */
  ageClasses: number;
  /** People approved by an admin */
  grants: number;
}

/**
 * Where duty types are used: time blocks at events (past ones too), templates, age groups, approvals. One pass
 * over each table instead of a count per type; only admins ask for it, and rarely.
 */
async function dutyTypeUsage(db: D1Database): Promise<Map<number, DutyTypeUsage>> {
  const [blocks, templates, classes, grants] = await Promise.all([
    all<{ id: number; n: number }>(db, "SELECT duty_type_id AS id, count(*) AS n FROM event_duties GROUP BY duty_type_id"),
    all<{ id: number; n: number }>(db, "SELECT duty_type_id AS id, count(DISTINCT template_id) AS n FROM duty_template_items GROUP BY duty_type_id"),
    all<{ id: number; n: number }>(
      db,
      `SELECT acd.duty_type_id AS id, count(*) AS n FROM age_class_duties acd JOIN age_classes ac ON ac.id = acd.age_class_id
        WHERE ac.season_id = (SELECT id FROM seasons WHERE is_current = 1) GROUP BY acd.duty_type_id`,
    ),
    all<{ id: number; n: number }>(db, "SELECT duty_type_id AS id, count(*) AS n FROM skill_grants GROUP BY duty_type_id"),
  ]);
  const usage = new Map<number, DutyTypeUsage>();
  const of = (id: number) => usage.get(id) ?? usage.set(id, { blocks: 0, templates: 0, ageClasses: 0, grants: 0 }).get(id)!;
  for (const r of blocks) of(r.id).blocks = r.n;
  for (const r of templates) of(r.id).templates = r.n;
  for (const r of classes) of(r.id).ageClasses = r.n;
  for (const r of grants) of(r.id).grants = r.n;
  return usage;
}

dutyRoutes.get("/duty-types", async (c) => {
  const actor = requireActor(c);
  requireCoachOrAdmin(actor);
  const types = await loadDutyTypes(c.env.DB);
  // Admins see whether a duty type can be deleted
  const usage = actor.isAdmin ? await dutyTypeUsage(c.env.DB) : null;
  return c.json({
    types: [...types.values()]
      .filter((dt) => c.req.query("all") === "1" || !dt.archived)
      .map((dt) => (usage ? { ...dt, usage: usage.get(dt.id) ?? { blocks: 0, templates: 0, ageClasses: 0, grants: 0 } } : dt)),
  });
});

const dutyTypeSchema = z.object({
  name: z.string().trim().min(1, { error: () => t`Please enter a name.` }).max(40),
  mode: z.enum(["onsite", "task"]),
  whoParents: z.boolean(),
  whoPlayers: z.boolean(),
  whoCoaches: z.boolean(),
  whoMembers: z.boolean().default(false),
  noteAllowed: z.boolean(),
  needsSkill: z.boolean(),
  /** Who approves the prior knowledge: the person in the profile or an admin */
  skillGrant: z.enum(["self", "admin"]).default("self"),
  /** Taken by the approved people from all teams (e.g. youth referees); only when creating, with an admin approval */
  whoQualified: z.boolean().default(false),
  /** Assigned by the coach; without it unchanged (older app versions) */
  assignOnly: z.boolean().optional(),
  /** Send "helpers wanted"; without it unchanged (new: on) */
  notifyOpen: z.boolean().optional(),
  /** Adults only (by birth year); without it unchanged */
  adultsOnly: z.boolean().optional(),
  archived: z.boolean().optional(),
});

dutyRoutes.post("/admin/duty-types", async (c) => {
  requireAdmin(requireActor(c));
  const input = parse(dutyTypeSchema, await readJson(c.req.raw));
  // "Who helps" may stay empty: then helpers come through "helpers from" on template lines and blocks (e.g. wipers from
  // youth teams), or the coach assigns them
  const qualified = input.whoQualified;
  const row = await first<{ id: number }>(
    c.env.DB,
    `INSERT INTO duty_types (name, mode, who_parents, who_players, who_coaches, who_members, who_referees, note_allowed, needs_skill, skill_grant,
                             assign_only, notify_open, adults_only, sort)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, (SELECT coalesce(max(sort), 0) + 1 FROM duty_types WHERE event_id IS NULL)) RETURNING id`,
    input.name,
    input.mode,
    !qualified && input.whoParents ? 1 : 0,
    !qualified && input.whoPlayers ? 1 : 0,
    !qualified && input.whoCoaches ? 1 : 0,
    !qualified && input.whoMembers ? 1 : 0,
    qualified ? 1 : 0,
    input.noteAllowed ? 1 : 0,
    qualified || input.needsSkill ? 1 : 0,
    qualified ? "admin" : input.needsSkill ? input.skillGrant : "self",
    !qualified && input.assignOnly ? 1 : 0,
    input.notifyOpen === false ? 0 : 1,
    input.adultsOnly ? 1 : 0,
  );
  return c.json({ id: row!.id }, 201);
});

dutyRoutes.patch("/admin/duty-types/:id", async (c) => {
  requireAdmin(requireActor(c));
  const id = intParam(c, "id");
  const type = (await loadDutyTypes(c.env.DB)).get(id);
  if (!type || type.eventId != null) throw notFound(t`This duty type does not exist.`);
  const input = parse(dutyTypeSchema, await readJson(c.req.raw));
  // Taken by approved people from all teams (e.g. youth referees): admins approve, nobody of a team helps
  if (input.whoQualified) {
    if (!type.whoQualified) {
      const templates = await first<{ n: number }>(c.env.DB, "SELECT count(*) AS n FROM duty_template_items WHERE duty_type_id = ?", id);
      if (templates?.n) throw conflict(t`Remove the duty type from the templates first.`, "duty_type_in_template");
    }
    await run(
      c.env.DB,
      `UPDATE duty_types SET name = ?, mode = 'onsite', who_parents = 0, who_players = 0, who_coaches = 0, who_members = 0, who_referees = 1, needs_skill = 1,
              skill_grant = 'admin', assign_only = 0, notify_open = ?, adults_only = ?, archived = ? WHERE id = ?`,
      input.name,
      (input.notifyOpen ?? type.notifyOpen) ? 1 : 0,
      (input.adultsOnly ?? type.adultsOnly) ? 1 : 0,
      input.archived ? 1 : 0,
      id,
    );
    return c.json({ ok: true });
  }
  await c.env.DB.batch([
    stmt(
      c.env.DB,
      `UPDATE duty_types SET name = ?, mode = ?, who_parents = ?, who_players = ?, who_coaches = ?, who_members = ?, who_referees = 0, note_allowed = ?, needs_skill = ?,
              skill_grant = ?, assign_only = ?, notify_open = ?, adults_only = ?, archived = ? WHERE id = ?`,
      input.name,
      input.mode,
      input.whoParents ? 1 : 0,
      input.whoPlayers ? 1 : 0,
      input.whoCoaches ? 1 : 0,
      input.whoMembers ? 1 : 0,
      input.noteAllowed ? 1 : 0,
      input.needsSkill ? 1 : 0,
      input.needsSkill ? input.skillGrant : "self",
      (input.assignOnly ?? type.assignOnly) ? 1 : 0,
      (input.notifyOpen ?? type.notifyOpen) ? 1 : 0,
      (input.adultsOnly ?? type.adultsOnly) ? 1 : 0,
      input.archived ? 1 : 0,
      id,
    ),
    // Now a duty of the team (e.g. the youth referee in the home game template): no longer required per age group
    stmt(c.env.DB, "DELETE FROM age_class_duties WHERE duty_type_id = ?", id),
  ]);
  return c.json({ ok: true });
});

/**
 * Delete a duty type: only when it is used nowhere (its time blocks would take the helpers' entries along),
 * otherwise archive it. Consents and admin approvals to it go with it.
 */
dutyRoutes.delete("/admin/duty-types/:id", async (c) => {
  requireAdmin(requireActor(c));
  const id = intParam(c, "id");
  const type = (await loadDutyTypes(c.env.DB)).get(id);
  if (!type || type.eventId != null) throw notFound(t`This duty type does not exist.`);
  const [blocks, templates, required] = await Promise.all([
    first<{ n: number }>(c.env.DB, "SELECT count(*) AS n FROM event_duties WHERE duty_type_id = ?", id),
    first<{ n: number }>(c.env.DB, "SELECT count(DISTINCT template_id) AS n FROM duty_template_items WHERE duty_type_id = ?", id),
    first<{ n: number }>(c.env.DB, "SELECT count(*) AS n FROM age_class_duties WHERE duty_type_id = ?", id),
  ]);
  if (blocks?.n || templates?.n || required?.n) {
    const name = type.name;
    throw conflict(t`${name} is still in use. Archive the duty type instead.`, "duty_type_in_use");
  }
  await run(c.env.DB, "DELETE FROM duty_types WHERE id = ? AND event_id IS NULL", id);
  return c.json({ ok: true });
});

/**
 * Merge a duty type into another (duplicates such as "Stewards W" and "Stewards M", now that "helpers from" sits on the
 * template line and the block): template lines, blocks, entries, consents, approvals, approval links, required duties
 * of age groups and automatic groups move; the source is deleted. Not for types taken by approved people from all teams.
 */
dutyRoutes.post("/admin/duty-types/:id/merge", async (c) => {
  requireAdmin(requireActor(c));
  const db = c.env.DB;
  const id = intParam(c, "id");
  const { intoId } = parse(z.object({ intoId: z.number().int().positive() }), await readJson(c.req.raw));
  const types = await loadDutyTypes(db);
  const from = types.get(id);
  const into = types.get(intoId);
  if (!from || !into || from.eventId != null || into.eventId != null || id === intoId) throw notFound(t`This duty type does not exist.`);
  if (from.whoQualified || into.whoQualified) throw conflict(t`Duty types taken by approved people from all teams cannot be merged.`, "qualified_type");
  if (from.mode !== into.mode) throw conflict(t`An on-site duty and a task cannot be merged.`, "mode_differs");
  await db.batch([
    stmt(db, "UPDATE duty_template_items SET duty_type_id = ? WHERE duty_type_id = ?", intoId, id),
    stmt(db, "UPDATE event_duties SET duty_type_id = ? WHERE duty_type_id = ?", intoId, id),
    stmt(db, "UPDATE duties SET duty_type_id = ? WHERE duty_type_id = ?", intoId, id),
    stmt(db, "INSERT OR IGNORE INTO skill_consents (account_id, duty_type_id, created_at) SELECT account_id, ?, created_at FROM skill_consents WHERE duty_type_id = ?", intoId, id),
    stmt(
      db,
      "INSERT OR IGNORE INTO skill_grants (person_id, duty_type_id, granted_by, granted_at) SELECT person_id, ?, granted_by, granted_at FROM skill_grants WHERE duty_type_id = ?",
      intoId,
      id,
    ),
    stmt(db, "UPDATE skill_grant_links SET duty_type_id = ? WHERE duty_type_id = ?", intoId, id),
    stmt(db, "INSERT OR IGNORE INTO age_class_duties (age_class_id, duty_type_id) SELECT age_class_id, ? FROM age_class_duties WHERE duty_type_id = ?", intoId, id),
    stmt(db, "UPDATE teams SET auto_skill = ? WHERE auto_skill = ?", intoId, id),
    stmt(db, "DELETE FROM duty_types WHERE id = ? AND event_id IS NULL", id),
  ]);
  return c.json({ ok: true });
});

interface TemplateRow {
  id: number;
  name: string;
  default_for: "home" | "away" | null;
}

dutyRoutes.get("/duty-templates", async (c) => {
  const actor = requireActor(c);
  requireCoachOrAdmin(actor);
  const db = c.env.DB;
  const [templates, items] = await Promise.all([
    all<TemplateRow>(db, "SELECT id, name, default_for FROM duty_templates ORDER BY default_for IS NULL, default_for DESC, name"),
    all<{ id: number; template_id: number; duty_type_id: number; slots: number; before_min: number; after_min: number; task_when: "before" | "after" } & HelperColumns>(
      db,
      "SELECT id, template_id, duty_type_id, slots, before_min, after_min, task_when, helper_mode, helper_teams FROM duty_template_items ORDER BY sort, id",
    ),
  ]);
  return c.json({
    templates: templates.map((t) => ({
      id: t.id,
      name: t.name,
      defaultFor: t.default_for,
      items: items
        .filter((i) => i.template_id === t.id)
        .map((i) => ({
          dutyTypeId: i.duty_type_id,
          slots: i.slots,
          beforeMin: i.before_min,
          afterMin: i.after_min,
          taskWhen: i.task_when,
          helperMode: i.helper_mode,
          helperTeams: helperSource(i).pool,
        })),
    })),
  });
});

const templateSchema = z.object({
  name: z.string().trim().min(1, { error: () => t`Please enter a name.` }).max(40),
  items: z
    .array(
      z.object({
        dutyTypeId: z.number().int().positive(),
        slots: z.number().int().min(1).max(20),
        beforeMin: z.number().int().min(0).max(600),
        afterMin: z.number().int().min(0).max(600),
        taskWhen: z.enum(["before", "after"]),
        ...helperSourceSchema,
      }),
    )
    .max(20),
});

async function saveTemplate(db: D1Database, id: number, input: z.infer<typeof templateSchema>) {
  const types = await loadDutyTypes(db);
  for (const i of input.items) {
    const type = types.get(i.dutyTypeId);
    if (!type || type.eventId != null || type.whoQualified) throw badRequest(t`This duty type does not fit into a template.`);
  }
  const sources = await Promise.all(input.items.map((i) => checkHelperSource(db, i.helperMode, i.helperTeams, true)));
  await db.batch([
    stmt(db, "UPDATE duty_templates SET name = ? WHERE id = ?", input.name, id),
    stmt(db, "DELETE FROM duty_template_items WHERE template_id = ?", id),
    ...input.items.map((i, n) =>
      stmt(
        db,
        "INSERT INTO duty_template_items (template_id, duty_type_id, slots, before_min, after_min, task_when, sort, helper_mode, helper_teams) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        id,
        i.dutyTypeId,
        i.slots,
        i.beforeMin,
        i.afterMin,
        i.taskWhen,
        n + 1,
        sources[n]!.mode,
        sources[n]!.mode === "default" ? null : JSON.stringify(sources[n]!.teams),
      ),
    ),
  ]);
}

dutyRoutes.post("/admin/duty-templates", async (c) => {
  requireAdmin(requireActor(c));
  const input = parse(templateSchema, await readJson(c.req.raw));
  const row = await first<{ id: number }>(c.env.DB, "INSERT INTO duty_templates (name) VALUES (?) RETURNING id", input.name);
  await saveTemplate(c.env.DB, row!.id, input);
  return c.json({ id: row!.id }, 201);
});

dutyRoutes.put("/admin/duty-templates/:id", async (c) => {
  requireAdmin(requireActor(c));
  const id = intParam(c, "id");
  if (!(await first(c.env.DB, "SELECT 1 AS ok FROM duty_templates WHERE id = ?", id))) throw notFound(t`This template does not exist.`);
  await saveTemplate(c.env.DB, id, parse(templateSchema, await readJson(c.req.raw)));
  // Applies at once to upcoming games without entries of the teams using this template (also as default)
  const teams = await all<{ id: number }>(
    c.env.DB,
    `SELECT t.id FROM teams t, duty_templates dt WHERE dt.id = ?1 AND t.kind = 'team'
        AND (t.home_template_id = ?1 OR t.away_template_id = ?1
             OR (dt.default_for = 'home' AND t.home_template_id IS NULL) OR (dt.default_for = 'away' AND t.away_template_id IS NULL))`,
    id,
  );
  const now = nowLocal();
  for (const t of teams) await resetTeamDuties(c.env.DB, t.id, now);
  for (const t of teams) c.executionCtx.waitUntil(notifyDutyChange(c.env, t.id));
  return c.json({ ok: true });
});

dutyRoutes.delete("/admin/duty-templates/:id", async (c) => {
  requireAdmin(requireActor(c));
  const id = intParam(c, "id");
  const template = await first<TemplateRow>(c.env.DB, "SELECT id, name, default_for FROM duty_templates WHERE id = ?", id);
  if (!template) throw notFound(t`This template does not exist.`);
  if (template.default_for) throw badRequest(t`The default template cannot be deleted.`);
  // Teams with this template fall back to the default
  const teams = await all<{ id: number }>(c.env.DB, "SELECT id FROM teams WHERE home_template_id = ?1 OR away_template_id = ?1", id);
  await run(c.env.DB, "DELETE FROM duty_templates WHERE id = ?", id);
  const now = nowLocal();
  for (const team of teams) await resetTeamDuties(c.env.DB, team.id, now);
  return c.json({ ok: true });
});
