// Gemeinsame Typen für API-Antworten (Worker und Frontend).

export type Role = "player" | "coach" | "helper";

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

export const CHILD_PERMISSION_LABELS: Record<ChildPermission, string> = {
  may_accept: "Absagen selbst zurücknehmen",
  may_decline: "Selbst absagen",
  may_read_chat: "Chat lesen",
  may_write_chat: "Chat schreiben",
  may_answer_help: "Aushilfe-Anfragen selbst beantworten",
};

export type NotificationTopic = "events" | "reminders" | "squad" | "responses" | "chat" | "mentions" | "coach" | "carpool";

export const NOTIFICATION_TOPIC_LABELS: Record<NotificationTopic, string> = {
  events: "Neue, geänderte und abgesagte Termine",
  reminders: "Erinnerungen an offene Rückmeldungen",
  squad: "Nominierungen, Erinnerungen vor Spielen und Aushilfe-Anfragen",
  responses: "Rückmeldungen durch Eltern bzw. Kind",
  chat: "Chatnachrichten",
  mentions: "Erwähnungen im Chat (@Name)",
  coach: "Trainer-Hinweise (kurzfristige Absagen, Aushilfen)",
  carpool: "Fahrgemeinschaften (Mitfahrer, freie Plätze)",
};

export interface Me {
  accountId: number;
  person: PersonRef & { isAdmin: boolean };
  isAdmin: boolean;
  /**
   * Verknüpfte Kinder, ohne die eigene Person. parentsInCharge: In mindestens
   * einer Mannschaft des Kindes sind Eltern eingebunden.
   */
  children: (PersonRef & { teams: (TeamRef & { parentsEnabled: boolean })[]; parentsInCharge: boolean })[];
  /** Eigene Mannschaftszugehörigkeiten. */
  memberships: (TeamRef & { role: Role; parentsEnabled: boolean })[];
  /** Mannschaften, die dieser Account verwalten darf (Trainer; Admins: alle). */
  manageableTeams: TeamRef[];
  /** Kind mit verknüpften Eltern. */
  hasGuardians: boolean;
  /** Die Freigaben der Eltern gelten (in mindestens einer eigenen Mannschaft sind Eltern eingebunden). */
  parentsInCharge: boolean;
  permissions: ChildPermissions;
  vapidPublicKey: string | null;
  /** Mannschaften mit Helferplan, bei denen diese Person helfen oder ihn verwalten kann (Reiter "Helfer"); eigene (own) zuerst. */
  helperTeams: (TeamRef & { own: boolean })[];
  /** Nur Admins: aktuelle Sicht (Spieler, Elternteil, Trainer), sonst null. */
  viewAs: { mode: "player" | "parent" | "trainer" | "referee"; readOnly: boolean } | null;
  /** Darf (selbst oder für ein Kind) KiHaSL/JuHaSL-Dienste übernehmen. */
  referee: boolean;
  /** IDs aller Gruppen (nur Chat und Sondertermine, siehe docs/entscheidungen.md, Abschnitt Gruppen). */
  groupIds: number[];
  /** Nur Admins mit Trainerrolle: Umschalter Admin/Trainer im Profil (coachMode = arbeitet gerade als Trainer). */
  adminSwitch: { coachMode: boolean } | null;
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

/** Wirksamer Status einer Person bei einem Termin. */
export type ParticipationStatus = "yes" | "no" | "open" | "standing" | "inactive";

export type RespondedBy = "self" | "guardian" | "child" | "other";

export interface MyParticipation {
  person: PersonRef;
  /** false bei Spielen ohne Nominierung. */
  participant: boolean;
  nominated: boolean;
  isHelper: boolean;
  status: ParticipationStatus | null;
  reason: string | null;
  isLate: boolean;
  respondedAt: string | null;
  respondedBy: RespondedBy | null;
  respondedByName: string | null;
  /** Vom Trainer nach dem Termin als „fehlt unentschuldigt“ markiert */
  unexcused: boolean;
  /** Aktion für diesen Account erlaubt (Elternfreigaben, Inaktivität, Termin vorbei). */
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
}

/**
 * Eine Seite der Terminübersicht (GET /events?limit=…). `events` in Datumsreihenfolge, bei
 * vergangenen Terminen neueste zuerst. `live`: heute schon angepfiffene Spiele. `next`: der nächste
 * eigene Termin für die große Karte (mit weiteren am selben Tag), wenn er hinter der Seite liegt.
 * `openHelp`: Termine mit offener Aushilfe-Anfrage, auch jenseits der Seite. `trainingsUntil`: bis
 * zu diesem Tag sind Trainings erzeugt, danach folgen nur Spiele und Sondertermine.
 */
export interface EventPage {
  events: EventSummary[];
  hasMore: boolean;
  live: EventSummary[];
  next: EventSummary[];
  openHelp: EventSummary[];
  trainingsUntil: string | null;
}

export interface EventSummary {
  id: number;
  kind: EventKind;
  title: string;
  startsAt: string;
  endsAt: string | null;
  location: LocationRef | null;
  teams: TeamRef[];
  clubWide: boolean;
  cancelled: { at: string; byName: string | null; reason: string | null } | null;
  notes: string | null;
  deadline: string | null; // lokale Zeit
  deadlineHours: number;
  isPast: boolean;
  counts: EventCounts | null;
  mine: MyParticipation[];
  canManage: boolean;
  game: GameInfo | null;
  isDetached: boolean;
  ruleId: number | null;
  /** Eigene Dienste im Helferplan und die für die eigenen Kinder. */
  myDuties: MyDuty[];
  /** Ersteller oder Organisator dieses Sondertermins (verwaltet die Helferdienste). */
  organizing: boolean;
  /** Fahrgemeinschaften kurz (nur kommende Auswärtsspiele mit Einträgen, nur für Beteiligte): belegte/angebotene Plätze, Suchende ohne Platz. */
  carpoolCount: { taken: number; seats: number; waiting: number } | null;
  /** Freie Helferplätze, die man selbst (bzw. für das Kind) übernehmen könnte; 0 = keine oder schon eingetragen. */
  helpersNeeded: number;
  /** „Fehlt unentschuldigt“ bei diesem Termin, nur für Trainer und Admins (sonst 0). */
  unexcusedCount: number;
}

export interface MyDuty {
  dutyTypeId: number;
  /** KiHaSL/JuHaSL-Dienst (eigene Übersicht im Reiter Helfer) */
  referee: boolean;
  label: string;
  /** Vorname des Kindes, wenn ein anderer den Dienst für mein Kind übernommen hat */
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
  /** Ligatabelle bei handball4all, falls ein Spielplan hinterlegt ist. */
  tableUrl: string | null;
  /** Spiel-ID bei handball4all (nur importierte Spiele). */
  h4aGameId: string | null;
  /** Spielplan-Abruf der Mannschaft; nur beim Antippen von „Liveticker“, um den Ticker-Token zu lesen. */
  liveUrl: string | null;
  /** So viele Minuten nach Anpfiff gilt das Spiel als „läuft gerade“, danach gibt es den Spielbericht. */
  liveMinutes: number;
}

export interface ParticipantDetail {
  person: PersonRef;
  teamId: number;
  /** Alle beteiligten Mannschaften der Person (Spieler in zwei Mannschaften) */
  teamIds: number[];
  isHelper: boolean;
  status: ParticipationStatus;
  reason: string | null;
  isLate: boolean;
  respondedAt: string | null;
  respondedBy: RespondedBy | null;
  respondedByName: string | null;
  hasStandingAbsence: boolean;
  /** „Fehlt unentschuldigt“ (nach Beginn vom Trainer markiert) */
  unexcused: boolean;
}

export interface EventDetail extends EventSummary {
  /** Nur für Trainer und Admins. */
  participants: ParticipantDetail[] | null;
  /** Nur wenn die Mannschaft „Rückmeldungen für alle sichtbar“ eingeschaltet hat (ohne Gründe), sonst null. */
  roster: RosterEntry[] | null;
  /** Helferdienste dieses Termins verwalten (Trainer, Admins, Ersteller, Organisatoren). */
  dutyManage: boolean;
  /** Nur bei Sonderterminen: Ersteller und Organisatoren („Vorname N.“). */
  organizers: { creator: { id: number; name: string } | null; people: { id: number; name: string }[]; editable: boolean } | null;
  /** Nur bei Auswärtsspielen und nur für Beteiligte (Nominierte, ihre Eltern, Trainer), sonst null. */
  carpool: CarpoolInfo | null;
}

/** Suche nach einer Mitfahrgelegenheit für einen Spieler; Platzbedarf = 1 + Begleitpersonen. */
export interface CarpoolRequest {
  id: number;
  playerId: number;
  /** „Vorname N.“ */
  name: string;
  companions: number;
  seats: number;
  /** Gebucht bei diesem Angebot, null = sucht noch */
  offerId: number | null;
  /** Eigener Spieler bzw. eigenes Kind */
  mine: boolean;
  canEdit: boolean;
}

export interface CarpoolOffer {
  id: number;
  personId: number;
  /** „Vorname N.“ des Fahrers */
  name: string;
  seats: number;
  free: number;
  riders: CarpoolRequest[];
  /** Eigenes Angebot */
  mine: boolean;
  canEdit: boolean;
}

export interface CarpoolPersonRef {
  id: number;
  name: string;
}

/** Wer mitfahren kann: Nominierte und die Trainer (coach). */
export interface CarpoolRider extends CarpoolPersonRef {
  coach: boolean;
  /** Eltern („Vorname N.“) als mögliche Begleitung; nur für die eigene Familie und für Trainer */
  guardians: CarpoolPersonRef[];
}

export interface CarpoolInfo {
  /** Eintragen möglich (Spiel nicht abgesagt und noch nicht begonnen). */
  open: boolean;
  offers: CarpoolOffer[];
  /** Suchende ohne Platz */
  waiting: CarpoolRequest[];
  /** Mitfahrer, für die man selbst sucht (eigene Person, Kinder), mit ihrer Suche */
  mine: { player: CarpoolRider & { self: boolean }; request: CarpoolRequest | null }[];
  /** Eigene Person darf als Fahrer anbieten (noch kein Angebot, Familie sucht nicht). */
  canOffer: boolean;
  /** Trainer und Admins: für andere eintragen. */
  coach: { drivers: CarpoolPersonRef[]; riders: CarpoolRider[] } | null;
}

export interface RosterEntry {
  personId: number;
  /** „Vorname N.“ */
  name: string;
  status: ParticipationStatus;
}

export interface ApiErrorBody {
  error: { code: string; message: string };
}
