// Shared types for API responses (worker and frontend).
import { t } from "@lingui/core/macro";

/** staff: team staff such as physio or manager, sees everything of the team but does not take part. */
export type Role = "player" | "coach" | "helper" | "staff";

export interface TeamRef {
  id: number;
  name: string;
}

export interface PersonRef {
  id: number;
  firstName: string;
  lastName: string | null;
}

export type ChildPermission = "may_accept" | "may_decline" | "may_read_chat" | "may_write_chat" | "may_answer_help";

export type ChildPermissions = Record<ChildPermission, boolean>;

export const childPermissionLabels = (): Record<ChildPermission, string> => ({
  may_accept: t`Withdraw declines on their own`,
  may_decline: t`Decline on their own`,
  may_read_chat: t`Read chat`,
  may_write_chat: t`Write in chat`,
  may_answer_help: t`Answer stand-in requests on their own`,
});

export type NotificationTopic = "events" | "reminders" | "squad" | "responses" | "chat" | "mentions" | "coach" | "carpool";

export const notificationTopicLabels = (): Record<NotificationTopic, string> => ({
  events: t`New, changed and cancelled events`,
  reminders: t`Reminders about pending responses`,
  squad: t`Nominations, reminders before games and stand-in requests`,
  responses: t`Responses by parents or child`,
  chat: t`Chat messages`,
  mentions: t`Mentions in the chat (@name)`,
  coach: t`Coach notes (short-notice declines, stand-ins)`,
  carpool: t`Carpools (passengers, free seats)`,
});

export interface Me {
  accountId: number;
  person: PersonRef & { isAdmin: boolean };
  isAdmin: boolean;
  /**
   * Linked children, without the own person. parentsInCharge: parents are involved in at least
   * one of the child's teams.
   */
  children: (PersonRef & { teams: (TeamRef & { parentsEnabled: boolean })[]; parentsInCharge: boolean })[];
  /** Own team memberships. */
  memberships: (TeamRef & { role: Role; parentsEnabled: boolean })[];
  /** Teams this account may manage (coaches; admins: all). */
  manageableTeams: TeamRef[];
  /** Child with linked parents. */
  hasGuardians: boolean;
  /** The parents' permissions apply (parents are involved in at least one own team). */
  parentsInCharge: boolean;
  permissions: ChildPermissions;
  vapidPublicKey: string | null;
  /** Teams with a helper plan where this person can help or manage it ("Helfer" tab); own ones first. */
  helperTeams: (TeamRef & { own: boolean })[];
  /** Admins only: current view (player, parent, coach), otherwise null. */
  viewAs: { mode: "player" | "parent" | "trainer" | "referee"; readOnly: boolean } | null;
  /** May take on KiHaSL/JuHaSL duties (personally or for a child). */
  referee: boolean;
  /** IDs of all groups (chat and special events only, see docs/design.md, Groups). */
  groupIds: number[];
  /** Admins with a coach role only: admin/coach switch in the profile (coachMode = currently working as coach). */
  adminSwitch: { coachMode: boolean } | null;
  /** Language chosen on the account; null: the app's language or the club default. */
  locale: import("./i18n").Locale | null;
}

export type SessionResponse = { authenticated: false } | { authenticated: true; me: Me };

export interface LocationRef {
  id: number;
  name: string;
  address: string | null;
  mapUrl: string | null;
  kind: "hall" | "custom" | "external";
}

export type EventKind = "training" | "game" | "special";

/** Effective status of a person for an event. */
export type ParticipationStatus = "yes" | "no" | "open" | "standing" | "inactive";

export type RespondedBy = "self" | "guardian" | "child" | "other";

export interface MyParticipation {
  person: PersonRef;
  /** false for games without nomination. */
  participant: boolean;
  nominated: boolean;
  isHelper: boolean;
  /** Optional training for this person: no automatic acceptance, accepting is voluntary. */
  optional: boolean;
  status: ParticipationStatus | null;
  reason: string | null;
  isLate: boolean;
  respondedAt: string | null;
  respondedBy: RespondedBy | null;
  respondedByName: string | null;
  /** Marked by the coach after the event as "absent without excuse" */
  unexcused: boolean;
  /** Action allowed for this account (parental permissions, inactivity, event over). */
  canAccept: boolean;
  canDecline: boolean;
  blockedReason: string | null;
  helpRequest: { id: number; status: "open" | "accepted" | "declined" | "withdrawn"; teamName: string; canAnswer: boolean } | null;
}

export interface EventCounts {
  yes: number;
  no: number;
  open: number;
  standing: number;
  inactive: number;
  /** Optional participants who have not accepted (not counted as open or declined). */
  optional: number;
}

/**
 * One page of the event list (GET /events?limit=…). `events` in date order, past events newest
 * first. `live`: games that have already started today. `next`: the next own event for the big
 * card (with others on the same day) if it lies beyond the page. `openHelp`: events with an open
 * stand-in request, also beyond the page. `trainingsUntil`: trainings are generated up to this
 * day, after that only games and special events follow.
 */
export interface EventPage {
  events: EventSummary[];
  hasMore: boolean;
  live: EventSummary[];
  next: EventSummary[];
  openHelp: EventSummary[];
  trainingsUntil: string | null;
  /** Holiday plans and training breaks of the own teams (and the children's) that are not over yet. */
  breaks: TrainingBreak[];
}

/**
 * A holiday plan of one or more teams in the timeline. `training`: the plan has training times
 * (other times than usual); without, it is a training break.
 */
export interface TrainingBreak {
  name: string;
  startsOn: string;
  endsOn: string;
  training: boolean;
  teams: string[];
}

export interface EventSummary {
  id: number;
  kind: EventKind;
  title: string;
  startsAt: string;
  endsAt: string | null;
  location: LocationRef | null;
  teams: TeamRef[];
  /** Teams for which this training is optional ("together with"). */
  optionalTeamIds: number[];
  clubWide: boolean;
  cancelled: { at: string; byName: string | null; reason: string | null } | null;
  notes: string | null;
  deadline: string | null; // local time
  deadlineHours: number;
  isPast: boolean;
  counts: EventCounts | null;
  mine: MyParticipation[];
  canManage: boolean;
  game: GameInfo | null;
  isDetached: boolean;
  ruleId: number | null;
  /** Own duties in the helper plan and those for the own children. */
  myDuties: MyDuty[];
  /** Creator or organiser of this special event (manages the helper duties). */
  organizing: boolean;
  /** Staff of one of the event's teams: sees the event and who takes part, without responding. */
  staff: boolean;
  /** Carpool summary (only upcoming away games with entries, only for those involved): taken/offered seats, people searching without a seat. */
  carpoolCount: { taken: number; seats: number; waiting: number } | null;
  /** Free helper slots one could take on (or for the child); 0 = none or already signed up. */
  helpersNeeded: number;
  /** "Absent without excuse" at this event, only for coaches and admins (otherwise 0). */
  unexcusedCount: number;
}

export interface MyDuty {
  dutyTypeId: number;
  /** KiHaSL/JuHaSL duty (own overview in the "Helfer" tab) */
  referee: boolean;
  label: string;
  /** First name of the child if someone else took on the duty for my child */
  child: string | null;
  mine: boolean;
}

export interface GameInfo {
  homeTeam: string | null;
  guestTeam: string | null;
  isHome: boolean | null;
  homeGoals: number | null;
  guestGoals: number | null;
  gameNo: string | null;
  meetingPoint: string | null;
  meetingTime: string | null;
  coachNotes: string | null;
  squadPublished: boolean;
  nominatedCount: number;
  /** League table at handball4all if a schedule is set up. */
  tableUrl: string | null;
  /** Game ID at handball4all (imported games only). */
  h4aGameId: string | null;
  /** The team's schedule fetch URL; only when tapping "Liveticker", to read the ticker token. */
  liveUrl: string | null;
  /** For this many minutes after throw-off the game counts as "in progress", after that there is the game report. */
  liveMinutes: number;
}

export interface ParticipantDetail {
  person: PersonRef;
  teamId: number;
  /** All of the person's teams involved (players in two teams) */
  teamIds: number[];
  isHelper: boolean;
  /** Takes part optionally (joint training of another team) */
  optional: boolean;
  status: ParticipationStatus;
  reason: string | null;
  isLate: boolean;
  respondedAt: string | null;
  respondedBy: RespondedBy | null;
  respondedByName: string | null;
  hasStandingAbsence: boolean;
  /** "Absent without excuse" (marked by the coach after the start) */
  unexcused: boolean;
}

export interface EventDetail extends EventSummary {
  /** Coaches and admins only. */
  participants: ParticipantDetail[] | null;
  /** Only if the team has turned on "responses visible to all" (without reasons), otherwise null. */
  roster: RosterEntry[] | null;
  /** May manage this event's helper duties (coaches, admins, creator, organisers). */
  dutyManage: boolean;
  /** Special events only: creator and organisers ("First name L."). */
  organizers: { creator: { id: number; name: string } | null; people: { id: number; name: string }[]; editable: boolean } | null;
  /** Away games only and only for those involved (nominated players, their parents, coaches), otherwise null. */
  carpool: CarpoolInfo | null;
}

/** Search for a ride for a player; seats needed = 1 + companions. */
export interface CarpoolRequest {
  id: number;
  playerId: number;
  /** "First name L." */
  name: string;
  companions: number;
  seats: number;
  /** Booked with this offer, null = still searching */
  offerId: number | null;
  /** Own player or own child */
  mine: boolean;
  canEdit: boolean;
}

export interface CarpoolOffer {
  id: number;
  personId: number;
  /** "First name L." of the driver */
  name: string;
  seats: number;
  free: number;
  riders: CarpoolRequest[];
  /** Own offer */
  mine: boolean;
  canEdit: boolean;
}

export interface CarpoolPersonRef {
  id: number;
  name: string;
}

/** Who can ride along: nominated players and the coaches (coach). */
export interface CarpoolRider extends CarpoolPersonRef {
  coach: boolean;
  /** Parents ("First name L.") as possible companions; only for the own family and for coaches */
  guardians: CarpoolPersonRef[];
}

export interface CarpoolInfo {
  /** Sign-up possible (game not cancelled and not started yet). */
  open: boolean;
  offers: CarpoolOffer[];
  /** People searching without a seat */
  waiting: CarpoolRequest[];
  /** Riders one searches for (own person, children), with their search */
  mine: { player: CarpoolRider & { self: boolean }; request: CarpoolRequest | null }[];
  /** The own person may offer to drive (no offer yet, family is not searching). */
  canOffer: boolean;
  /** Coaches and admins: sign up others. */
  coach: { drivers: CarpoolPersonRef[]; riders: CarpoolRider[] } | null;
}

export interface RosterEntry {
  personId: number;
  /** "First name L." */
  name: string;
  status: ParticipationStatus;
}

export interface ApiErrorBody {
  error: { code: string; message: string };
}
