// Helper plan: duty types, templates and time blocks per event. A duty type defines
// who helps (parents, players, coaches, KiHaSL/JuHaSL role) and whether it is an on-site
// duty or a task. Games get their blocks from the team's template, special events by hand.
// See docs/design.md, Helper duties.
import { t } from "@lingui/core/macro";
import type { Actor } from "../auth/actor";
import { isCoachOf, isCoachOfAny } from "../auth/actor";
import type { MyDuty } from "../../shared/types";
import { all, first, stmt } from "../lib/db";
import { addMinutesLocal, localToInstant } from "../lib/time";
import { CURRENT_AGE_CLASS_JOIN } from "./events";
import { isModuleOn } from "./club";

/** Code of the KiHaSL/JuHaSL duty type (initial data of migration 0018). */
export const REFEREE_CODE = "referee";

export interface DutyType {
  id: number;
  code: string | null;
  name: string;
  mode: "onsite" | "task";
  whoParents: boolean;
  whoPlayers: boolean;
  whoCoaches: boolean;
  /** Full club members (club_members) who belong to the team */
  whoMembers: boolean;
  whoReferees: boolean;
  noteAllowed: boolean;
  needsSkill: boolean;
  /** Special duty only for this event */
  eventId: number | null;
  archived: boolean;
}

interface DutyTypeRow {
  id: number;
  code: string | null;
  name: string;
  mode: "onsite" | "task";
  who_parents: number;
  who_players: number;
  who_coaches: number;
  who_members: number;
  who_referees: number;
  note_allowed: number;
  needs_skill: number;
  event_id: number | null;
  archived: number;
}

export function toDutyType(r: DutyTypeRow): DutyType {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    mode: r.mode,
    whoParents: r.who_parents === 1,
    whoPlayers: r.who_players === 1,
    whoCoaches: r.who_coaches === 1,
    whoMembers: r.who_members === 1,
    whoReferees: r.who_referees === 1,
    noteAllowed: r.note_allowed === 1,
    needsSkill: r.needs_skill === 1,
    eventId: r.event_id,
    archived: r.archived === 1,
  };
}

/** Club-wide duty types (without special duties) and optionally the special duties of the given events. */
export async function loadDutyTypes(db: D1Database, eventIds: number[] = []): Promise<Map<number, DutyType>> {
  const rows = await all<DutyTypeRow>(
    db,
    "SELECT * FROM duty_types WHERE event_id IS NULL OR event_id IN (SELECT value FROM json_each(?)) ORDER BY sort, id",
    JSON.stringify(eventIds),
  );
  return new Map(rows.map((r) => [r.id, toDutyType(r)]));
}

/** All duty types including all special duties (for the cron job). */
export async function loadAllDutyTypes(db: D1Database): Promise<Map<number, DutyType>> {
  const rows = await all<DutyTypeRow>(db, "SELECT * FROM duty_types ORDER BY sort, id");
  return new Map(rows.map((r) => [r.id, toDutyType(r)]));
}

/**
 * A youth referee (handball: KiHaSL/JuHaSL) is needed at every home game of the age classes marked
 * so in the sport profile, regardless of the team's helper plan. SQL condition (alias of the team).
 */
export const REFEREE_TEAM_SQL = (t: string) =>
  `EXISTS (SELECT 1 FROM age_classes rac WHERE rac.code = ${t}.age_class_code AND rac.youth_referee = 1
             AND rac.season_id = (SELECT id FROM seasons WHERE is_current = 1))`;

/** Time span of the KiHaSL/JuHaSL block: from 15 minutes before throw-off until the end of the game. */
const REFEREE_BEFORE_MIN = 15;

/** As whom one can sign up: oneself or as a parent for a child. */
export interface HelperRole {
  childId: number | null;
  childName: string | null;
}

export interface HelperTeam {
  teamId: number;
  teamName: string;
  /** Coach of the team or admin: manage, sign up others. */
  canManage: boolean;
  /** All roles one can sign up with for any duty. */
  roles: HelperRole[];
  /** Own team (coach, player or parent), regardless of admin rights. */
  own: boolean;
  /** Internal: basis for rolesFor */
  parentsEnabled: boolean;
  isPlayer: boolean;
  isCoach: boolean;
  /** Full club member (for “who helps: members”) */
  isMember: boolean;
  childRoles: HelperRole[];
}

/**
 * With which roles may one sign up for a duty type in this team?
 * - Parents: for their child if the team involves parents; otherwise the players themselves
 * - Players: themselves
 * - Coaches: themselves
 * Coaches and admins of the team may always sign up themselves (as before).
 * KiHaSL/JuHaSL goes through refereeRoles.
 */
export function rolesFor(team: HelperTeam, type: DutyType): HelperRole[] {
  if (type.whoReferees) return [];
  const self =
    team.canManage ||
    (type.whoParents && !team.parentsEnabled && team.isPlayer) ||
    (type.whoPlayers && team.isPlayer) ||
    (type.whoCoaches && team.isCoach) ||
    (type.whoMembers && team.isMember && (team.isPlayer || team.isCoach || team.childRoles.length > 0));
  return [...(self ? [{ childId: null, childName: null }] : []), ...(type.whoParents && team.parentsEnabled ? team.childRoles : [])];
}

/**
 * Teams with a helper plan (or with upcoming special events with duties) where
 * the person can help or which they can manage.
 */
export async function helperTeams(db: D1Database, actor: Actor, types?: Map<number, DutyType>): Promise<HelperTeam[]> {
  if (!isModuleOn("duties")) return [];
  const [teams, typeMap, member, organized] = await Promise.all([
    all<{ id: number; name: string; parents_enabled: number }>(
      db,
      // Subquery without reference to t: evaluated once, via events (kind, starts_at)
      `SELECT t.id, t.name, t.parents_enabled FROM teams t
        WHERE t.helper_plan = 1
           OR t.id IN (SELECT et.team_id FROM events e JOIN event_teams et ON et.event_id = e.id
                        WHERE e.kind = 'special' AND e.starts_at >= date('now', '-1 day')
                          AND EXISTS (SELECT 1 FROM event_duties ed WHERE ed.event_id = e.id))
        ORDER BY t.name`,
    ),
    types ? Promise.resolve(types) : loadDutyTypes(db),
    isClubMember(db, actor.personId),
    // Teams of upcoming special events with time blocks that one created or co-organises
    all<{ team_id: number }>(
      db,
      `SELECT DISTINCT et.team_id FROM events e JOIN event_teams et ON et.event_id = e.id
        WHERE e.kind = 'special' AND e.starts_at >= date('now', '-1 day')
          AND EXISTS (SELECT 1 FROM event_duties ed WHERE ed.event_id = e.id)
          AND (e.created_by = ?1 OR EXISTS (SELECT 1 FROM event_organizers o WHERE o.event_id = e.id AND o.person_id = ?1))`,
      actor.personId,
    ),
  ]);
  const organizedTeams = new Set(organized.map((r) => r.team_id));
  const anyPlayers = [...typeMap.values()].some((t) => t.whoPlayers && !t.archived);
  const anyMembers = member && [...typeMap.values()].some((t) => t.whoMembers && !t.archived);
  const out: HelperTeam[] = [];
  for (const t of teams) {
    const canManage = isCoachOf(actor, t.id);
    const own = actor.memberships.find((m) => m.teamId === t.id);
    const isPlayer = !!own && (own.role === "player" || own.role === "helper");
    const isCoach = !!own && own.role === "coach";
    const childRoles: HelperRole[] = [];
    if (t.parents_enabled === 1) {
      for (const child of actor.children) {
        const ms = actor.childMemberships.get(child.id) ?? [];
        if (ms.some((m) => m.teamId === t.id && (m.role === "player" || m.role === "helper"))) childRoles.push({ childId: child.id, childName: child.firstName });
      }
    }
    const selfRole = canManage || isCoach || (isPlayer && (t.parents_enabled === 0 || anyPlayers)) || (anyMembers && (isPlayer || childRoles.length > 0));
    const roles = [...(selfRole ? [{ childId: null, childName: null }] : []), ...childRoles];
    if (!roles.length && !organizedTeams.has(t.id)) continue;
    out.push({
      teamId: t.id,
      teamName: t.name,
      canManage,
      roles,
      own: !!own || childRoles.length > 0 || organizedTeams.has(t.id),
      parentsEnabled: t.parents_enabled === 1,
      isPlayer,
      isCoach,
      isMember: member,
      childRoles,
    });
  }
  // Own teams first (for admins, who see all)
  return [...out.filter((t) => t.own), ...out.filter((t) => !t.own)];
}

/**
 * Players and coaches of a team (not a group) become full club members. Admins can switch the flag
 * off again afterwards; a new assignment sets it again.
 */
export function clubMemberStmt(db: D1Database, personIds: number[], teamId: number | null): D1PreparedStatement {
  return stmt(
    db,
    `INSERT OR IGNORE INTO club_members (person_id)
     SELECT value FROM json_each(?1) WHERE ?2 IS NULL OR EXISTS (SELECT 1 FROM teams WHERE id = ?2 AND kind = 'team')`,
    JSON.stringify(personIds),
    teamId,
  );
}

export async function isClubMember(db: D1Database, personId: number): Promise<boolean> {
  return !!(await first(db, "SELECT 1 AS ok FROM club_members WHERE person_id = ?", personId));
}

/** Creator and organisers per special event (they manage the helper duties). */
export async function dutyManagers(db: D1Database, eventIds: number[]): Promise<Map<number, Set<number>>> {
  const out = new Map<number, Set<number>>();
  if (!eventIds.length) return out;
  const ids = JSON.stringify(eventIds);
  const rows = await all<{ event_id: number; person_id: number }>(
    db,
    `SELECT id AS event_id, created_by AS person_id FROM events WHERE id IN (SELECT value FROM json_each(?1)) AND created_by IS NOT NULL
     UNION SELECT event_id, person_id FROM event_organizers WHERE event_id IN (SELECT value FROM json_each(?1))`,
    ids,
  );
  for (const r of rows) out.set(r.event_id, (out.get(r.event_id) ?? new Set()).add(r.person_id));
  return out;
}

/** Managing an event's helper duties: coaches of a team involved, admins, creator, organisers. */
export function mayManageDuties(actor: Actor, teamIds: number[], managers: Set<number> | undefined): boolean {
  return isCoachOfAny(actor, teamIds) || !!managers?.has(actor.personId);
}

/** For the response to the client, without internal fields. */
export function publicHelperTeam(t: HelperTeam) {
  return { teamId: t.teamId, teamName: t.teamName, canManage: t.canManage, roles: t.roles, own: t.own };
}

/**
 * For whom can the actor take KiHaSL/JuHaSL duties? Oneself and/or
 * children with the role. In the admin view “referee” oneself always counts.
 */
export async function refereeRoles(db: D1Database, actor: Actor): Promise<HelperRole[]> {
  if (!isModuleOn("youthReferees")) return [];
  const ids = [actor.personId, ...actor.children.map((c) => c.id)];
  const rows = await all<{ person_id: number }>(db, "SELECT person_id FROM referees WHERE person_id IN (SELECT value FROM json_each(?))", JSON.stringify(ids));
  const set = new Set(rows.map((r) => r.person_id));
  if (actor.refereeOverride) set.add(actor.personId);
  const roles: HelperRole[] = [];
  if (set.has(actor.personId)) roles.push({ childId: null, childName: null });
  for (const ch of actor.children) if (set.has(ch.id)) roles.push({ childId: ch.id, childName: ch.firstName });
  return roles;
}

/** Opponent from the club's point of view, for texts ("vs X", "at X"). */
export function opponentOf(e: { is_home: number | null; home_team: string | null; guest_team: string | null; title: string | null }): string {
  if (e.is_home === 1) {
    const opponent = e.guest_team ?? t`opponent`;
    return t`vs ${opponent}`;
  }
  if (e.is_home === 0) {
    const opponent = e.home_team ?? t`opponent`;
    return t`at ${opponent}`;
  }
  return e.title ?? `${e.home_team ?? "?"} – ${e.guest_team ?? "?"}`;
}

export { SHORT_NAME_SQL } from "../lib/db";

/** Duty types needing skills that the account has enabled in the profile (“I can do this”). */
export async function skillConsents(db: D1Database, accountId: number): Promise<Set<number>> {
  const rows = await all<{ duty_type_id: number }>(db, "SELECT duty_type_id FROM skill_consents WHERE account_id = ?", accountId);
  return new Set(rows.map((r) => r.duty_type_id));
}

export function mayTake(type: DutyType, consents: Set<number>): boolean {
  return !type.needsSkill || consents.has(type.id);
}

// Time blocks --------------------------------------------------------------------

export interface TemplateItem {
  dutyTypeId: number;
  slots: number;
  beforeMin: number;
  afterMin: number;
  taskWhen: "before" | "after";
}

/** Block from a template line for an event from start to end. */
export function blockFromItem(item: TemplateItem, mode: DutyType["mode"], start: string, end: string): { startsAt: string; endsAt: string } {
  if (mode === "task") {
    const at = item.taskWhen === "before" ? start : end;
    return { startsAt: at, endsAt: at };
  }
  return { startsAt: addMinutesLocal(start, -item.beforeMin), endsAt: addMinutesLocal(end, item.afterMin) };
}

export async function templateItems(db: D1Database, templateId: number): Promise<TemplateItem[]> {
  const rows = await all<{ duty_type_id: number; slots: number; before_min: number; after_min: number; task_when: "before" | "after" }>(
    db,
    "SELECT duty_type_id, slots, before_min, after_min, task_when FROM duty_template_items WHERE template_id = ? ORDER BY sort, id",
    templateId,
  );
  return rows.map((r) => ({ dutyTypeId: r.duty_type_id, slots: r.slots, beforeMin: r.before_min, afterMin: r.after_min, taskWhen: r.task_when }));
}

/** End of a game: throw-off plus the playing time of the age class. */
export function gameEnd(startsAt: string, gameMinutes: number): string {
  return addMinutesLocal(startsAt, gameMinutes);
}

function minutesBetween(from: string, to: string): number {
  return Math.round((localToInstant(to) - localToInstant(from)) / 60_000);
}

/**
 * Keep the time blocks of games up to date (lazily, on every read):
 * - games of teams with a helper plan get the blocks of their template once,
 * - youth home games F–C get the KiHaSL/JuHaSL block once,
 * - if the throw-off time changed, all blocks move by the same amount.
 * Without eventIds: all games from today minus 90 days.
 */
export async function ensureEventDuties(db: D1Database, eventIds: number[] | null, from: string): Promise<void> {
  if ((eventIds && !eventIds.length) || !isModuleOn("duties")) return;
  const games = await all<{
    id: number;
    starts_at: string;
    is_home: number | null;
    duties_anchor: string | null;
    duties_generated: number;
    helper_plan: number;
    game_minutes: number;
    youth_referee: number;
    home_template_id: number | null;
    away_template_id: number | null;
  }>(
    db,
    // Two variants instead of “?2 IS NULL OR …”: only then does SQLite look up the IDs directly
    `SELECT e.id, e.starts_at, e.is_home, e.duties_anchor, e.duties_generated, t.helper_plan, COALESCE(ac.game_minutes, 120) AS game_minutes,
            COALESCE(ac.youth_referee, 0) AS youth_referee, t.home_template_id, t.away_template_id
       FROM events e
       JOIN teams t ON t.id = (SELECT et.team_id FROM event_teams et WHERE et.event_id = e.id ORDER BY et.team_id LIMIT 1)
       ${CURRENT_AGE_CLASS_JOIN("t", "ac")}
      WHERE e.kind = 'game' AND e.starts_at >= ?1
        ${eventIds ? "AND e.id IN (SELECT value FROM json_each(?2))" : ""}
        AND (
          (e.duties_anchor IS NOT NULL AND e.duties_anchor <> e.starts_at)
          OR (t.helper_plan = 1 AND (e.duties_generated & 1) = 0)
          OR (e.is_home = 1 AND ${REFEREE_TEAM_SQL("t")} AND (e.duties_generated & 2) = 0)
        )`,
    from,
    ...(eventIds ? [JSON.stringify(eventIds)] : []),
  );
  if (!games.length) return;
  const [types, defaults] = await Promise.all([
    loadDutyTypes(db),
    all<{ id: number; default_for: "home" | "away" }>(db, "SELECT id, default_for FROM duty_templates WHERE default_for IS NOT NULL"),
  ]);
  const referee = [...types.values()].find((t) => t.code === REFEREE_CODE);
  const itemsCache = new Map<number, TemplateItem[]>();
  const items = async (templateId: number) => {
    if (!itemsCache.has(templateId)) itemsCache.set(templateId, await templateItems(db, templateId));
    return itemsCache.get(templateId)!;
  };
  const statements: D1PreparedStatement[] = [];
  for (const g of games) {
    // Moved game: move the blocks along
    if (g.duties_anchor && g.duties_anchor !== g.starts_at) {
      const delta = minutesBetween(g.duties_anchor, g.starts_at);
      const blocks = await all<{ id: number; starts_at: string; ends_at: string }>(db, "SELECT id, starts_at, ends_at FROM event_duties WHERE event_id = ?", g.id);
      for (const b of blocks) {
        statements.push(stmt(db, "UPDATE event_duties SET starts_at = ?, ends_at = ? WHERE id = ?", addMinutesLocal(b.starts_at, delta), addMinutesLocal(b.ends_at, delta), b.id));
      }
    }
    let generated = g.duties_generated;
    const end = gameEnd(g.starts_at, g.game_minutes);
    if (g.helper_plan === 1 && (generated & 1) === 0) {
      const home = g.is_home !== 0;
      const templateId = (home ? g.home_template_id : g.away_template_id) ?? defaults.find((d) => d.default_for === (home ? "home" : "away"))?.id;
      for (const [i, item] of (templateId ? await items(templateId) : []).entries()) {
        const type = types.get(item.dutyTypeId);
        if (!type || type.archived || type.whoReferees) continue;
        const b = blockFromItem(item, type.mode, g.starts_at, end);
        statements.push(
          stmt(db, "INSERT INTO event_duties (event_id, duty_type_id, starts_at, ends_at, slots, sort) VALUES (?, ?, ?, ?, ?, ?)", g.id, type.id, b.startsAt, b.endsAt, item.slots, i + 1),
        );
      }
      generated |= 1;
    }
    if (g.is_home === 1 && g.youth_referee === 1 && (generated & 2) === 0 && referee && isModuleOn("youthReferees")) {
      statements.push(
        stmt(
          db,
          "INSERT INTO event_duties (event_id, duty_type_id, starts_at, ends_at, slots, sort) VALUES (?, ?, ?, ?, 1, 99)",
          g.id,
          referee.id,
          addMinutesLocal(g.starts_at, -REFEREE_BEFORE_MIN),
          end,
        ),
      );
      generated |= 2;
    }
    statements.push(stmt(db, "UPDATE events SET duties_anchor = starts_at, duties_generated = ? WHERE id = ?", generated, g.id));
  }
  // In chunks, D1 limits the size of a batch
  for (let i = 0; i < statements.length; i += 50) await db.batch(statements.slice(i, i + 50));
}

/**
 * New template of a team: upcoming games without entries get their blocks anew.
 * Blocks with entries and the KiHaSL/JuHaSL block stay.
 */
export async function resetTeamDuties(db: D1Database, teamId: number, now: string): Promise<void> {
  const games = await all<{ id: number }>(
    db,
    `SELECT e.id FROM events e JOIN event_teams et ON et.event_id = e.id AND et.team_id = ?
      WHERE e.kind = 'game' AND e.starts_at > ? AND NOT EXISTS (SELECT 1 FROM duties d WHERE d.event_id = e.id AND d.duty_type_id IN (SELECT id FROM duty_types WHERE who_referees = 0))`,
    teamId,
    now,
  );
  if (!games.length) return;
  const ids = JSON.stringify(games.map((g) => g.id));
  await db.batch([
    stmt(db, "DELETE FROM event_duties WHERE event_id IN (SELECT value FROM json_each(?)) AND duty_type_id IN (SELECT id FROM duty_types WHERE who_referees = 0)", ids),
    stmt(db, "UPDATE events SET duties_generated = duties_generated & 2 WHERE id IN (SELECT value FROM json_each(?))", ids),
  ]);
}

// Event overview -----------------------------------------------------------------

/**
 * Own duties and those for one's children per event, for the event overview.
 * Only events with a helper plan (games) or special events, none hidden or cancelled.
 */
export async function loadMyDuties(db: D1Database, actor: Actor, eventIds: number[]): Promise<Map<number, MyDuty[]>> {
  const out = new Map<number, MyDuty[]>();
  if (!eventIds.length || !isModuleOn("duties")) return out;
  const rows = await all<{ event_id: number; type_id: number; name: string; who_referees: number; person_id: number | null; child_name: string | null }>(
    db,
    `SELECT d.event_id, dt.id AS type_id, dt.name, dt.who_referees, d.person_id, ch.first_name AS child_name
       FROM duties d JOIN events e ON e.id = d.event_id JOIN duty_types dt ON dt.id = d.duty_type_id
       LEFT JOIN persons ch ON ch.id = d.child_id
      WHERE (d.person_id = ? OR d.child_id IN (SELECT value FROM json_each(?)))
        -- “+”: search via one's own duties, not via all duties of the listed events
        AND +d.event_id IN (SELECT value FROM json_each(?))
        AND e.cancelled_at IS NULL
        AND (dt.who_referees = 1 OR e.kind = 'special'
             OR (e.duty_hidden = 0 AND EXISTS (SELECT 1 FROM event_teams et JOIN teams t ON t.id = et.team_id WHERE et.event_id = e.id AND t.helper_plan = 1)))
      ORDER BY d.event_id, d.id`,
    actor.personId,
    JSON.stringify(actor.children.map((c) => c.id)),
    JSON.stringify(eventIds),
  );
  for (const r of rows) {
    const mine = r.person_id === actor.personId;
    const list = out.get(r.event_id) ?? [];
    // The same duty only once (e.g. own entry and one by the other parent)
    if (!list.some((x) => x.dutyTypeId === r.type_id && x.mine === mine)) {
      list.push({ dutyTypeId: r.type_id, referee: r.who_referees === 1, label: r.name, child: mine ? null : r.child_name, mine });
    }
    out.set(r.event_id, list);
  }
  return out;
}

/**
 * Free places per event that the actor could take as a helping parent (or as a player).
 * Same rules as “helpers wanted” in worker/domain/duty-notify.ts: who helps per duty type,
 * skills only with consent. Coaches and admins only count through their own children
 * or as players.
 */
export async function loadHelpersNeeded(db: D1Database, actor: Actor, eventIds: number[], now: string): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  if (!eventIds.length || !isModuleOn("duties")) return out;
  const types = await loadDutyTypes(db, eventIds);
  const teams = (await helperTeams(db, actor, types)).filter((t) => t.childRoles.length > 0 || t.isPlayer || (t.isCoach && !t.canManage));
  if (!teams.length) return out;
  await ensureEventDuties(db, eventIds, now.slice(0, 10));
  const [blocks, consents] = await Promise.all([
    all<{ id: number; event_id: number; duty_type_id: number; slots: number; taken: number; team_id: number }>(
      db,
      `SELECT ed.id, ed.event_id, ed.duty_type_id, ed.slots, (SELECT count(*) FROM duties d WHERE d.event_duty_id = ed.id) AS taken,
              (SELECT et.team_id FROM event_teams et WHERE et.event_id = e.id AND et.team_id IN (SELECT value FROM json_each(?3)) ORDER BY et.team_id LIMIT 1) AS team_id
         FROM event_duties ed JOIN events e ON e.id = ed.event_id
        WHERE ed.event_id IN (SELECT value FROM json_each(?1)) AND e.starts_at > ?2
          AND e.cancelled_at IS NULL AND (e.kind = 'special' OR e.duty_hidden = 0)
          AND EXISTS (SELECT 1 FROM event_teams et WHERE et.event_id = e.id AND et.team_id IN (SELECT value FROM json_each(?3)))
          AND NOT EXISTS (SELECT 1 FROM duties d WHERE d.event_id = e.id AND d.person_id = ?4)`,
      JSON.stringify(eventIds),
      now,
      JSON.stringify(teams.map((t) => t.teamId)),
      actor.personId,
    ),
    skillConsents(db, actor.accountId),
  ]);
  for (const b of blocks) {
    const type = types.get(b.duty_type_id);
    const team = teams.find((t) => t.teamId === b.team_id);
    if (!type || !team || !mayTake(type, consents)) continue;
    // Coaches/admins only count with their own roles (child, player), not as managers
    const roles = rolesFor({ ...team, canManage: false }, type);
    if (!roles.length) continue;
    const free = Math.max(0, b.slots - b.taken);
    if (free > 0) out.set(b.event_id, (out.get(b.event_id) ?? 0) + free);
  }
  return out;
}

/** Block with event and team, for signing up and managing. */
export interface BlockRow {
  id: number;
  event_id: number;
  duty_type_id: number;
  starts_at: string;
  ends_at: string;
  slots: number;
  event_starts_at: string;
  event_kind: "game" | "special" | "training";
  cancelled_at: string | null;
  duty_hidden: number;
  team_ids: string;
}

export async function loadBlock(db: D1Database, id: number): Promise<(BlockRow & { teamIds: number[] }) | null> {
  const row = await first<BlockRow>(
    db,
    `SELECT ed.id, ed.event_id, ed.duty_type_id, ed.starts_at, ed.ends_at, ed.slots, e.starts_at AS event_starts_at, e.kind AS event_kind,
            e.cancelled_at, e.duty_hidden, (SELECT json_group_array(team_id) FROM (SELECT et.team_id FROM event_teams et WHERE et.event_id = e.id ORDER BY et.team_id)) AS team_ids
       FROM event_duties ed JOIN events e ON e.id = ed.event_id WHERE ed.id = ?`,
    id,
  );
  return row ? { ...row, teamIds: JSON.parse(row.team_ids) as number[] } : null;
}
