// Helper plan: duty types, templates and time blocks per event. A duty type defines
// who helps (parents, players, coaches, members, or the people with its qualification) and whether it is an
// on-site duty or a task. Games get their blocks from the team's template and the duties of their age group,
// special events by hand. See docs/dev/design.md, Helper duties and Qualifications.
import { t } from "@lingui/core/macro";
import type { Actor } from "../auth/actor";
import { isCoachOf, isCoachOfAny } from "../auth/actor";
import type { MyDuty } from "../../shared/types";
import { badRequest, forbidden, notFound } from "../lib/http";
import { all, first, list, stmt } from "../lib/db";
import { cached, cacheVersions } from "../lib/cache";
import { addMinutesLocal, localToInstant, todayLocal } from "../lib/time";
import { CURRENT_AGE_CLASS_JOIN } from "./events";
import { isModuleOn } from "./club";

/** Code of the youth referee duty type of the handball profile (a qualification approved by admins). */
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
  /**
   * Taken by the people with this type's qualification, from every team (column who_referees): e.g. youth
   * referees for the home games of all youth teams. Only with skillGrant "admin".
   */
  whoQualified: boolean;
  noteAllowed: boolean;
  /** Needs prior knowledge: a qualification the person switches on in the profile or an admin approves. */
  needsSkill: boolean;
  /** Who approves the prior knowledge: the person in the profile ("I can do this") or an admin. */
  skillGrant: "self" | "admin";
  /** Assigned by the coach: nobody signs up themselves, managers assign people who fit "who helps". */
  assignOnly: boolean;
  /** Send "helpers wanted" three days before. */
  notifyOpen: boolean;
  /** Adults only: whoever is under 18 by birth year does not take the duty (no birth year counts as adult). */
  adultsOnly: boolean;
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
  skill_grant: "self" | "admin";
  assign_only: number;
  notify_open: number;
  adults_only: number;
  event_id: number | null;
  archived: number;
  sort: number;
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
    whoQualified: r.who_referees === 1,
    noteAllowed: r.note_allowed === 1,
    // Admin approval always means prior knowledge (the youth referee type has needs_skill = 0 for the previous release)
    needsSkill: r.needs_skill === 1 || r.skill_grant === "admin",
    skillGrant: r.skill_grant === "admin" ? "admin" : "self",
    // Missing before the migration 202611200200 (restore of an older export): as before
    assignOnly: r.assign_only === 1,
    notifyOpen: r.notify_open !== 0,
    adultsOnly: r.adults_only === 1,
    eventId: r.event_id,
    archived: r.archived === 1,
  };
}

/** Club-wide duty types (without special duties) and optionally the special duties of the given events. */
export async function loadDutyTypes(db: D1Database, eventIds: number[] = []): Promise<Map<number, DutyType>> {
  // Club-wide duty types rarely change: from the cache (worker/lib/cache.ts); special duties of single events fresh
  const [global, special] = await Promise.all([
    cached(db, "ref", "duty-types", () => all<DutyTypeRow>(db, "SELECT * FROM duty_types WHERE event_id IS NULL ORDER BY sort, id")),
    eventIds.length
      ? all<DutyTypeRow>(db, "SELECT * FROM duty_types WHERE event_id IN (SELECT value FROM json_each(?)) ORDER BY sort, id", JSON.stringify(eventIds))
      : Promise.resolve([] as DutyTypeRow[]),
  ]);
  const rows = special.length ? [...global, ...special].sort((a, b) => a.sort - b.sort || a.id - b.id) : global;
  return new Map(rows.map((r) => [r.id, toDutyType(r)]));
}

/** All duty types including all special duties (for the cron job). */
export async function loadAllDutyTypes(db: D1Database): Promise<Map<number, DutyType>> {
  const rows = await all<DutyTypeRow>(db, "SELECT * FROM duty_types ORDER BY sort, id");
  return new Map(rows.map((r) => [r.id, toDutyType(r)]));
}

// "Helpers from": on the template line and the time block, not on the duty type ---------------------------------

/** default: "who helps" of the duty type; teams: players of these teams; rotate: one team of the list in turn. */
export type HelperMode = "default" | "teams" | "rotate";

export interface HelperSource {
  mode: HelperMode;
  /** Teams (for rotate in the order of the rotation) */
  pool: number[];
  /** rotate: the team in charge this time */
  rotateTeamId: number | null;
}

/** Columns of a block (alias ed) for helperSource. */
export const HELPER_COLUMNS = "ed.helper_mode, ed.helper_teams, ed.rotate_team_id";

export interface HelperColumns {
  helper_mode: HelperMode;
  helper_teams: string | null;
  rotate_team_id?: number | null;
}

export function parsePool(json: string | null | undefined): number[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json) as unknown;
    return Array.isArray(v) ? v.filter((x): x is number => Number.isInteger(x)) : [];
  } catch {
    return [];
  }
}

export function helperSource(r: HelperColumns): HelperSource {
  return { mode: r.helper_mode ?? "default", pool: parsePool(r.helper_teams), rotateTeamId: r.rotate_team_id ?? null };
}

/** Teams whose players sign up for this block (empty: "who helps" of the duty type). */
export function helperTeamsOf(s: HelperSource): number[] {
  if (s.mode === "teams") return s.pool;
  if (s.mode === "rotate") return s.rotateTeamId != null ? [s.rotateTeamId] : [];
  return [];
}

/**
 * Home games of an age group with required duties (age_class_duties, e.g. a youth referee for the youngest
 * classes) get them regardless of the team's helper plan. SQL condition (alias of the team).
 */
export const REQUIRED_DUTIES_SQL = (t: string) =>
  `EXISTS (SELECT 1 FROM age_classes rac JOIN age_class_duties acd ON acd.age_class_id = rac.id
            WHERE rac.code = ${t}.age_class_code AND rac.season_id = (SELECT id FROM seasons WHERE is_current = 1))`;

/** Time span of a required duty's block: from 15 minutes before throw-off until the end of the game. */
const REQUIRED_BEFORE_MIN = 15;

/** As whom one can sign up: oneself or as a parent for a child. */
export interface HelperRole {
  childId: number | null;
  childName: string | null;
  /** The child does the duty itself (helpers from other teams); otherwise the parent does it for the child. */
  doer?: boolean;
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
  /** Club event: "parents" includes oneself (player of a team without parents); otherwise from parentsEnabled. */
  parentsSelf?: boolean;
}

/** Key of the club list in the Helpers tab and its live channel (team ids are > 0, lists of approved people < 0). */
export const CLUB_KEY = 0;

/**
 * Club events (the whole club, no team): "who helps" applies across all teams, no groups. Parents: for children in
 * teams with parents; players of a team without parents count as "parents" themselves, as at team events. Managing:
 * admins (organisers per event through mayManageDuties).
 */
export async function clubHelperTeam(db: D1Database, actor: Actor): Promise<HelperTeam> {
  const ms = [...actor.memberships, ...[...actor.childMemberships.values()].flat()];
  const ids = [...new Set(ms.map((m) => m.teamId))];
  const [kinds, member] = await Promise.all([
    ids.length ? all<{ id: number; kind: string }>(db, "SELECT id, kind FROM teams WHERE id IN (SELECT value FROM json_each(?))", list(ids)) : Promise.resolve([]),
    isClubMember(db, actor.personId),
  ]);
  const teamIds = new Set(kinds.filter((k) => k.kind === "team").map((k) => k.id));
  const own = actor.memberships.filter((m) => teamIds.has(m.teamId));
  const playing = (m: { role: string }) => m.role === "player" || m.role === "helper";
  const childRoles: HelperRole[] = actor.children
    .filter((ch) => (actor.childMemberships.get(ch.id) ?? []).some((m) => teamIds.has(m.teamId) && playing(m) && m.parentsEnabled))
    .map((ch) => ({ childId: ch.id, childName: ch.firstName }));
  return {
    teamId: CLUB_KEY,
    teamName: t`Whole club`,
    canManage: actor.isAdmin,
    roles: [],
    own: true,
    parentsEnabled: true,
    isPlayer: own.some(playing),
    isCoach: own.some((m) => m.role === "coach"),
    isMember: member,
    childRoles,
    parentsSelf: own.some((m) => playing(m) && !m.parentsEnabled),
  };
}

/**
 * With which roles may one sign up for a duty type in this team?
 * - Parents: for their child if the team involves parents; otherwise the players themselves
 * - Players: themselves
 * - Coaches: themselves
 * Coaches and admins of the team may always sign up themselves (as before).
 * Types taken by qualified people from all teams go through qualifiedRoles; the qualification itself is
 * checked with mayTake.
 */
export function rolesFor(team: HelperTeam, type: DutyType): HelperRole[] {
  if (type.whoQualified) return [];
  // Assigned by the coach: only managers sign up themselves (for themselves, as for someone else)
  if (type.assignOnly) return team.canManage ? [{ childId: null, childName: null }] : [];
  const self =
    team.canManage ||
    (type.whoParents && (team.parentsSelf ?? (!team.parentsEnabled && team.isPlayer))) ||
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
 * What the actor and their children may take: the qualifications switched on in the profile (per account) and
 * those approved by an admin (per person, also for children without an account).
 */
export interface Skills {
  consents: Set<number>;
  /** person id → duty type ids approved by an admin */
  grants: Map<number, Set<number>>;
}

export async function loadSkills(db: D1Database, actor: Actor): Promise<Skills> {
  const ids = [actor.personId, ...actor.children.map((c) => c.id)];
  const [consents, grants] = await Promise.all([
    all<{ duty_type_id: number }>(db, "SELECT duty_type_id FROM skill_consents WHERE account_id = ?", actor.accountId),
    all<{ person_id: number; duty_type_id: number }>(db, "SELECT person_id, duty_type_id FROM skill_grants WHERE person_id IN (SELECT value FROM json_each(?))", JSON.stringify(ids)),
  ]);
  const byPerson = new Map<number, Set<number>>();
  for (const g of grants) byPerson.set(g.person_id, (byPerson.get(g.person_id) ?? new Set()).add(g.duty_type_id));
  // Admin view "qualified helper": oneself counts as approved for every qualification taken from all teams
  if (actor.refereeOverride) {
    const all_ = await all<{ id: number }>(db, "SELECT id FROM duty_types WHERE who_referees = 1 AND event_id IS NULL");
    byPerson.set(actor.personId, new Set([...(byPerson.get(actor.personId) ?? []), ...all_.map((r) => r.id)]));
  }
  return { consents: new Set(consents.map((r) => r.duty_type_id)), grants: byPerson };
}

/** Has the person (oneself or a child) the type's admin approval? */
export function hasGrant(skills: Skills, personId: number, typeId: number): boolean {
  return !!skills.grants.get(personId)?.has(typeId);
}

/**
 * For whom can the actor take a duty of a type taken by qualified people from all teams? Oneself and/or
 * children with the type's approval.
 */
export function qualifiedRoles(actor: Actor, skills: Skills, typeId: number): HelperRole[] {
  const roles: HelperRole[] = [];
  if (hasGrant(skills, actor.personId, typeId)) roles.push({ childId: null, childName: null });
  for (const ch of actor.children) if (hasGrant(skills, ch.id, typeId)) roles.push({ childId: ch.id, childName: ch.firstName });
  return roles;
}

/**
 * Lists of qualified helpers the actor sees in the Helpers tab: the types taken from all teams for which they
 * or a child are approved; coaches and admins see all of them (to sign people up).
 */
export async function qualifiedLists(db: D1Database, actor: Actor): Promise<{ id: number; name: string; mine: boolean }[]> {
  if (!isModuleOn("duties")) return [];
  const [types, skills] = await Promise.all([
    all<{ id: number; name: string }>(db, "SELECT id, name FROM duty_types WHERE who_referees = 1 AND event_id IS NULL AND archived = 0 ORDER BY sort, id"),
    loadSkills(db, actor),
  ]);
  const manager = actor.isAdmin || actor.coachTeamIds.length > 0;
  return types
    .map((ty) => ({ id: ty.id, name: ty.name, mine: qualifiedRoles(actor, skills, ty.id).length > 0 }))
    .filter((ty) => ty.mine || manager);
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

/**
 * May the person (the actor or a child, who will do the duty) take a duty of this type? Self-approved prior
 * knowledge is the account's consent in the profile; admin-approved prior knowledge needs the person's approval,
 * so earlier self-consents no longer count once a type is switched to "admin".
 */
export function mayTake(type: DutyType, skills: Skills, personId: number): boolean {
  if (!type.needsSkill) return true;
  if (type.skillGrant === "admin") return hasGrant(skills, personId, type.id);
  return skills.consents.has(type.id);
}

// Time blocks --------------------------------------------------------------------

export interface TemplateItem {
  dutyTypeId: number;
  slots: number;
  beforeMin: number;
  afterMin: number;
  taskWhen: "before" | "after";
  helperMode: HelperMode;
  helperTeams: number[];
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
  const rows = await all<{ duty_type_id: number; slots: number; before_min: number; after_min: number; task_when: "before" | "after" } & HelperColumns>(
    db,
    "SELECT duty_type_id, slots, before_min, after_min, task_when, helper_mode, helper_teams FROM duty_template_items WHERE template_id = ? ORDER BY sort, id",
    templateId,
  );
  return rows.map((r) => ({
    dutyTypeId: r.duty_type_id,
    slots: r.slots,
    beforeMin: r.before_min,
    afterMin: r.after_min,
    taskWhen: r.task_when,
    helperMode: r.helper_mode ?? "default",
    helperTeams: parsePool(r.helper_teams),
  }));
}

/**
 * Rotation: the team after the one in charge of the last block of this duty type with the same list. last: the state
 * while generating many blocks in one go (key duty type and list), so the games take their turns in start order.
 */
export async function nextRotationTeam(db: D1Database, typeId: number, pool: number[], last?: Map<string, number | null>): Promise<number | null> {
  if (!pool.length) return null;
  const key = `${typeId}:${JSON.stringify(pool)}`;
  let prev: number | null | undefined = last?.get(key);
  if (prev === undefined) {
    prev =
      (
        await first<{ rotate_team_id: number | null }>(
          db,
          // helper_mode <> 'default' as well: only then the partial index event_duties_helper_from applies
          `SELECT ed.rotate_team_id FROM event_duties ed JOIN events e ON e.id = ed.event_id
            WHERE ed.duty_type_id = ?1 AND ed.helper_mode <> 'default' AND ed.helper_mode = 'rotate' AND ed.helper_teams = ?2
              AND ed.rotate_team_id IS NOT NULL
            ORDER BY e.starts_at DESC, ed.id DESC LIMIT 1`,
          typeId,
          JSON.stringify(pool),
        )
      )?.rotate_team_id ?? null;
  }
  const i = prev != null ? pool.indexOf(prev) : -1;
  const next = pool[(i + 1) % pool.length]!;
  last?.set(key, next);
  return next;
}

/** Columns and values of a new block from a template line (helpers from, rotation). */
export async function itemSource(db: D1Database, item: TemplateItem, rotation?: Map<string, number | null>) {
  return {
    mode: item.helperMode,
    teams: item.helperMode === "default" ? null : JSON.stringify(item.helperTeams),
    rotateTeamId: item.helperMode === "rotate" ? await nextRotationTeam(db, item.dutyTypeId, item.helperTeams, rotation) : null,
  };
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
 * - home games of age groups with required duties (e.g. a youth referee) get those blocks once,
 * - if the throw-off time changed, all blocks move by the same amount.
 * Without eventIds: all games from today minus 90 days.
 */
/**
 * Games for which there was nothing to generate last time, per version "duties" (triggers on games, teams of events,
 * templates, required duties, age groups, seasons, duty types): as long as none of that changes it stays so, and the
 * query is skipped. Keyed by the start of the time span; an earlier start covers a later one.
 */
const dutiesClean = { version: -1, byFrom: new Map<string, { all: boolean; ids: Set<number> }>() };

function dutiesKnownClean(version: number, eventIds: number[] | null, from: string): boolean {
  if (version < 0 || dutiesClean.version !== version) return false;
  for (const [f, c] of dutiesClean.byFrom) {
    if (f > from) continue;
    if (c.all || (eventIds && eventIds.every((id) => c.ids.has(id)))) return true;
  }
  return false;
}

function markDutiesClean(version: number, eventIds: number[] | null, from: string) {
  if (version < 0) return;
  if (dutiesClean.version !== version) {
    dutiesClean.version = version;
    dutiesClean.byFrom.clear();
  }
  const c = dutiesClean.byFrom.get(from) ?? { all: false, ids: new Set<number>() };
  if (eventIds) for (const id of eventIds) c.ids.add(id);
  else c.all = true;
  dutiesClean.byFrom.set(from, c);
}

export async function ensureEventDuties(db: D1Database, eventIds: number[] | null, from: string): Promise<void> {
  if ((eventIds && !eventIds.length) || !isModuleOn("duties")) return;
  const { duties: version } = await cacheVersions(db);
  if (dutiesKnownClean(version, eventIds, from)) return;
  const games = await all<{
    id: number;
    starts_at: string;
    is_home: number | null;
    duties_anchor: string | null;
    duties_generated: number;
    helper_plan: number;
    game_minutes: number;
    age_class_id: number | null;
    home_template_id: number | null;
    away_template_id: number | null;
  }>(
    db,
    // Two variants instead of “?2 IS NULL OR …”: only then does SQLite look up the IDs directly
    `SELECT e.id, e.starts_at, e.is_home, e.duties_anchor, e.duties_generated, t.helper_plan, COALESCE(ac.game_minutes, 120) AS game_minutes,
            ac.id AS age_class_id, t.home_template_id, t.away_template_id
       FROM events e
       JOIN teams t ON t.id = (SELECT et.team_id FROM event_teams et WHERE et.event_id = e.id ORDER BY et.team_id LIMIT 1)
       ${CURRENT_AGE_CLASS_JOIN("t", "ac")}
      WHERE e.kind = 'game' AND e.starts_at >= ?1
        ${eventIds ? "AND e.id IN (SELECT value FROM json_each(?2))" : ""}
        AND (
          (e.duties_anchor IS NOT NULL AND e.duties_anchor <> e.starts_at)
          OR (t.helper_plan = 1 AND (e.duties_generated & 1) = 0)
          OR (e.is_home = 1 AND ${REQUIRED_DUTIES_SQL("t")} AND (e.duties_generated & 2) = 0)
        )
      -- Rotation: the games take their turns in start order
      ORDER BY e.starts_at, e.id`,
    from,
    ...(eventIds ? [JSON.stringify(eventIds)] : []),
  );
  if (!games.length) {
    markDutiesClean(version, eventIds, from);
    return;
  }
  const classIds = [...new Set(games.filter((g) => g.is_home === 1 && g.age_class_id != null).map((g) => g.age_class_id!))];
  const [types, defaults, required] = await Promise.all([
    loadDutyTypes(db),
    all<{ id: number; default_for: "home" | "away" }>(db, "SELECT id, default_for FROM duty_templates WHERE default_for IS NOT NULL"),
    classIds.length
      ? all<{ age_class_id: number; duty_type_id: number }>(
          db,
          "SELECT age_class_id, duty_type_id FROM age_class_duties WHERE age_class_id IN (SELECT value FROM json_each(?)) ORDER BY duty_type_id",
          JSON.stringify(classIds),
        )
      : Promise.resolve([]),
  ]);
  const itemsCache = new Map<number, TemplateItem[]>();
  const items = async (templateId: number) => {
    if (!itemsCache.has(templateId)) itemsCache.set(templateId, await templateItems(db, templateId));
    return itemsCache.get(templateId)!;
  };
  const statements: D1PreparedStatement[] = [];
  const rotation = new Map<string, number | null>();
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
        if (!type || type.archived || type.whoQualified) continue;
        const b = blockFromItem(item, type.mode, g.starts_at, end);
        const src = await itemSource(db, item, rotation);
        statements.push(
          stmt(
            db,
            "INSERT INTO event_duties (event_id, duty_type_id, starts_at, ends_at, slots, sort, helper_mode, helper_teams, rotate_team_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            g.id,
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
      generated |= 1;
    }
    const requiredTypes = required.filter((r) => r.age_class_id === g.age_class_id).map((r) => types.get(r.duty_type_id)).filter((ty) => ty && !ty.archived);
    if (g.is_home === 1 && requiredTypes.length && (generated & 2) === 0) {
      for (const [i, type] of requiredTypes.entries()) {
        statements.push(
          stmt(
            db,
            "INSERT INTO event_duties (event_id, duty_type_id, starts_at, ends_at, slots, sort) VALUES (?, ?, ?, ?, 1, ?)",
            g.id,
            type!.id,
            addMinutesLocal(g.starts_at, -REQUIRED_BEFORE_MIN),
            end,
            99 + i,
          ),
        );
      }
      generated |= 2;
    }
    statements.push(stmt(db, "UPDATE events SET duties_anchor = starts_at, duties_generated = ? WHERE id = ?", generated, g.id));
  }
  // In chunks, D1 limits the size of a batch
  for (let i = 0; i < statements.length; i += 50) await db.batch(statements.slice(i, i + 50));
}

/**
 * New template of a team: upcoming games without entries get their blocks anew.
 * Blocks with entries and the youth referee block stay.
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
 * Same rules as “helpers wanted” in modules/duties/worker/notify.ts: who helps per duty type,
 * skills only with consent. Coaches and admins only count through their own children
 * or as players.
 */
export async function loadHelpersNeeded(db: D1Database, actor: Actor, eventIds: number[], now: string): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  if (!eventIds.length || !isModuleOn("duties")) return out;
  const types = await loadDutyTypes(db, eventIds);
  const teams = (await helperTeams(db, actor, types)).filter((t) => t.childRoles.length > 0 || t.isPlayer || (t.isCoach && !t.canManage));
  if (!teams.length) {
    await clubHelpersNeeded(db, actor, eventIds, now, types, out);
    return out;
  }
  await ensureEventDuties(db, eventIds, now.slice(0, 10));
  const [blocks, skills] = await Promise.all([
    all<{ id: number; event_id: number; duty_type_id: number; slots: number; taken: number; team_id: number } & HelperColumns>(
      db,
      `SELECT ed.id, ed.event_id, ed.duty_type_id, ed.slots, ${HELPER_COLUMNS}, (SELECT count(*) FROM duties d WHERE d.event_duty_id = ed.id) AS taken,
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
    loadSkills(db, actor),
  ]);
  for (const b of blocks) {
    const type = types.get(b.duty_type_id);
    const team = teams.find((t) => t.teamId === b.team_id);
    // In a team the one signing up does the duty (types taken from all teams have no team roles)
    if (!type || !team || !mayTake(type, skills, actor.personId)) continue;
    // Coaches/admins only count with their own roles (child, player), not as managers
    const roles = blockRoles(actor, [{ ...team, canManage: false }], type, helperSource(b));
    if (!roles.length) continue;
    const free = Math.max(0, b.slots - b.taken);
    if (free > 0) out.set(b.event_id, (out.get(b.event_id) ?? 0) + free);
  }
  await clubHelpersNeeded(db, actor, eventIds, now, types, out);
  return out;
}

/** Club events: free places one could take by "who helps" (across all teams) or a block's teams. */
async function clubHelpersNeeded(db: D1Database, actor: Actor, eventIds: number[], now: string, types: Map<number, DutyType>, out: Map<number, number>): Promise<void> {
  const blocks = await all<{ event_id: number; duty_type_id: number; free: number } & HelperColumns>(
    db,
    `SELECT ed.event_id, ed.duty_type_id, ${HELPER_COLUMNS}, ed.slots - (SELECT count(*) FROM duties d WHERE d.event_duty_id = ed.id) AS free
       FROM event_duties ed
      -- Only the club events among the listed ones: their blocks, not those of all listed events
      WHERE ed.event_id IN (SELECT e.id FROM events e WHERE e.id IN (SELECT value FROM json_each(?1)) AND e.club_wide = 1 AND e.starts_at > ?2 AND e.cancelled_at IS NULL)
        AND NOT EXISTS (SELECT 1 FROM duties d WHERE d.event_id = ed.event_id AND d.person_id = ?3)`,
    JSON.stringify(eventIds),
    now,
    actor.personId,
  );
  if (!blocks.length) return;
  const [club, skills] = await Promise.all([clubHelperTeam(db, actor), loadSkills(db, actor)]);
  for (const b of blocks) {
    const type = types.get(b.duty_type_id);
    if (!type || b.free <= 0 || !mayTake(type, skills, actor.personId)) continue;
    if (blockRoles(actor, [{ ...club, canManage: false }], type, helperSource(b)).length) out.set(b.event_id, (out.get(b.event_id) ?? 0) + b.free);
  }
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
  club_wide: number;
  team_ids: string;
  helper_mode: HelperMode;
  helper_teams: string | null;
  rotate_team_id: number | null;
}

export async function loadBlock(db: D1Database, id: number): Promise<(BlockRow & { teamIds: number[] }) | null> {
  const row = await first<BlockRow>(
    db,
    `SELECT ed.id, ed.event_id, ed.duty_type_id, ed.starts_at, ed.ends_at, ed.slots, ${HELPER_COLUMNS}, e.starts_at AS event_starts_at, e.kind AS event_kind,
            e.cancelled_at, e.duty_hidden, e.club_wide, (SELECT json_group_array(team_id) FROM (SELECT et.team_id FROM event_teams et WHERE et.event_id = e.id ORDER BY et.team_id)) AS team_ids
       FROM event_duties ed JOIN events e ON e.id = ed.event_id WHERE ed.id = ?`,
    id,
  );
  return row ? { ...row, teamIds: JSON.parse(row.team_ids) as number[] } : null;
}

/** An event whose helper duties the actor may manage (coaches of its teams, admins and organisers); else 404/403. */
export async function managedEvent(db: D1Database, actor: Actor, eventId: number) {
  const e = await first<{ id: number; kind: string; starts_at: string; ends_at: string | null; club_wide: number; team_ids: string }>(
    db,
    `SELECT e.id, e.kind, e.starts_at, e.ends_at, e.club_wide,
            (SELECT json_group_array(team_id) FROM (SELECT et.team_id FROM event_teams et WHERE et.event_id = e.id ORDER BY et.team_id)) AS team_ids
       FROM events e WHERE e.id = ?`,
    eventId,
  );
  if (!e || (e.kind !== "game" && e.kind !== "special")) throw notFound(t`This event does not exist.`);
  const teamIds = JSON.parse(e.team_ids) as number[];
  // Club events have no team: admins and the organisers manage them
  if (!teamIds.length && e.club_wide !== 1) throw badRequest(t`Helpers only exist for events of teams.`);
  if (!mayManageDuties(actor, teamIds, (await dutyManagers(db, [e.id])).get(e.id))) throw forbidden(t`Only coaches of this team and the organisers of the event can do this.`);
  return { ...e, teamIds };
}

/**
 * Helpers tab, list "Help out": does "helpers from" of a template line or an upcoming block name a team in which
 * oneself or a child (parents involved) plays? For taking turns the whole list counts, so one sees when it is one's turn.
 */
export async function canHelpOut(db: D1Database, actor: Actor): Promise<boolean> {
  if (!isModuleOn("duties")) return false;
  const own = actor.memberships.filter((m) => m.role === "player").map((m) => m.teamId);
  const kids = [...actor.childMemberships.values()].flat().filter((m) => m.role === "player" && m.parentsEnabled).map((m) => m.teamId);
  const teams = [...new Set([...own, ...kids])];
  if (!teams.length) return false;
  const rows = await all<{ duty_type_id: number; helper_teams: string | null }>(
    db,
    // helper_mode <> 'default': few template lines; blocks through the partial index event_duties_helper_from
    `SELECT DISTINCT i.duty_type_id, i.helper_teams FROM duty_template_items i
      WHERE i.helper_mode <> 'default' AND EXISTS (SELECT 1 FROM json_each(i.helper_teams) h WHERE h.value IN (SELECT value FROM json_each(?1)))
     UNION
     SELECT DISTINCT ed.duty_type_id, ed.helper_teams FROM event_duties ed JOIN events e ON e.id = ed.event_id
      WHERE ed.helper_mode <> 'default' AND e.starts_at >= ?2 AND e.cancelled_at IS NULL
        AND EXISTS (SELECT 1 FROM json_each(ed.helper_teams) h WHERE h.value IN (SELECT value FROM json_each(?1)))`,
    JSON.stringify(teams),
    `${todayLocal()}T00:00`,
  );
  if (!rows.length) return false;
  // The duty type decides too (assigned by the coach, adults only), as when signing up
  const types = await loadDutyTypes(db);
  return rows.some((r) => {
    const type = types.get(r.duty_type_id);
    return !!type && !type.archived && teamRolesFor(actor, type, parsePool(r.helper_teams)).length > 0;
  });
}

/** Upcoming club events with time blocks where one can help ("who helps", "helpers from") or which one manages. */
export async function hasClubDuties(db: D1Database, actor: Actor): Promise<boolean> {
  if (!isModuleOn("duties")) return false;
  const rows = await all<{ event_id: number; duty_type_id: number } & HelperColumns>(
    db,
    `SELECT DISTINCT ed.event_id, ed.duty_type_id, ${HELPER_COLUMNS} FROM events e JOIN event_duties ed ON ed.event_id = e.id
      WHERE e.kind = 'special' AND e.starts_at >= ? AND e.club_wide = 1 AND e.cancelled_at IS NULL AND ed.slots > 0`,
    `${todayLocal()}T00:00`,
  );
  if (!rows.length) return false;
  if (actor.isAdmin) return true;
  const eventIds = [...new Set(rows.map((r) => r.event_id))];
  const [types, managers, club] = await Promise.all([loadDutyTypes(db, eventIds), dutyManagers(db, eventIds), clubHelperTeam(db, actor)]);
  if (eventIds.some((id) => managers.get(id)?.has(actor.personId))) return true;
  return rows.some((r) => {
    const type = types.get(r.duty_type_id);
    return !!type && blockRoles(actor, [club], type, helperSource(r)).length > 0;
  });
}

/** All teams (no groups): the frame of "who helps" at club events. */
export async function allTeamIds(db: D1Database): Promise<number[]> {
  return (await all<{ id: number }>(db, "SELECT id FROM teams WHERE kind = 'team'")).map((r) => r.id);
}

/**
 * SQL: does the person (expression) fit "who helps" of the duty type, for the teams in teamSet (subquery)? For duties
 * the coach assigns: they only assign who could otherwise take the duty. Same rules as rolesFor: parents only in teams
 * with parents, without parents the players themselves. With "helpers from" on the block only the players of its teams.
 */
export function whoSql(type: DutyType, person: string, teamSet: string, source?: HelperSource): string {
  if (source && source.mode !== "default") {
    // Team ids come from the database (integers)
    const ids = helperTeamsOf(source).filter(Number.isInteger);
    if (!ids.length) return "0";
    const clause = `EXISTS (SELECT 1 FROM team_memberships w WHERE w.person_id = ${person} AND w.role = 'player' AND w.team_id IN (${ids.join(", ")}))`;
    return type.adultsOnly ? `(${clause} AND ${adultSql(person)})` : clause;
  }
  const inTeam = (roles: string) =>
    `EXISTS (SELECT 1 FROM team_memberships w JOIN teams wt ON wt.id = w.team_id WHERE w.person_id = ${person} AND w.team_id IN (${teamSet}) AND w.role IN (${roles})`;
  const parts: string[] = [];
  if (type.whoPlayers) parts.push(`${inTeam("'player', 'helper'")})`);
  if (type.whoCoaches) parts.push(`${inTeam("'coach'")})`);
  if (type.whoParents) {
    parts.push(
      `EXISTS (SELECT 1 FROM guardianships wg JOIN team_memberships w ON w.person_id = wg.child_id JOIN teams wt ON wt.id = w.team_id
                WHERE wg.guardian_id = ${person} AND w.team_id IN (${teamSet}) AND w.role IN ('player', 'helper') AND wt.parents_enabled = 1)`,
      `${inTeam("'player', 'helper'")} AND wt.parents_enabled = 0)`,
    );
  }
  if (type.whoMembers) {
    parts.push(
      `(EXISTS (SELECT 1 FROM club_members wm WHERE wm.person_id = ${person})
        AND (${inTeam("'player', 'helper', 'coach'")})
             OR EXISTS (SELECT 1 FROM guardianships wg JOIN team_memberships w ON w.person_id = wg.child_id
                         WHERE wg.guardian_id = ${person} AND w.team_id IN (${teamSet}))))`,
    );
  }
  if (!parts.length) return "0";
  return type.adultsOnly ? `((${parts.join(" OR ")}) AND ${adultSql(person)})` : `(${parts.join(" OR ")})`;
}

/**
 * Roles through "helpers from" (teams on the block): oneself as a player of one of these teams, one's children when
 * they play there and the parents are involved (the child does the duty, the parents sign it up). Regardless of the
 * event the block belongs to. Not for duties the coach assigns or approved people from all teams take.
 */
export function teamRolesFor(actor: Actor, type: DutyType, teamIds: readonly number[]): HelperRole[] {
  if (!teamIds.length || type.assignOnly || type.whoQualified) return [];
  const teams = new Set(teamIds);
  const playing = (m: { role: string; teamId: number }) => m.role === "player" && teams.has(m.teamId);
  const roles: HelperRole[] = [];
  if (actor.memberships.some(playing)) roles.push({ childId: null, childName: null });
  for (const child of actor.children) {
    if ((actor.childMemberships.get(child.id) ?? []).some((m) => playing(m) && m.parentsEnabled)) roles.push({ childId: child.id, childName: child.firstName, doer: true });
  }
  return adultRoles(actor, type, roles);
}

/**
 * Roles at a block: without "helpers from" by "who helps" of the duty type (teams: the event's team or the club), with
 * "helpers from" only the players of those teams; managers can always sign up themselves.
 */
export function blockRoles(actor: Actor, teams: HelperTeam[], type: DutyType, source: HelperSource): HelperRole[] {
  const base =
    source.mode === "default"
      ? teams.flatMap((t) => rolesForActor(actor, t, type))
      : teams.some((t) => t.canManage) && !type.whoQualified
        ? [{ childId: null, childName: null }]
        : [];
  return mergeRoles(base, teamRolesFor(actor, type, helperTeamsOf(source)));
}

/** Roles of both ways together; a child role as helper from a team wins (the child does the duty). */
export function mergeRoles(a: HelperRole[], b: HelperRole[]): HelperRole[] {
  const out = [...b];
  for (const r of a) if (!out.some((x) => x.childId === r.childId)) out.push(r);
  return out;
}

/** Of age by birth year (only the year is known): one counts as adult in the year of the 18th birthday. */
export const ADULT_AGE = 18;

/** Youngest birth year that counts as adult. */
export function adultBirthYearMax(today = todayLocal()): number {
  return Number(today.slice(0, 4)) - ADULT_AGE;
}

/** Under age by birth year; without a birth year (parents, coaches) not. */
export function isMinor(birthYear: number | null | undefined, today = todayLocal()): boolean {
  return birthYear != null && birthYear > adultBirthYearMax(today);
}

/**
 * Duties "adults only": roles without minors. Whoever does the duty counts: oneself, or the child for helpers from other
 * teams (doer); a parent signing up for their child's team does the duty themselves.
 */
export function adultRoles(actor: Actor, type: DutyType, roles: HelperRole[]): HelperRole[] {
  if (!type.adultsOnly) return roles;
  return roles.filter((r) => (r.doer && r.childId != null ? !isMinor(actor.childBirthYears.get(r.childId)) : !isMinor(actor.birthYear)));
}

/** rolesFor with the age limit of the duty type. */
export function rolesForActor(actor: Actor, team: HelperTeam, type: DutyType): HelperRole[] {
  return adultRoles(actor, type, rolesFor(team, type));
}

/** SQL: the person (expression) is not under age by birth year. */
export function adultSql(person: string, today = todayLocal()): string {
  return `NOT EXISTS (SELECT 1 FROM persons ap WHERE ap.id = ${person} AND ap.birth_year IS NOT NULL AND ap.birth_year > ${adultBirthYearMax(today)})`;
}

/**
 * Takes over the youth referee role of an export from before 0.8.0 (tables referees, referee_links, the age class
 * flag youth_referee, groups with auto_members = 'referees') as qualifications, like the migration
 * 202611092330_core_qualifications.sql did. Repeatable: rows already there stay.
 */
export async function adoptLegacyQualifications(db: D1Database): Promise<void> {
  const type = "(SELECT min(id) FROM duty_types WHERE who_referees = 1 AND event_id IS NULL)";
  await db.batch([
    stmt(db, "UPDATE duty_types SET skill_grant = 'admin' WHERE who_referees = 1 AND skill_grant <> 'admin'"),
    stmt(
      db,
      `INSERT OR IGNORE INTO skill_grants (person_id, duty_type_id, granted_by, granted_at)
       SELECT r.person_id, ${type}, r.added_by, r.created_at FROM referees r WHERE ${type} IS NOT NULL`,
    ),
    stmt(
      db,
      `INSERT OR IGNORE INTO age_class_duties (age_class_id, duty_type_id)
       SELECT ac.id, ${type} FROM age_classes ac WHERE ac.youth_referee = 1 AND ${type} IS NOT NULL`,
    ),
    stmt(db, `UPDATE teams SET auto_skill = ${type} WHERE kind = 'group' AND auto_members = 'referees' AND auto_skill IS NULL`),
  ]);
}
