import { t } from "@lingui/core/macro";
import { matchdayHost, splitRef, teamScheduleUrl, teamTableUrl } from "./fixtures";
import type {
  EventCounts,
  EventDetail,
  EventSummary,
  GameInfo,
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
import { ownClubAbbr } from "./club";
import { addDays, localToInstant, toLocal } from "../lib/time";
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

const EVENT_COLUMNS = `e.*, l.name AS loc_name, l.address AS loc_address, l.map_url AS loc_map_url, l.kind AS loc_kind,
         tp.decline_hours AS plan_decline_hours,
         cp.first_name AS cancelled_by_first, cp.last_name AS cancelled_by_last`;

const EVENT_JOINS = `
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
  /** Playing time of the age class (current season), 120 if unknown. */
  game_minutes: number;
  decline_hours_training: number;
  decline_hours_game: number;
  max_squad: number;
  auto_squad: number;
  fixture_connector: string | null;
  fixture_source: string | null;
  show_responses: number;
}

interface MemberRow {
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

/** Loads everything needed for status, counts and permissions of a list of events. */
export async function loadEventContext(db: D1Database, events: EventRow[]): Promise<EventContext> {
  const ids = events.map((e) => e.id);
  const ruleIds = [...new Set(events.map((e) => e.rule_id).filter((r): r is number => r != null))];
  const hasClubWide = events.some((e) => e.club_wide === 1);

  const [teamRows, responses, nominations, helps, markRows, absenceRows] = await db.batch([
    db
      .prepare(
        `SELECT et.event_id, et.optional AS et_optional, t.id, t.name, t.age_class_code, COALESCE(ac.game_minutes, 120) AS game_minutes, t.decline_hours_training,
                t.decline_hours_game, t.max_squad, t.auto_squad, t.fixture_connector, t.fixture_source, t.show_responses
           FROM event_teams et JOIN teams t ON t.id = et.team_id
           ${CURRENT_AGE_CLASS_JOIN("t", "ac")}
          WHERE et.event_id IN (SELECT value FROM json_each(?)) ORDER BY t.name`,
      )
      .bind(list(ids)),
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
  for (const { et_optional, ...r } of teamRows!.results as (TeamInfo & { event_id: number; et_optional: number })[]) {
    teams.set(r.id, r);
    push(eventTeams, r.event_id, r.id);
    if (et_optional === 1) optional.add(`${r.event_id}:${r.id}`);
  }
  const teamIds = [...teams.keys()];

  const [members, allPlayers, standing] = await db.batch([
    db
      .prepare(
        `SELECT tm.team_id, tm.person_id, tm.role, tm.helper_trainings, p.first_name, p.last_name, p.is_active
           FROM team_memberships tm JOIN persons p ON p.id = tm.person_id
          WHERE tm.team_id IN (SELECT value FROM json_each(?)) AND tm.role IN ('player', 'helper') AND p.is_former = 0
          ORDER BY p.first_name, p.last_name, p.id`,
      )
      .bind(list(teamIds)),
    db
      .prepare(
        `SELECT tm.team_id, tm.person_id, tm.role, tm.helper_trainings, p.first_name, p.last_name, p.is_active
           FROM team_memberships tm JOIN persons p ON p.id = tm.person_id
          WHERE ? = 1 AND tm.role = 'player' AND p.is_former = 0
          ORDER BY p.first_name, p.last_name, p.id`,
      )
      .bind(hasClubWide ? 1 : 0),
    db
      .prepare(
        `SELECT person_id, rule_id, valid_from, valid_to FROM standing_absences
          WHERE rule_id IN (SELECT value FROM json_each(?))`,
      )
      .bind(list(ruleIds)),
  ]);

  const memberRows = members!.results as MemberRow[];
  const allPlayerRows = allPlayers!.results as MemberRow[];
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
  for (const s of standing!.results as StandingRow[]) push(standingByRule, s.rule_id, s);

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

    const resp = responsesByEvent.get(e.id) ?? new Map<number, ResponseRow>();
    const standingRows = e.kind === "training" && e.rule_id != null ? (standingByRule.get(e.rule_id) ?? []) : [];
    const list: Participant[] = [];

    const add = (personId: number, first: string, last: string | null, isActive: number, teamId: number, isHelper: boolean) => {
      const response = resp.get(personId) ?? null;
      const hasStanding = standingRows.some((s) => s.person_id === personId && standingApplies(s, e));
      // Optional only if every team of the person at this training joins optionally
      const ownTeams = memberTeams.get(personId) ?? [teamId];
      const isOptional = e.kind === "training" && ownTeams.every((t) => optional.has(`${e.id}:${t}`));
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
        optional: isOptional,
        isActive: isActive === 1,
        status,
        response,
        hasStandingAbsence: hasStanding,
      });
    };

    if (e.kind === "game") {
      for (const n of nominationsByEvent.get(e.id)?.values() ?? []) {
        const m = evMembers.get(n.person_id);
        add(n.person_id, n.first_name, n.last_name, n.is_active, m?.team_id ?? evTeams[0] ?? 0, n.is_helper === 1 || m?.role === "helper");
      }
    } else {
      for (const m of evMembers.values()) {
        add(m.person_id, m.first_name, m.last_name, m.is_active, m.team_id, m.role === "helper");
      }
    }
    participants.set(e.id, list);
  }

  // Who is a parent of whom? For "declined by parent".
  const guardianRows = personIds.size
    ? await all<{ guardian_id: number; child_id: number }>(
        db,
        "SELECT guardian_id, child_id FROM guardianships WHERE child_id IN (SELECT value FROM json_each(?))",
        list([...personIds]),
      )
    : [];

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
  };
}

/** Imported game: the connector, the game's id at the source and what the team's connector fetches. */
function gameSource(e: EventRow, teams: TeamInfo[]): GameInfo["source"] {
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
function gameTable(teams: TeamInfo[]): GameInfo["table"] {
  for (const team of teams) {
    const table = teamTableUrl(team);
    if (table) return table;
  }
  return null;
}

export function eventTeams(e: EventRow, ctx: EventContext): TeamInfo[] {
  return (ctx.eventTeams.get(e.id) ?? []).map((id) => ctx.teams.get(id)!).filter(Boolean);
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

export function countsOf(list: Participant[]): EventCounts {
  const c: EventCounts = { yes: 0, no: 0, open: 0, standing: 0, inactive: 0, optional: 0 };
  for (const p of list) {
    // Optional participants count once they accept; otherwise they are neither open nor declined
    if (p.optional && p.status !== "yes" && p.status !== "inactive") c.optional++;
    else c[p.status]++;
  }
  return c;
}

export function isPast(e: EventRow, now: number): boolean {
  return localToInstant(e.starts_at) <= now;
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
      nominated: e.kind === "game" ? !!part : false,
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
  const showCounts = e.kind !== "game" || e.squad_published_at != null;
  const canManage = e.club_wide === 1 ? actor.isAdmin : isCoachOfAny(actor, teams.map((t) => t.id));
  return {
    id: e.id,
    kind: e.kind,
    title: eventTitle(e, teamRefs),
    startsAt: e.starts_at,
    endsAt: e.ends_at,
    location:
      e.location_id != null && e.loc_name
        ? { id: e.location_id, name: e.loc_name, address: e.loc_address, mapUrl: e.loc_map_url, kind: e.loc_kind ?? "custom" }
        : null,
    teams: teamRefs,
    optionalTeamIds: teamRefs.filter((tm) => ctx.optional.has(`${e.id}:${tm.id}`)).map((tm) => tm.id),
    clubWide: e.club_wide === 1,
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
    counts: showCounts ? countsOf(parts) : null,
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
            nominatedCount: parts.length,
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
    roster,
    dutyManage: false,
    organizers: null,
    leaders: [],
    attendanceUntil: summary.canManage ? attendanceUntil(e, actor) : null,
    attendanceEditable: summary.canManage && attendanceEditable(e, actor, now),
  };
}

/** SQL: the person (expression) takes part in event e, is nominated, requested or referees there as youth referee. */
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
    OR EXISTS (SELECT 1 FROM duties dd JOIN duty_types ddt ON ddt.id = dd.duty_type_id AND ddt.who_referees = 1 WHERE dd.event_id = e.id AND dd.person_id = ${person})
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
  opts: { from: string; to: string; size: number; desc?: boolean; after?: EventCursor | null },
): Promise<{ rows: EventRow[]; last: EventCursor | null; done: boolean }> {
  const params: (string | number)[] = [...visibilityParams(actor), opts.from, opts.to];
  let cursor = "";
  if (opts.after) {
    params.push(opts.after.startsAt, opts.after.id);
    cursor = ` AND (e.starts_at, e.id) ${opts.desc ? "<" : ">"} (?${params.length - 1}, ?${params.length})`;
  }
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
