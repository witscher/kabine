import { t } from "@lingui/core/macro";
import { matchdayHost, splitRef, teamScheduleUrl, teamTableUrl } from "./fixtures";
import type {
  EventCounts,
  EventDetail,
  EventKind,
  EventSummary,
  FamilyOverview,
  GameInfo,
  MyFamily,
  MyParticipation,
  ParticipantDetail,
  ParticipationStatus,
  PersonRef,
  RespondedBy,
  RosterEntry,
  TeamRef,
} from "../../shared/types";
import { CHILD_LIMITED } from "./child-limits";
import { type Actor, childLimitAllows, isCoachOfAny, isStaffOfAny, mayActFor, PARENTS_HANDLE_IT, parentsInCharge, parentsInChargeSql, scopePersonIds } from "../auth/actor";
import { all, list } from "../lib/db";
import { CACHE_VERSIONS_SQL, type CacheVersions, fromCache, toVersions } from "../lib/cache";
import { ownClubAbbr } from "./club";
import { addDays, addMinutesLocal, localToInstant, toLocal } from "../lib/time";
import { currentLocale } from "../i18n";
import type { AttendanceMark } from "../../shared/attendance";

export interface EventRow {
  id: number;
  kind: "training" | "game" | "special";
  title: string | null;
  starts_at: string;
  ends_at: string | null;
  location_id: number | null;
  notes: string | null;
  rule_id: number | null;
  rule_date: string | null;
  is_detached: number;
  club_wide: number;
  /** Special event: nobody responds, no reminders, counts or attendance (helper duties stay) */
  no_attendance: number;
  /** Special event: everyone is optional, whoever wants to join says yes */
  optional_attendance: number;
  /** Special event: each family says how many people come (event_family_responses) */
  family_attendance: number;
  decline_hours: number | null;
  cancelled_at: string | null;
  cancelled_by: number | null;
  cancel_reason: string | null;
  reminder_sent_at: string | null;
  external_ref: string | null;
  game_no: string | null;
  home_team: string | null;
  guest_team: string | null;
  is_home: number | null;
  home_goals: number | null;
  guest_goals: number | null;
  meeting_point: string | null;
  meeting_time: string | null;
  coach_notes: string | null;
  squad_published_at: string | null;
  squad_manual: number;
  game_reminder_sent_at: string | null;
  /** The attendance record was written (worker/domain/attendance.ts) */
  attendance_recorded_at: string | null;
  loc_name: string | null;
  loc_address: string | null;
  loc_map_url: string | null;
  loc_kind: "hall" | "custom" | "external" | null;
  plan_decline_hours: number | null;
  cancelled_by_first: string | null;
  cancelled_by_last: string | null;
}

export const EVENT_COLUMNS = `e.*, l.name AS loc_name, l.address AS loc_address, l.map_url AS loc_map_url, l.kind AS loc_kind,
         tp.decline_hours AS plan_decline_hours,
         cp.first_name AS cancelled_by_first, cp.last_name AS cancelled_by_last`;

export const EVENT_JOINS = `
    LEFT JOIN locations l ON l.id = e.location_id
    LEFT JOIN training_rules tr ON tr.id = e.rule_id
    LEFT JOIN training_plans tp ON tp.id = tr.plan_id
    LEFT JOIN persons cp ON cp.id = e.cancelled_by`;

export const EVENT_SELECT = `
  SELECT ${EVENT_COLUMNS}
    FROM events e${EVENT_JOINS}`;

export interface TeamInfo {
  id: number;
  name: string;
  age_class_code: string;
  /** 1 = first team; the short game title names the level from the second team on */
  level: number;
  /** Playing time of the age class (current season), 120 if unknown. */
  game_minutes: number;
  decline_hours_training: number;
  decline_hours_game: number;
  max_squad: number;
  auto_squad: number;
  fixture_connector: string | null;
  fixture_source: string | null;
  show_responses: number;
  /** Whole team at games: every player takes part, the nomination only decides who plays */
  game_all_players: number;
  /** Parents respond for their children (registration per family: parents belong to the family) */
  parents_enabled: number;
  /** A team or a group (coaches' team, referees, …) */
  kind: "team" | "group";
  /** Training group: its special events count as trainings in the event overview */
  training_group: number;
}

export interface MemberRow {
  team_id: number;
  person_id: number;
  role: "player" | "helper";
  helper_trainings: number;
  first_name: string;
  last_name: string | null;
  is_active: number;
}

interface ResponseRow {
  event_id: number;
  person_id: number;
  status: "yes" | "no";
  reason: string | null;
  is_late: number;
  by_person: number | null;
  by_first: string | null;
  responded_at: string;
}

interface NominationRow {
  event_id: number;
  person_id: number;
  is_helper: number;
  first_name: string;
  last_name: string | null;
  is_active: number;
}

export interface HelpRow {
  id: number;
  event_id: number;
  person_id: number;
  team_id: number;
  team_name: string;
  status: "open" | "accepted" | "declined" | "withdrawn";
}

interface StandingRow {
  person_id: number;
  rule_id: number;
  valid_from: string | null;
  valid_to: string | null;
}

export interface Participant {
  person: PersonRef;
  teamId: number;
  /** All teams of the person involved, e.g. wC1 and wC2 at a joint training */
  teamIds: number[];
  isHelper: boolean;
  /** Games: nominated (plays). With "whole team at games" players who are not nominated take part too. */
  nominated: boolean;
  /**
   * Optional training for this person: all their teams at the event join optionally. No automatic
   * acceptance, no reminders, no "absent without excuse", in the statistics only when accepted.
   */
  optional: boolean;
  isActive: boolean;
  status: ParticipationStatus;
  response: ResponseRow | null;
  hasStandingAbsence: boolean;
}

/** Registration per family: a family (joined through parent links) or a person without links. */
export interface FamilyUnit {
  /** Smallest person id of the family; answers are saved under it */
  key: number;
  /** Participants first, then their parents */
  members: PersonRef[];
  count: number | null;
  updatedBy: string | null;
  updatedAt: string | null;
}

export interface EventFamilies {
  units: FamilyUnit[];
  unitOf: Map<number, FamilyUnit>;
}

export interface EventContext {
  teams: Map<number, TeamInfo>;
  eventTeams: Map<number, number[]>;
  participants: Map<number, Participant[]>;
  /** Team members per event (also without nomination), for "not nominated". */
  members: Map<number, Map<number, MemberRow>>;
  nominations: Map<number, Map<number, NominationRow>>;
  helpRequests: Map<number, HelpRow[]>;
  guardianOf: Set<string>; // `${guardianId}:${childId}`
  /** Attendance entries of the coaches after the event: `${eventId}:${personId}` (shared/attendance.ts) */
  marks: Map<string, AttendanceMark>;
  /** Teams joining optionally: `${eventId}:${teamId}` */
  optional: Set<string>;
  /** Leaders who said "I'm not there": `${eventId}:${personId}` (worker/domain/leaders.ts) */
  leaderAbsences: Map<string, LeaderAbsence>;
  /** Registration per family: the families per event */
  families: Map<number, EventFamilies>;
}

export interface LeaderAbsence {
  note: string | null;
  teamInformed: boolean;
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const arr = map.get(key);
  if (arr) arr.push(value);
  else map.set(key, [value]);
}

export function deadlineHours(e: EventRow, teams: TeamInfo[]): number {
  if (e.decline_hours != null) return e.decline_hours;
  if (e.kind === "game") return Math.max(0, ...teams.map((t) => t.decline_hours_game)) || (teams.length ? 0 : 6);
  if (e.kind === "training" && e.plan_decline_hours != null) return e.plan_decline_hours;
  if (!teams.length) return 6;
  return Math.max(...teams.map((t) => t.decline_hours_training));
}

export function deadlineInstant(e: EventRow, teams: TeamInfo[]): number {
  return localToInstant(e.starts_at) - deadlineHours(e, teams) * 3_600_000;
}

function standingApplies(s: StandingRow, e: EventRow): boolean {
  const day = e.starts_at.slice(0, 10);
  return (!s.valid_from || s.valid_from <= day) && (!s.valid_to || day <= s.valid_to);
}

/** All teams and groups with their age class, from the cache per Worker instance (worker/lib/cache.ts). */
export function cachedTeamInfo(db: D1Database, versions: CacheVersions): Promise<TeamInfo[]> {
  return fromCache(versions, "ref", "team-info", () =>
    all<TeamInfo>(
      db,
      `SELECT t.id, t.name, t.age_class_code, t.level, COALESCE(ac.game_minutes, 120) AS game_minutes, t.decline_hours_training,
              t.decline_hours_game, t.max_squad, t.auto_squad, t.fixture_connector, t.fixture_source, t.show_responses,
              t.game_all_players, t.parents_enabled, t.kind, t.training_group
         FROM teams t ${CURRENT_AGE_CLASS_JOIN("t", "ac")}
        ORDER BY t.name`,
    ),
  );
}

/** Players and helpers of all teams with their names (not former members), from the cache per Worker instance. */
export function cachedRoster(db: D1Database, versions: CacheVersions): Promise<MemberRow[]> {
  return fromCache(versions, "roster", "members", () =>
    all<MemberRow>(
      db,
      `SELECT tm.team_id, tm.person_id, tm.role, tm.helper_trainings, p.first_name, p.last_name, p.is_active
         FROM team_memberships tm JOIN persons p ON p.id = tm.person_id
        WHERE tm.role IN ('player', 'helper') AND p.is_former = 0
        ORDER BY p.first_name, p.last_name, p.id`,
    ),
  );
}

/** Loads everything needed for status, counts and permissions of a list of events. */
export async function loadEventContext(db: D1Database, events: EventRow[]): Promise<EventContext> {
  const ids = events.map((e) => e.id);
  const ruleIds = [...new Set(events.map((e) => e.rule_id).filter((r): r is number => r != null))];
  const hasClubWide = events.some((e) => e.club_wide === 1);

  const [eventTeamRows, responses, nominations, helps, markRows, absenceRows, versionRows] = await db.batch([
    db.prepare("SELECT event_id, team_id, optional FROM event_teams WHERE event_id IN (SELECT value FROM json_each(?))").bind(list(ids)),
    db
      .prepare(
        `SELECT r.event_id, r.person_id, r.status, r.reason, r.is_late, r.by_person, bp.first_name AS by_first, r.responded_at
           FROM responses r LEFT JOIN persons bp ON bp.id = r.by_person
          WHERE r.event_id IN (SELECT value FROM json_each(?))`,
      )
      .bind(list(ids)),
    db
      .prepare(
        `SELECT n.event_id, n.person_id, n.is_helper, p.first_name, p.last_name, p.is_active
           FROM nominations n JOIN persons p ON p.id = n.person_id
          WHERE n.event_id IN (SELECT value FROM json_each(?)) AND p.is_former = 0`,
      )
      .bind(list(ids)),
    db
      .prepare(
        `SELECT h.id, h.event_id, h.person_id, h.team_id, t.name AS team_name, h.status
           FROM help_requests h JOIN teams t ON t.id = h.team_id
          WHERE h.event_id IN (SELECT value FROM json_each(?))`,
      )
      .bind(list(ids)),
    db.prepare("SELECT event_id, person_id, status FROM attendance_marks WHERE event_id IN (SELECT value FROM json_each(?))").bind(list(ids)),
    db.prepare("SELECT event_id, person_id, note, team_informed FROM leader_absences WHERE event_id IN (SELECT value FROM json_each(?))").bind(list(ids)),
    db.prepare(CACHE_VERSIONS_SQL),
  ]);
  // Teams, memberships and parent links rarely change: from the cache (worker/lib/cache.ts), loaded from D1 only when
  // their version changed. Before, every event list read the memberships of all its teams again.
  const versions = toVersions(versionRows!.results as { name: string; version: number }[]);
  const [allTeams, roster, guardianships] = await Promise.all([
    cachedTeamInfo(db, versions),
    cachedRoster(db, versions),
    fromCache(versions, "roster", "guardianships", () => all<{ guardian_id: number; child_id: number }>(db, "SELECT guardian_id, child_id FROM guardianships")),
  ]);
  const leaderAbsences = new Map<string, LeaderAbsence>();
  for (const a of absenceRows!.results as { event_id: number; person_id: number; note: string | null; team_informed: number }[]) {
    leaderAbsences.set(`${a.event_id}:${a.person_id}`, { note: a.note, teamInformed: a.team_informed === 1 });
  }
  const marks = new Map(
    (markRows!.results as { event_id: number; person_id: number; status: AttendanceMark }[]).map((m) => [`${m.event_id}:${m.person_id}`, m.status] as const),
  );

  const teams = new Map<number, TeamInfo>();
  const eventTeams = new Map<number, number[]>();
  const optional = new Set<string>();
  // Teams of an event sorted by name, as before in SQL
  const teamById = new Map(allTeams.map((tm) => [tm.id, tm]));
  const teamOrder = new Map(allTeams.map((tm, i) => [tm.id, i]));
  const etRows = (eventTeamRows!.results as { event_id: number; team_id: number; optional: number }[])
    .filter((r) => teamById.has(r.team_id))
    .sort((a, b) => teamOrder.get(a.team_id)! - teamOrder.get(b.team_id)!);
  for (const r of etRows) {
    teams.set(r.team_id, teamById.get(r.team_id)!);
    push(eventTeams, r.event_id, r.team_id);
    if (r.optional === 1) optional.add(`${r.event_id}:${r.team_id}`);
  }
  const teamIdSet = new Set(teams.keys());

  const standing = ruleIds.length
    ? await all<StandingRow>(db, "SELECT person_id, rule_id, valid_from, valid_to FROM standing_absences WHERE rule_id IN (SELECT value FROM json_each(?))", list(ruleIds))
    : [];

  const memberRows = roster.filter((m) => teamIdSet.has(m.team_id));
  const allPlayerRows = hasClubWide ? roster.filter((m) => m.role === "player") : [];
  const responsesByEvent = new Map<number, Map<number, ResponseRow>>();
  for (const r of responses!.results as ResponseRow[]) {
    if (!responsesByEvent.has(r.event_id)) responsesByEvent.set(r.event_id, new Map());
    responsesByEvent.get(r.event_id)!.set(r.person_id, r);
  }
  const nominationsByEvent = new Map<number, Map<number, NominationRow>>();
  for (const n of nominations!.results as NominationRow[]) {
    if (!nominationsByEvent.has(n.event_id)) nominationsByEvent.set(n.event_id, new Map());
    nominationsByEvent.get(n.event_id)!.set(n.person_id, n);
  }
  const helpByEvent = new Map<number, HelpRow[]>();
  for (const h of helps!.results as HelpRow[]) push(helpByEvent, h.event_id, h);
  const standingByRule = new Map<number, StandingRow[]>();
  for (const s of standing) push(standingByRule, s.rule_id, s);

  const participants = new Map<number, Participant[]>();
  const membersByEvent = new Map<number, Map<number, MemberRow>>();
  const personIds = new Set<number>();

  for (const e of events) {
    const evTeams = eventTeams.get(e.id) ?? [];
    const evMembers = new Map<number, MemberRow>();
    const memberTeams = new Map<number, number[]>();
    const source = e.club_wide === 1 ? allPlayerRows : memberRows.filter((m) => evTeams.includes(m.team_id));
    const teamName = (id: number) => teams.get(id)?.name ?? "";
    for (const m of source) {
      if (m.role === "helper" && !(e.kind === "game" || (e.kind === "training" && m.helper_trainings === 1))) continue;
      memberTeams.set(m.person_id, [...new Set([...(memberTeams.get(m.person_id) ?? []), m.team_id])]);
      const existing = evMembers.get(m.person_id);
      // Player before helper; with two teams fixed by name (wC1 before wC2)
      if (
        !existing ||
        (existing.role === "helper" && m.role === "player") ||
        (existing.role === m.role && teamName(m.team_id).localeCompare(teamName(existing.team_id)) < 0)
      ) {
        evMembers.set(m.person_id, m);
      }
    }
    membersByEvent.set(e.id, evMembers);
    // Without attendance: nobody takes part, so no responses, reminders, attendance or counts
    if (isNoAttendance(e)) {
      participants.set(e.id, []);
      continue;
    }

    const resp = responsesByEvent.get(e.id) ?? new Map<number, ResponseRow>();
    const standingRows = e.kind === "training" && e.rule_id != null ? (standingByRule.get(e.rule_id) ?? []) : [];
    const list: Participant[] = [];

    const add = (personId: number, first: string, last: string | null, isActive: number, teamId: number, isHelper: boolean, nominated = false) => {
      const response = resp.get(personId) ?? null;
      const hasStanding = standingRows.some((s) => s.person_id === personId && standingApplies(s, e));
      // Optional only if every team of the person at this training joins optionally. Special events with optional
      // attendance or registration per family: optional for everyone.
      const ownTeams = memberTeams.get(personId) ?? [teamId];
      const isOptional =
        (e.kind === "special" && (e.optional_attendance === 1 || e.family_attendance === 1)) ||
        (e.kind === "training" && ownTeams.every((t) => optional.has(`${e.id}:${t}`)));
      let status: ParticipationStatus;
      if (isActive !== 1) status = "inactive";
      else if (response) status = response.status;
      else if (hasStanding) status = "standing";
      // Players count as accepted until they decline. Helpers and optional participants accept themselves.
      else status = isHelper || isOptional ? "open" : "yes";
      personIds.add(personId);
      list.push({
        person: { id: personId, firstName: first, lastName: last },
        teamId,
        teamIds: [teamId, ...(memberTeams.get(personId) ?? []).filter((t) => t !== teamId).sort((a, b) => teamName(a).localeCompare(teamName(b)))],
        isHelper,
        nominated,
        optional: isOptional,
        isActive: isActive === 1,
        status,
        response,
        hasStandingAbsence: hasStanding,
      });
    };

    if (e.kind === "game") {
      const nominated = nominationsByEvent.get(e.id) ?? new Map<number, NominationRow>();
      for (const n of nominated.values()) {
        const m = evMembers.get(n.person_id);
        add(n.person_id, n.first_name, n.last_name, n.is_active, m?.team_id ?? evTeams[0] ?? 0, n.is_helper === 1 || m?.role === "helper", true);
      }
      // Whole team at games: every player of these teams, also without a nomination (helpers only when nominated)
      const allTeams = evTeams.filter((id) => teams.get(id)?.game_all_players === 1);
      if (allTeams.length) {
        for (const m of source) {
          if (m.role !== "player" || !allTeams.includes(m.team_id) || nominated.has(m.person_id) || list.some((p) => p.person.id === m.person_id)) continue;
          add(m.person_id, m.first_name, m.last_name, m.is_active, m.team_id, false, false);
        }
      }
    } else {
      for (const m of evMembers.values()) {
        add(m.person_id, m.first_name, m.last_name, m.is_active, m.team_id, m.role === "helper");
      }
    }
    participants.set(e.id, list);
  }

  // Who is a parent of whom? For "declined by parent".
  const guardianRows = guardianships.filter((g) => personIds.has(g.child_id));
  const families = await loadFamilies(db, events, participants, guardianRows, teamById);

  return {
    teams,
    eventTeams,
    participants,
    members: membersByEvent,
    nominations: nominationsByEvent,
    helpRequests: helpByEvent,
    guardianOf: new Set(guardianRows.map((g) => `${g.guardian_id}:${g.child_id}`)),
    marks,
    optional,
    leaderAbsences,
    families,
  };
}

function isNoAttendance(e: EventRow): boolean {
  return e.kind === "special" && e.no_attendance === 1;
}

function isFamilyAttendance(e: EventRow): boolean {
  return e.kind === "special" && e.family_attendance === 1 && e.no_attendance !== 1;
}

/** "First name L." */
function shortPersonName(first: string, last: string | null): string {
  return last ? `${first} ${last.charAt(0)}.` : first;
}

/**
 * Registration per family: participants and their parents, joined through the parent links (siblings, patchwork);
 * whoever has no links is a unit of their own. Parents belong to the family only where parents are in charge of the
 * child (as for responses). Answers are saved under one person of the family; on reading, they belong to the family
 * that person is in now (with two, the newer wins). The participants' status follows the answer.
 */
async function loadFamilies(
  db: D1Database,
  events: EventRow[],
  participants: Map<number, Participant[]>,
  guardianRows: { guardian_id: number; child_id: number }[],
  teamById: Map<number, TeamInfo>,
): Promise<Map<number, EventFamilies>> {
  const out = new Map<number, EventFamilies>();
  const familyEvents = events.filter(isFamilyAttendance);
  if (!familyEvents.length) return out;
  const guardianIds = [...new Set(guardianRows.map((g) => g.guardian_id))];
  const [people, answers] = await db.batch([
    db.prepare("SELECT id, first_name, last_name FROM persons WHERE id IN (SELECT value FROM json_each(?)) AND is_former = 0").bind(list(guardianIds)),
    db
      .prepare(
        `SELECT f.event_id, f.anchor_id, f.count, f.updated_at, p.first_name, p.last_name
           FROM event_family_responses f LEFT JOIN persons p ON p.id = f.updated_by
          WHERE f.event_id IN (SELECT value FROM json_each(?))`,
      )
      .bind(list(familyEvents.map((e) => e.id))),
  ]);
  const guardianRef = new Map(
    (people!.results as { id: number; first_name: string; last_name: string | null }[]).map((p) => [p.id, { id: p.id, firstName: p.first_name, lastName: p.last_name }]),
  );
  const answerRows = answers!.results as { event_id: number; anchor_id: number; count: number; updated_at: string; first_name: string | null; last_name: string | null }[];

  for (const e of familyEvents) {
    const parts = participants.get(e.id) ?? [];
    const partIds = new Set(parts.map((p) => p.person.id));
    const inCharge = new Set(parts.filter((p) => p.teamIds.some((id) => teamById.get(id)?.parents_enabled === 1)).map((p) => p.person.id));
    // Union-find over the parent links of the participants
    const root = new Map<number, number>();
    const find = (x: number): number => {
      let r = x;
      while (root.has(r) && root.get(r) !== r) r = root.get(r)!;
      return r;
    };
    const edges = guardianRows.filter((g) => inCharge.has(g.child_id) && guardianRef.has(g.guardian_id));
    for (const g of edges) {
      const a = find(g.guardian_id);
      const b = find(g.child_id);
      if (a !== b) root.set(a, b);
    }
    const byRoot = new Map<number, { participants: PersonRef[]; guardians: PersonRef[] }>();
    const entry = (r: number) => {
      if (!byRoot.has(r)) byRoot.set(r, { participants: [], guardians: [] });
      return byRoot.get(r)!;
    };
    for (const p of parts) entry(find(p.person.id)).participants.push(p.person);
    for (const id of new Set(edges.map((g) => g.guardian_id))) if (!partIds.has(id)) entry(find(id)).guardians.push(guardianRef.get(id)!);

    const units: FamilyUnit[] = [];
    const unitOf = new Map<number, FamilyUnit>();
    for (const f of byRoot.values()) {
      const members = [...f.participants, ...f.guardians];
      const unit: FamilyUnit = { key: Math.min(...members.map((m) => m.id)), members, count: null, updatedBy: null, updatedAt: null };
      units.push(unit);
      for (const m of members) unitOf.set(m.id, unit);
    }
    for (const a of answerRows.filter((r) => r.event_id === e.id)) {
      const unit = unitOf.get(a.anchor_id);
      if (!unit || (unit.updatedAt && unit.updatedAt > a.updated_at)) continue;
      unit.count = a.count;
      unit.updatedAt = a.updated_at;
      unit.updatedBy = a.first_name ? shortPersonName(a.first_name, a.last_name) : null;
    }
    // Status of the participants follows their family's answer (counts, cancel and move notices)
    for (const p of parts) {
      if (!p.isActive) continue;
      const count = unitOf.get(p.person.id)?.count;
      p.status = count == null ? "open" : count > 0 ? "yes" : "no";
    }
    out.set(e.id, { units, unitOf });
  }
  return out;
}

/** "Kim, Lea and Mona K." with one family name, else "Kim K., Tom B. and Paul B.", in the current language. */
export function familyLabel(members: PersonRef[]): string {
  const initials = new Set(members.map((m) => m.lastName?.charAt(0) ?? ""));
  const initial = initials.size === 1 ? [...initials][0] : "";
  const names = initials.size === 1 ? members.map((m) => m.firstName) : members.map((m) => shortPersonName(m.firstName, m.lastName));
  const joined = new Intl.ListFormat(currentLocale(), { type: "conjunction" }).format(names);
  return initial ? `${joined} ${initial}.` : joined;
}

function myFamily(f: EventFamilies | undefined, actor: Actor): MyFamily | null {
  const unit = f?.unitOf.get(actor.personId);
  return unit ? { label: familyLabel(unit.members), members: unit.members.length, count: unit.count, updatedBy: unit.updatedBy, updatedAt: unit.updatedAt } : null;
}

/** The family of the actor at a family event (as a participant or a parent in charge), else undefined. */
export function familyOf(ctx: EventContext, eventId: number, actor: Actor): FamilyUnit | undefined {
  return ctx.families.get(eventId)?.unitOf.get(actor.personId);
}

/** Overview of the registration per family for coaches, admins and organisers. */
export function familyOverview(f: EventFamilies | undefined): FamilyOverview | null {
  if (!f) return null;
  const registered = f.units.filter((u) => (u.count ?? 0) > 0);
  const locale = currentLocale();
  return {
    persons: registered.reduce((n, u) => n + (u.count ?? 0), 0),
    registered: registered.length,
    declined: f.units.filter((u) => u.count === 0).length,
    open: f.units.filter((u) => u.count == null).length,
    units: registered
      .map((u) => ({ label: familyLabel(u.members), count: u.count ?? 0 }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, locale)),
  };
}

/** Optional attendance: who said yes, as "First name L." (organisers without coach rights plan with it). */
export function optionalYesNames(e: EventRow, ctx: EventContext): string[] {
  const locale = currentLocale();
  return (ctx.participants.get(e.id) ?? [])
    .filter((p) => p.status === "yes")
    .map((p) => shortPersonName(p.person.firstName, p.person.lastName))
    .sort((a, b) => a.localeCompare(b, locale));
}

/** Imported game: the connector, the game's id at the source and what the team's connector fetches. */
export function gameSource(e: EventRow, teams: TeamInfo[]): GameInfo["source"] {
  const ref = splitRef(e.external_ref);
  if (!ref) return null;
  const team = teams.find((x) => x.fixture_connector === ref.connector);
  return { connector: ref.connector, externalId: ref.id, scheduleUrl: team ? teamScheduleUrl(team) : null };
}

/** Age class of a team in the current season (alias for teams, alias for the class). */
export const CURRENT_AGE_CLASS_JOIN = (team: string, ac: string) =>
  `LEFT JOIN age_classes ${ac} ON ${ac}.code = ${team}.age_class_code AND ${ac}.season_id = (SELECT id FROM seasons WHERE is_current = 1)`;

/** Playing time of a team's age class in the current season (90 if unknown). */
export async function teamGameMinutes(db: D1Database, teamId: number): Promise<number> {
  const row = await db
    .prepare(`SELECT ac.game_minutes FROM teams t ${CURRENT_AGE_CLASS_JOIN("t", "ac")} WHERE t.id = ?`)
    .bind(teamId)
    .first<{ game_minutes: number | null }>();
  return row?.game_minutes ?? 90;
}

/**
 * Duration of the "In progress" card, after that there is the game report: the playing time of the
 * age class (sport profile, editable by admins). With several teams the longest applies.
 */
export function gameLiveMinutes(minutes: number[]): number {
  return minutes.length ? Math.max(...minutes) : 120;
}

/** League table of the first team with a linked schedule. */
export function gameTable(teams: TeamInfo[]): GameInfo["table"] {
  for (const team of teams) {
    const table = teamTableUrl(team);
    if (table) return table;
  }
  return null;
}

export function eventTeams(e: EventRow, ctx: EventContext): TeamInfo[] {
  return (ctx.eventTeams.get(e.id) ?? []).map((id) => ctx.teams.get(id)!).filter(Boolean);
}

/**
 * Game title without the team name, for lists that show the team next to it: "SVM 2 – HSG Opponent" (club abbreviation,
 * with the team level from the second team on). Matchdays and games without home/away stay as in eventTitle.
 */
export function shortGameTitle(e: EventRow, teams: (TeamRef & { level?: number | null })[]): string {
  const full = eventTitle(e, teams);
  if (e.kind !== "game" || e.is_home == null || matchdayHost({ home: e.home_team ?? "", guest: e.guest_team ?? "" }) != null) return full;
  const level = teams[0]?.level ?? 1;
  const own = level > 1 ? `${ownClubAbbr()} ${level}`.trim() : ownClubAbbr();
  return e.is_home === 1 ? `${own} – ${e.guest_team ?? t`Opponent`}` : `${e.home_team ?? t`Opponent`} – ${own}`;
}

export function eventTitle(e: EventRow, teams: TeamRef[]): string {
  if (e.kind === "game") {
    const own = `${ownClubAbbr()} ${teams[0]?.name ?? ""}`.trim();
    const host = matchdayHost({ home: e.home_team ?? "", guest: e.guest_team ?? "" });
    if (host != null) return e.is_home === 1 ? t`Home matchday ${own}` : t`Matchday at ${host}`;
    if (e.is_home === 1) return `${own} – ${e.guest_team ?? t`Opponent`}`;
    if (e.is_home === 0) return `${e.home_team ?? t`Opponent`} – ${own}`;
    return e.title ?? `${e.home_team ?? "?"} – ${e.guest_team ?? "?"}`;
  }
  if (e.kind === "training") return e.title ?? t`Training`;
  return e.title ?? t`Event`;
}

function respondedBy(ctx: EventContext, personId: number, response: ResponseRow | null): RespondedBy | null {
  if (!response) return null;
  if (response.by_person == null) return "other";
  if (response.by_person === personId) return "self";
  if (ctx.guardianOf.has(`${response.by_person}:${personId}`)) return "guardian";
  return "other";
}

export function countsOf(list: Participant[], marks?: (p: Participant) => AttendanceMark | null): EventCounts {
  const c: EventCounts = { yes: 0, no: 0, open: 0, standing: 0, inactive: 0, optional: 0, present: marks ? 0 : null };
  for (const p of list) {
    // Optional participants count once they accept; otherwise they are neither open nor declined
    if (p.optional && p.status !== "yes" && p.status !== "inactive") c.optional++;
    else c[p.status]++;
    // Past: the recorded attendance comes before the response (as in the attendance record)
    if (marks) {
      const mark = marks(p);
      if (mark === "present" || (mark == null && p.status === "yes")) c.present!++;
    }
  }
  return c;
}

export function isPast(e: EventRow, now: number): boolean {
  return localToInstant(e.starts_at) <= now;
}

/** Without an end: how long a training or special event counts as running. */
const RUNNING_MINUTES = 120;

/** Running: started, not cancelled and before its end (without an end: the playing time of the age class for games, else 2 hours). */
export function isRunning(e: EventRow, teams: TeamInfo[], now: number): boolean {
  if (e.cancelled_at || !isPast(e, now)) return false;
  const end = e.ends_at ?? addMinutesLocal(e.starts_at, e.kind === "game" ? gameLiveMinutes(teams.map((t) => t.game_minutes)) : RUNNING_MINUTES);
  return localToInstant(end) > now;
}

/** Coaches record attendance until the end of the day after the event (local time); admins the whole season (null). */
export function attendanceUntil(e: Pick<EventRow, "starts_at">, actor: Actor): string | null {
  return actor.isAdmin ? null : `${addDays(e.starts_at.slice(0, 10), 1)}T23:59`;
}

/** After the start of an event that took place, within the window. Whether the actor coaches the event is checked by the caller. */
export function attendanceEditable(e: Pick<EventRow, "starts_at" | "cancelled_at">, actor: Actor, now: number): boolean {
  if (e.cancelled_at || localToInstant(e.starts_at) > now) return false;
  return actor.isAdmin || now < localToInstant(`${addDays(e.starts_at.slice(0, 10), 2)}T00:00`);
}

function myParticipations(e: EventRow, ctx: EventContext, actor: Actor, now: number): MyParticipation[] {
  const out: MyParticipation[] = [];
  const parts = ctx.participants.get(e.id) ?? [];
  const members = ctx.members.get(e.id) ?? new Map();
  const helps = ctx.helpRequests.get(e.id) ?? [];
  const past = isPast(e, now);
  const cancelled = e.cancelled_at != null;
  const teamIds = ctx.eventTeams.get(e.id) ?? [];

  for (const pid of scopePersonIds(actor)) {
    // Children only where the parents are in charge
    if (pid !== actor.personId && !parentsInCharge(actor, pid, teamIds)) continue;
    const part = parts.find((p) => p.person.id === pid);
    const member = members.get(pid);
    const help = helps.find((h) => h.person_id === pid && h.status !== "withdrawn") ?? null;
    if (!part && !member && !help) continue;

    const person: PersonRef =
      part?.person ??
      (member
        ? { id: pid, firstName: member.first_name, lastName: member.last_name }
        : pid === actor.personId
          ? { id: pid, firstName: actor.firstName, lastName: actor.lastName }
          : (actor.children.find((c) => c.id === pid) ?? { id: pid, firstName: "", lastName: null }));

    let blockedReason: string | null = null;
    if (cancelled) blockedReason = t`The event is not taking place.`;
    else if (past) blockedReason = t`The event has already started.`;
    else if (!part) blockedReason = e.kind === "game" ? t`Not nominated for this game.` : null;
    else if (!part.isActive) blockedReason = t`Currently marked as inactive. Please talk to your coach.`;

    const canAcceptBase = !blockedReason && !!part;
    const canAccept = canAcceptBase && mayActFor(actor, pid, "may_accept", teamIds);
    const canDecline = canAcceptBase && mayActFor(actor, pid, "may_decline", teamIds);
    if (canAcceptBase && pid === actor.personId && (!canAccept || !canDecline) && !blockedReason) {
      if (!childLimitAllows(actor, "respond", teamIds)) blockedReason = CHILD_LIMITED();
      else if (!canAccept && !canDecline) blockedReason = PARENTS_HANDLE_IT();
    }

    const response = part?.response ?? null;
    out.push({
      person,
      participant: !!part,
      nominated: e.kind === "game" ? !!part?.nominated : false,
      isHelper: part?.isHelper ?? member?.role === "helper",
      optional: part?.optional ?? false,
      status: part?.status ?? null,
      reason: response?.reason ?? null,
      isLate: response?.is_late === 1,
      respondedAt: response?.responded_at ?? null,
      respondedBy: respondedBy(ctx, pid, response),
      respondedByName: response?.by_first ?? null,
      unexcused: ctx.marks.get(`${e.id}:${pid}`) === "unexcused",
      attendance: (part && ctx.marks.get(`${e.id}:${pid}`)) ?? null,
      canAccept,
      canDecline,
      blockedReason,
      helpRequest: help
        ? {
            id: help.id,
            status: help.status,
            teamName: help.team_name,
            canAnswer: help.status === "open" && !past && !cancelled && mayActFor(actor, pid, "may_answer_help", teamIds),
          }
        : null,
    });
  }
  return out;
}

export function toSummary(e: EventRow, ctx: EventContext, actor: Actor, now: number): EventSummary {
  const teams = eventTeams(e, ctx);
  const teamRefs = teams.map((t) => ({ id: t.id, name: t.name }));
  const parts = ctx.participants.get(e.id) ?? [];
  const hours = deadlineHours(e, teams);
  const allPlayers = e.kind === "game" && teams.some((tm) => tm.game_all_players === 1);
  // Games: only with a squad, unless the whole team takes part anyway
  const showCounts = e.kind !== "game" || e.squad_published_at != null || allPlayers;
  const canManage = e.club_wide === 1 ? actor.isAdmin : isCoachOfAny(actor, teams.map((t) => t.id));
  return {
    id: e.id,
    kind: e.kind,
    title: eventTitle(e, teamRefs),
    shortTitle: shortGameTitle(e, teams),
    startsAt: e.starts_at,
    endsAt: e.ends_at,
    location:
      e.location_id != null && e.loc_name
        ? { id: e.location_id, name: e.loc_name, address: e.loc_address, mapUrl: e.loc_map_url, kind: e.loc_kind ?? "custom" }
        : null,
    teams: teamRefs,
    // Special event of a training group: counts as a training in the event overview
    asTraining: e.kind === "special" && teams.some((tm) => tm.training_group === 1),
    optionalTeamIds: teamRefs.filter((tm) => ctx.optional.has(`${e.id}:${tm.id}`)).map((tm) => tm.id),
    clubWide: e.club_wide === 1,
    noAttendance: isNoAttendance(e),
    optionalAttendance: e.kind === "special" && e.optional_attendance === 1 && e.no_attendance !== 1,
    familyAttendance: ctx.families.has(e.id),
    myFamily: myFamily(ctx.families.get(e.id), actor),
    cancelled: e.cancelled_at
      ? {
          at: e.cancelled_at,
          byName: e.cancelled_by_first ? e.cancelled_by_first : null,
          reason: e.cancel_reason,
        }
      : null,
    notes: e.notes,
    deadline: toLocal(localToInstant(e.starts_at) - hours * 3_600_000),
    deadlineHours: hours,
    isPast: isPast(e, now),
    isRunning: isRunning(e, teams, now),
    // Registration per family: numbers per family instead of per person (FamilyOverview)
    counts: showCounts && !isNoAttendance(e) && !ctx.families.has(e.id) ? countsOf(parts, isPast(e, now) && !e.cancelled_at ? (p) => ctx.marks.get(`${e.id}:${p.person.id}`) ?? null : undefined) : null,
    mine: myParticipations(e, ctx, actor, now),
    canManage,
    unexcusedCount: canManage ? parts.filter((p) => ctx.marks.get(`${e.id}:${p.person.id}`) === "unexcused").length : 0,
    leaderAbsent: ctx.leaderAbsences.has(`${e.id}:${actor.personId}`),
    game:
      e.kind === "game"
        ? {
            homeTeam: e.home_team,
            guestTeam: e.guest_team,
            isHome: e.is_home == null ? null : e.is_home === 1,
            homeGoals: e.home_goals,
            guestGoals: e.guest_goals,
            gameNo: e.game_no,
            meetingPoint: e.meeting_point,
            meetingTime: e.meeting_time,
            coachNotes: e.coach_notes,
            squadPublished: e.squad_published_at != null,
            nominatedCount: parts.filter((p) => p.nominated).length,
            allPlayers,
            table: gameTable(teams),
            source: gameSource(e, teams),
            liveMinutes: gameLiveMinutes(teams.map((t) => t.game_minutes)),
          }
        : null,
    isDetached: e.is_detached === 1,
    ruleId: e.rule_id,
    myDuties: [],
    organizing: false,
    staff: !canManage && isStaffOfAny(actor, teamRefs.map((t) => t.id)),
    modules: {},
    helpersNeeded: 0,
  };
}

export function toDetail(e: EventRow, ctx: EventContext, actor: Actor, now: number): EventDetail {
  const summary = toSummary(e, ctx, actor, now);
  const parts = ctx.participants.get(e.id) ?? [];
  const participants: ParticipantDetail[] | null = summary.canManage
    ? parts.map((p) => ({
        person: p.person,
        nominated: p.nominated,
        teamId: p.teamId,
        teamIds: p.teamIds,
        isHelper: p.isHelper,
        optional: p.optional,
        status: p.status,
        reason: p.response?.reason ?? null,
        isLate: p.response?.is_late === 1,
        respondedAt: p.response?.responded_at ?? null,
        respondedBy: respondedBy(ctx, p.person.id, p.response),
        respondedByName: p.response?.by_first ?? null,
        hasStandingAbsence: p.hasStandingAbsence,
        unexcused: ctx.marks.get(`${e.id}:${p.person.id}`) === "unexcused",
        attendance: ctx.marks.get(`${e.id}:${p.person.id}`) ?? null,
      }))
    : null;
  // Teams with "responses visible to everyone": players and involved parents see who
  // accepted or declined (without reasons). Not for games, not for club events.
  const teams = eventTeams(e, ctx);
  // Staff see names and status of their team's events (games once the squad is published), never reasons.
  const showRoster =
    !summary.canManage &&
    ((summary.staff && (e.kind !== "game" || e.squad_published_at != null)) ||
      (e.kind !== "game" &&
        e.club_wide !== 1 &&
        teams.length > 0 &&
        teams.every((t) => t.show_responses === 1) &&
        summary.mine.some((m) => m.participant)));
  const roster: RosterEntry[] | null = showRoster
    ? parts
        // Optional participants only once they accepted (otherwise they are not expected)
        .filter((p) => !p.optional || p.status === "yes")
        .map((p) => ({
          personId: p.person.id,
          name: p.person.lastName ? `${p.person.firstName} ${p.person.lastName.charAt(0)}.` : p.person.firstName,
          status: p.status,
        }))
        .sort((a, b) => a.name.localeCompare(b.name, "de"))
    : null;
  return {
    ...summary,
    participants,
    families: summary.canManage ? familyOverview(ctx.families.get(e.id)) : null,
    optionalYes: null,
    roster,
    dutyManage: false,
    organizers: null,
    leaders: [],
    elsewhere: null,
    attendanceUntil: summary.canManage ? attendanceUntil(e, actor) : null,
    attendanceEditable: summary.canManage && attendanceEditable(e, actor, now),
  };
}

/**
 * SQL: the person (expression) takes part in event e, is nominated, requested, or has a duty there that makes it
 * visible (youth referee, helpers from other teams, assigned by the coach).
 */
function relatesSql(person: string): string {
  return `(
    EXISTS (
      SELECT 1 FROM event_teams et JOIN team_memberships tm ON tm.team_id = et.team_id
       WHERE et.event_id = e.id AND tm.person_id = ${person}
         AND (tm.role IN ('player', 'coach', 'staff')
              OR (tm.role = 'helper' AND (e.kind = 'game' OR (e.kind = 'training' AND tm.helper_trainings = 1))))
    )
    OR EXISTS (SELECT 1 FROM nominations n WHERE n.event_id = e.id AND n.person_id = ${person})
    OR EXISTS (SELECT 1 FROM help_requests h WHERE h.event_id = e.id AND h.status IN ('open', 'accepted') AND h.person_id = ${person})
    -- A duty makes another team's event visible for approved people from all teams, helpers from other teams and duties
    -- the coach assigns; an ordinary duty does not (e.g. a parent of a team without parents)
    OR EXISTS (SELECT 1 FROM duties dd JOIN duty_types ddt ON ddt.id = dd.duty_type_id
                WHERE dd.event_id = e.id AND dd.person_id = ${person}
                  AND (ddt.who_referees = 1 OR ddt.assign_only = 1
                       OR EXISTS (SELECT 1 FROM event_duties ded WHERE ded.id = dd.event_duty_id AND ded.helper_mode <> 'default')))
  )`;
}

/**
 * SQL condition: the event is visible. ?1 holds the own person, ?2 the
 * children. Parents only see their children's events where they are in charge.
 * Creator and organisers of a special event always see it (without the participant list).
 */
export const VISIBLE_SQL = `(
  e.club_wide = 1
  OR EXISTS (SELECT 1 FROM json_each(?1) own_p WHERE ${relatesSql("own_p.value")})
  OR EXISTS (SELECT 1 FROM json_each(?1) org_p WHERE e.created_by = org_p.value
               OR EXISTS (SELECT 1 FROM event_organizers eo WHERE eo.event_id = e.id AND eo.person_id = org_p.value))
  OR EXISTS (SELECT 1 FROM json_each(?2) kid_p WHERE ${relatesSql("kid_p.value")}
               AND ${parentsInChargeSql("kid_p.value", "SELECT team_id FROM event_teams WHERE event_id = e.id")})
)`;

const PEOPLE = "SELECT value FROM json_each(?1) UNION ALL SELECT value FROM json_each(?2)";

/**
 * Preselection for VISIBLE_SQL: all events that could be visible (a superset).
 * It takes the same persons as VISIBLE_SQL (?1 oneself, ?2 the children) and every role,
 * so that no visible event is missing. VISIBLE_SQL still decides; the preselection only
 * saves checking every event in the range one by one (see docs/dev/design.md, Database read load).
 * In two groups because D1 allows at most five parts per UNION. Result: CTE `ids`.
 */
export const CANDIDATES_CTE = `
  by_person(id) AS (
    SELECT et.event_id FROM team_memberships tm JOIN event_teams et ON et.team_id = tm.team_id
     WHERE tm.person_id IN (${PEOPLE})
    UNION SELECT event_id FROM nominations WHERE person_id IN (${PEOPLE})
    UNION SELECT event_id FROM help_requests WHERE person_id IN (${PEOPLE})
    UNION SELECT event_id FROM duties WHERE person_id IN (${PEOPLE})
  ),
  by_role(id) AS (
    SELECT event_id FROM event_organizers WHERE person_id IN (SELECT value FROM json_each(?1))
    UNION SELECT id FROM events WHERE created_by IN (SELECT value FROM json_each(?1))
    UNION SELECT id FROM events WHERE club_wide = 1 AND starts_at >= ?3 AND starts_at < ?4
  ),
  ids(id) AS MATERIALIZED (SELECT id FROM by_person UNION SELECT id FROM by_role)`;

export function visibilityParams(actor: Actor): [string, string] {
  return [list([actor.personId]), list(actor.children.map((c) => c.id))];
}

export async function listVisibleEvents(
  db: D1Database,
  actor: Actor,
  opts: { from: string; to: string; teamId?: number; kind?: string },
): Promise<EventRow[]> {
  const params: (string | number)[] = [...visibilityParams(actor), opts.from, opts.to];
  let candidates = CANDIDATES_CTE;
  if (opts.teamId != null) {
    params.push(opts.teamId);
    candidates = `ids(id) AS MATERIALIZED (SELECT event_id FROM event_teams WHERE team_id = ?${params.length})`;
  }
  let kindFilter = "";
  if (opts.kind) {
    params.push(opts.kind);
    kindFilter = ` AND e.kind = ?${params.length}`;
  }
  // With a team filter set, admins see all events of this team.
  const visibility = actor.isAdmin && opts.teamId != null ? "1 = 1" : VISIBLE_SQL;
  // MATERIALIZED and CROSS JOIN: SQLite starts at the preselection instead of checking all events in the range
  return all<EventRow>(
    db,
    `WITH ${candidates}
     SELECT ${EVENT_COLUMNS}
       FROM ids CROSS JOIN events e ON e.id = ids.id${EVENT_JOINS}
      WHERE e.starts_at >= ?3 AND e.starts_at < ?4 AND ${visibility}${kindFilter}
      ORDER BY e.starts_at, e.id`,
    ...params,
  );
}

/**
 * Selection of the event overview: teams (null: all) and kinds (null: all). Club-wide events belong to every team; they
 * stay unless no team is selected.
 */
export interface EventListFilter {
  teamIds: number[] | null;
  kinds: EventKind[] | null;
  /** Training groups: their special events count as trainings for `kinds` (docs/dev/decisions.md, "Training groups") */
  trainingGroups?: number[];
}

/** SQL conditions on `e` for a filter, its values appended to params. Empty without a filter. */
export function listFilterSql(filter: EventListFilter | undefined, params: (string | number)[]): string {
  let sql = "";
  if (filter?.teamIds) {
    params.push(list(filter.teamIds));
    sql += ` AND (e.club_wide = 1 OR EXISTS (SELECT 1 FROM event_teams ft WHERE ft.event_id = e.id AND ft.team_id IN (SELECT value FROM json_each(?${params.length}))))`;
  }
  if (filter?.kinds) {
    params.push(list(filter.kinds));
    let kinds = `e.kind IN (SELECT value FROM json_each(?${params.length}))`;
    // Special events of training groups move from "other" to "training"; without training groups the query stays as it was
    const training = filter.kinds.includes("training");
    if (filter.trainingGroups?.length && training !== filter.kinds.includes("special")) {
      params.push(list(filter.trainingGroups));
      const group = `e.kind = 'special' AND EXISTS (SELECT 1 FROM event_teams tg WHERE tg.event_id = e.id AND tg.team_id IN (SELECT value FROM json_each(?${params.length})))`;
      kinds = training ? `(${kinds} OR (${group}))` : `${kinds} AND NOT (${group})`;
    }
    sql += ` AND ${kinds}`;
  }
  return sql;
}

/** Does an event fit the filter (the same rule as listFilterSql, for events loaded another way)? */
export function fitsListFilter(
  s: { kind: EventKind; asTraining?: boolean; clubWide: boolean; teams: { id: number }[] },
  filter: EventListFilter | undefined,
): boolean {
  if (filter?.kinds && !filter.kinds.includes(s.asTraining ? "training" : s.kind)) return false;
  return !filter?.teamIds || s.clubWide || s.teams.some((t) => filter.teamIds!.includes(t.id));
}

export interface EventCursor {
  startsAt: string;
  id: number;
}

/**
 * The next section of visible events for loading page by page: the preselection is first
 * sorted by date and limited, then checked. So the check only applies to `size` events,
 * not to the whole season. `last` is the last checked event (even if it was not visible),
 * `done`: nothing comes after it.
 */
export async function visibleEventBatch(
  db: D1Database,
  actor: Actor,
  opts: { from: string; to: string; size: number; desc?: boolean; after?: EventCursor | null; filter?: EventListFilter },
): Promise<{ rows: EventRow[]; last: EventCursor | null; done: boolean }> {
  const params: (string | number)[] = [...visibilityParams(actor), opts.from, opts.to];
  let cursor = "";
  if (opts.after) {
    params.push(opts.after.startsAt, opts.after.id);
    cursor = ` AND (e.starts_at, e.id) ${opts.desc ? "<" : ">"} (?${params.length - 1}, ?${params.length})`;
  }
  cursor += listFilterSql(opts.filter, params);
  params.push(opts.size);
  const dir = opts.desc ? " DESC" : "";
  const rows = await all<EventRow & { visible: number }>(
    db,
    `WITH ${CANDIDATES_CTE},
       batch(id) AS MATERIALIZED (
         SELECT e.id FROM ids CROSS JOIN events e ON e.id = ids.id
          WHERE e.starts_at >= ?3 AND e.starts_at < ?4${cursor}
          ORDER BY e.starts_at${dir}, e.id${dir} LIMIT ?${params.length})
     SELECT ${EVENT_COLUMNS}, ${VISIBLE_SQL} AS visible
       FROM batch CROSS JOIN events e ON e.id = batch.id${EVENT_JOINS}
      ORDER BY e.starts_at${dir}, e.id${dir}`,
    ...params,
  );
  const last = rows.at(-1);
  return {
    rows: rows.filter((r) => r.visible === 1).map(({ visible: _, ...r }) => r as EventRow),
    last: last ? { startsAt: last.starts_at, id: last.id } : (opts.after ?? null),
    done: rows.length < opts.size,
  };
}

/** Merges contexts of several sections (keys are event or team IDs). */
export function mergeContexts(a: EventContext, b: EventContext): EventContext {
  return {
    teams: new Map([...a.teams, ...b.teams]),
    eventTeams: new Map([...a.eventTeams, ...b.eventTeams]),
    participants: new Map([...a.participants, ...b.participants]),
    members: new Map([...a.members, ...b.members]),
    nominations: new Map([...a.nominations, ...b.nominations]),
    helpRequests: new Map([...a.helpRequests, ...b.helpRequests]),
    guardianOf: new Set([...a.guardianOf, ...b.guardianOf]),
    marks: new Map([...a.marks, ...b.marks]),
    optional: new Set([...a.optional, ...b.optional]),
    leaderAbsences: new Map([...a.leaderAbsences, ...b.leaderAbsences]),
    families: new Map([...a.families, ...b.families]),
  };
}

export async function loadVisibleEvent(db: D1Database, actor: Actor, eventId: number): Promise<EventRow | null> {
  const rows = await all<EventRow>(
    db,
    `${EVENT_SELECT} WHERE e.id = ?3 AND (?4 = 1 OR ${VISIBLE_SQL}
        OR EXISTS (SELECT 1 FROM event_teams ct JOIN team_memberships cm ON cm.team_id = ct.team_id
                    WHERE ct.event_id = e.id AND cm.person_id = ?5 AND cm.role = 'coach'))`,
    ...visibilityParams(actor),
    eventId,
    actor.isAdmin ? 1 : 0,
    actor.personId,
  );
  return rows[0] ?? null;
}

export async function loadEvent(db: D1Database, eventId: number): Promise<EventRow | null> {
  const rows = await all<EventRow>(db, `${EVENT_SELECT} WHERE e.id = ?`, eventId);
  return rows[0] ?? null;
}
