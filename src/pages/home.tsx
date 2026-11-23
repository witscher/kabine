import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { clubName } from "../club";
import { type ComponentChildren, Fragment } from "preact";
import { useLocation } from "preact-iso";
import { useRef, useState } from "preact/hooks";
import type { EventPage, EventShow, EventSummary, MyParticipation, TrainingBreak } from "../../shared/types";
import { byStartTime, splitAtCard } from "../../shared/home-list";
import { DutyChips } from "../duties";
import { dayMonth, dayOfMonth, longDate, monthLabel, monthShort, relativeDay, timeRange, time, todayLocal, weekdayShort, joinNames } from "../format";
import { FirstStepsCard, InstallBanner, MotdBanner, PushPrompt } from "../howto";
import { Ball, Icon } from "../icons";
import { DeclineSheet, HelpRequestCard, PersonResponseRow, ResponseButtons } from "../respond";
import { GameBall, gameBallState, HomeTag } from "../game-ball";
import { useActiveModules } from "../modules";
import type { HomeListButton, HomeListPart, HomeListRow } from "../module-api";
import { CoachHints } from "../coach-hints";
import { NewsCard } from "../news";
import { useMe } from "../session";
import { useOffline } from "../offline";
import { useQuery } from "../store";
import { Button, CoachMark, Empty, ErrorBox, Segmented, StatusPill, useDocumentTitle } from "../ui";
import { isLiveWindow, LiveCard } from "../live";
import { isRelevantEvent } from "../../shared/relevance";
import { FamilyShort } from "../special-attendance";

const kindLabel = () => ({ training: t`Training`, game: t`Game`, special: t`Event` }) as const;

/** Note in the timeline: a holiday plan with other training times, or a training break. */
function BreakNote({ item }: { item: TrainingBreak }) {
  const name = item.name;
  const from = dayMonth(item.startsOn);
  const to = dayMonth(item.endsOn);
  const teams = joinNames(item.teams);
  const running = item.startsOn <= todayLocal();
  const text = item.training
    ? running
      ? t`${name} until ${to}: holiday training times for ${teams}.`
      : t`${name}, ${from} to ${to}: holiday training times for ${teams}.`
    : running
      ? t`${name} until ${to}: no training for ${teams}.`
      : t`${name}, ${from} to ${to}: no training for ${teams}.`;
  return (
    <p class="break-note" role="note">
      <Icon name="sun" size={18} />
      <span>{text}</span>
    </p>
  );
}

/** Card heading "Up next: game" or, for a further event on the same day, "Then: game". */
function nextHeading(kind: EventSummary["kind"], later: boolean): string {
  if (later) return kind === "game" ? t`Then: game` : kind === "training" ? t`Then: training` : t`Then: event`;
  return kind === "game" ? t`Up next: game` : kind === "training" ? t`Up next: training` : t`Up next: event`;
}

/** Lines of the active modules on an event card (e.g. carpools). */
function ModuleCardLines({ event }: { event: EventSummary }) {
  const modules = useActiveModules();
  return (
    <>
      {modules.map((m) => {
        const Line = m.eventCardLine;
        const data = event.modules[m.manifest.id];
        return Line && data != null ? <Line key={m.manifest.id} event={event} data={data} /> : null;
      })}
    </>
  );
}

/** Name the team(s) of the event when you deal with more than one team (your own or your children's). */
function useTeamLabel(): (e: EventSummary) => string {
  const me = useMe();
  const names = new Set([...me.memberships.map((m) => m.name), ...me.children.flatMap((c) => c.teams.map((t) => t.name))]);
  return (e) => (names.size > 1 && !e.clubWide ? e.teams.map((t) => t.name).join(" + ") : "");
}


const isToday = (startsAt: string) => startsAt.slice(0, 10) === todayLocal();

/** "today", "tomorrow" …; today as a pill with a calmly pulsing dot so the event stands out; while it runs "right now". */
function DayTag({ event }: { event: EventSummary }) {
  const label = event.isRunning ? t`right now` : relativeDay(event.startsAt);
  if (!event.isRunning && !isToday(event.startsAt)) return <span style={{ fontWeight: 600, fontSize: "14px" }}>{label}</span>;
  return (
    <span class="today-tag">
      <span class="today-dot" aria-hidden="true" />
      {label}
    </span>
  );
}

/**
 * Yellow head of the big event card: the whole head opens the event, not only the date. tabIndex -1: the date link stays
 * the keyboard target, no second tab stop. Today with a soft light sweep (off with reduced motion).
 */
function CardHead({ event, children }: { event: EventSummary; children: ComponentChildren }) {
  return (
    <a class={`card-head card-head-link ${isToday(event.startsAt) ? "is-today" : ""}`} href={`/termine/${event.id}`} tabIndex={-1}>
      {children}
      <DayTag event={event} />
    </a>
  );
}

/** later: a further event on the same day as the next one, also as a big card ("Then: game"). */
function NextCard({ event, onDecline, later = false }: { event: EventSummary; onDecline: (p: MyParticipation) => void; later?: boolean }) {
  const me = useMe();
  const mine = event.mine.filter((m) => m.participant || m.helpRequest);
  const single = mine.length === 1 && mine[0]!.person.id === me.person.id && !mine[0]!.helpRequest;
  const counts = event.counts;
  const teamLabel = useTeamLabel();
  const kind = kindLabel()[event.kind];
  const reason = single && mine[0]!.status === "no" ? mine[0]!.reason : null;
  return (
    <section class="card" aria-label={t`Next event: ${kind}`}>
      <CardHead event={event}>
        <span class="label">
          {nextHeading(event.kind, later)}
          {teamLabel(event) ? ` · ${teamLabel(event)}` : ""}
        </span>
      </CardHead>
      <div class={`card-body ${event.kind === "game" ? "has-ball" : ""}`}>
        {event.kind === "game" ? <Ball class="next-ball" /> : null}
        <a href={`/termine/${event.id}`} style={{ textDecoration: "none" }} class="stack-sm">
          <div class="next-date-line">
            <div class="big-date">{longDate(event.startsAt)}</div>
            {/* Games: the team after the date, the title without it (as in the game rows) */}
            {event.kind === "game" && event.teams.length ? <span class="team-badge next-team">{event.teams.map((t) => t.name).join(" + ")}</span> : null}
          </div>
          {event.kind !== "training" ? <div style={{ fontWeight: 700, fontSize: "17px" }}>{event.shortTitle}</div> : null}
        </a>
        <div class="meta-line">
          <span>
            <Icon name="clock" size={18} />
            {timeRange(event.startsAt, event.endsAt)}
          </span>
          {event.location ? (
            <span>
              <Icon name="pin" size={18} />
              {event.location.name}
            </span>
          ) : null}
        </div>
        <MeetingLine event={event} />
        <LeaderAbsentBadge event={event} />
        <DutyChips event={event} />
        <ModuleCardLines event={event} />
        {counts ? (
          <div class="stats">
            <div class="stat">
              <div class="n">{counts.yes}</div>
              <div class="l">
                <Trans>Attending</Trans>
              </div>
            </div>
            <div class="stat">
              <div class="n">{counts.no + counts.standing}</div>
              <div class="l">
                <Trans>Declines</Trans>
              </div>
            </div>
            <div class="stat">
              <div class="n">{counts.inactive}</div>
              <div class="l">
                <Trans>Inactive</Trans>
              </div>
            </div>
          </div>
        ) : null}
        {event.familyAttendance ? (
          <FamilyShort event={event} />
        ) : single ? (
          <>
            {mine[0]!.participant ? (
              <div class="row-gap">
                <StatusPill status={mine[0]!.status} late={mine[0]!.isLate} optional={mine[0]!.optional} />
              </div>
            ) : null}
            <ResponseButtons event={event} p={mine[0]!} onDecline={onDecline} />
            {reason ? (
              <p class="small muted">
                <Trans>Your reason: “{reason}”</Trans>
              </p>
            ) : null}
          </>
        ) : (
          mine.map((m) => <PersonResponseRow key={m.person.id} event={event} p={m} onDecline={onDecline} />)
        )}
      </div>
    </section>
  );
}

/** Games: meeting point and time; a hint for coaches as long as both are missing. */
function MeetingLine({ event }: { event: EventSummary }) {
  const g = event.game;
  if (event.kind !== "game" || !g || event.cancelled) return null;
  if (g.meetingTime || g.meetingPoint) {
    const meetingTime = g.meetingTime;
    return (
      <div class="meeting-line">
        <Icon name="users" size={18} />
        <span>
          {meetingTime ? t`Meet at ${meetingTime}` : t`Meet`}
          {g.meetingPoint ? ` · ${g.meetingPoint}` : ""}
        </span>
      </div>
    );
  }
  return event.canManage ? (
    <a class="meeting-line missing" href={`/termine/${event.id}`}>
      <Icon name="alert" size={18} />
      <span>
        <Trans>Meeting point and time not entered yet</Trans>
      </span>
    </a>
  ) : null;
}

/** For coaches: next event of their teams with the state of responses. */
function CoachNextCard({ event, later = false }: { event: EventSummary; later?: boolean }) {
  const c = event.counts!;
  return (
    <section class="card" aria-label={t`Your team's next event`}>
      <CardHead event={event}>
        <span class="label">
          {nextHeading(event.kind, later)} ·{" "}
          <span class="nocaps">{event.teams.map((t) => t.name).join(" + ")}</span>
        </span>
      </CardHead>
      <div class={`card-body ${event.kind === "game" ? "has-ball" : ""}`}>
        {event.kind === "game" ? <Ball class="next-ball" /> : null}
        <div class="big-date">{longDate(event.startsAt)}</div>
        <div class="meta-line">
          <span>
            <Icon name="clock" size={18} />
            {timeRange(event.startsAt, event.endsAt)}
          </span>
          {event.location ? (
            <span>
              <Icon name="pin" size={18} />
              {event.location.name}
            </span>
          ) : null}
        </div>
        <MeetingLine event={event} />
        <LeaderAbsentBadge event={event} />
        <div class="stat-tiles">
          <div class="stat-tile yellow">
            <div class="n">{c.yes}</div>
            <div class="l">
              <Trans>attending</Trans>
            </div>
          </div>
          <div class="stat-tile" style={{ background: "var(--bg)" }}>
            <div class="n">{c.no}</div>
            <div class="l">
              <Trans>declined</Trans>
            </div>
          </div>
          <div class="stat-tile" style={{ background: "var(--bg)" }}>
            <div class="n">{c.standing}</div>
            <div class="l">
              <Trans>absent</Trans>
            </div>
          </div>
          <div class="stat-tile dark">
            <div class="n">{c.inactive}</div>
            <div class="l">
              <Trans>inactive</Trans>
            </div>
          </div>
        </div>
        <a class="btn btn-coach" href={`/termine/${event.id}`}>
          <CoachMark />
          <Trans>Details and reminders</Trans>
        </a>
      </div>
    </section>
  );
}

function EventRow({ event }: { event: EventSummary }) {
  const me = useMe();
  const mine = event.mine.filter((m) => m.participant || m.helpRequest || event.kind === "game");
  const game = event.kind === "game";
  const cancelled = !!event.cancelled;
  const others = mine.filter((m) => m.person.id !== me.person.id);
  const self = mine.find((m) => m.person.id === me.person.id);
  const single = mine.length === 1 ? mine[0]! : null;
  const team = useTeamLabel()(event);
  const at = time(event.startsAt);
  // Games: the short title ("SVM 2 – Opponent"), the team sits in the ball
  const label =
    event.kind === "training" ? (team ? t`Training ${team} · ${at}` : t`Training · ${at}`) : game ? event.shortTitle : `${event.title} · ${time(event.startsAt)}`;
  const byName = event.cancelled?.byName;
  const names = others.map((o) => o.person.firstName).join(", ");
  const counts = event.counts;
  const yes = counts?.yes ?? 0;
  // Past events: who was really there
  const present = counts?.present ?? null;
  const total = counts ? counts.yes + counts.no + counts.open + counts.standing + counts.inactive : 0;
  return (
    <a href={`/termine/${event.id}`} class={`event-row ${game && !cancelled ? "dark" : ""} ${cancelled ? "cancelled" : ""}`}>
      <div class="date-block">
        <div class="wd">{weekdayShort(event.startsAt)}</div>
        <div class="d">{dayOfMonth(event.startsAt)}</div>
        <div class="mo">{monthShort(event.startsAt)}</div>
      </div>
      <div class="main">
        <div class="title">
          {game && event.game?.isHome ? <HomeTag /> : null}
          {label}
        </div>
        {cancelled ? (
          <div class="sub">
            <span class="cancel-tag">
              <Trans>Not taking place</Trans>
            </span>
            {byName ? t`by ${byName}` : ""}
            {event.cancelled!.reason ? `${event.cancelled!.byName ? ": " : ""}${event.cancelled!.reason}` : ""}
          </div>
        ) : (
          <div class="sub">
            {game ? `${time(event.startsAt)} · ` : ""}
            {event.location?.name ?? t`Location to follow`}
            {event.teams.length > 1 && !team && !game ? ` · ${event.teams.map((t) => t.name).join(" + ")}` : ""}
          </div>
        )}
        {!cancelled ? <DutyChips event={event} /> : null}
        {!cancelled ? <LeaderAbsentBadge event={event} /> : null}
        {event.isPast && !cancelled ? <UnexcusedChips event={event} /> : null}
        {others.length ? (
          <div class="who">
            {self ? t`${names} and you` : names}
          </div>
        ) : null}
      </div>
      {game ? (
        <GameBall teams={event.teams.map((t) => t.name)} own state={gameBallState(event, single, mine)} />
      ) : (
        <>
          {!cancelled && single ? (
            single.helpRequest?.status === "open" ? (
              <span class="pill pill-nominated">
                <Trans context="help request">Request</Trans>
              </span>
            ) : (
              <StatusPill status={single.status} late={single.isLate} nominated={single.nominated} optional={single.optional} />
            )
          ) : null}
          {!cancelled && !single && mine.length > 1 ? (
            <span class="pill pill-muted">
              {mine.filter((m) => m.status === "yes").length}/{mine.filter((m) => m.participant).length}
            </span>
          ) : null}
          {!cancelled && !mine.length && event.canManage && event.counts ? (
            <span class="pill pill-muted" aria-label={present != null ? t`${present} of ${total} were there` : t`${yes} of ${total} accepted`}>
              <Icon name={present != null ? "users" : "check"} size={13} stroke={3} />
              {present ?? yes}/{total}
            </span>
          ) : null}
        </>
      )}
    </a>
  );
}

/** A coach, lead, staff member or organiser said "I'm not there" for this event. */
function LeaderAbsentBadge({ event }: { event: EventSummary }) {
  if (!event.leaderAbsent || event.cancelled) return null;
  return (
    <div class="row-gap" style={{ gap: "6px", marginTop: "4px" }}>
      <span class="badge warn">
        <Trans>You're not there</Trans>
      </span>
    </div>
  );
}

/** Past events: your own mark, or for coaches the number of marks. */
function UnexcusedChips({ event }: { event: EventSummary }) {
  const me = useMe();
  const marked = event.mine.filter((m) => m.unexcused);
  if (!marked.length && !event.unexcusedCount) return null;
  const count = event.unexcusedCount;
  return (
    <div class="row-gap" style={{ gap: "6px", marginTop: "4px" }}>
      {marked.map((m) => {
        const name = m.person.firstName;
        return <span class="badge warn">{m.person.id === me.person.id ? t`Missed without excuse` : t`${name}: missed without excuse`}</span>;
      })}
      {count && event.canManage ? <span class="badge warn">{t`${count}× unexcused`}</span> : null}
    </div>
  );
}

type When = "upcoming" | "past";

/**
 * Selection of the list, kept per device (localStorage, no personal data): the team buttons switched off (ids, so a
 * new team is on) and the kind chip. See docs/dev/decisions.md, "Event list on home".
 */
interface ListPick {
  hidden: number[];
  show: EventShow;
  /** The modules' parts of the selection (hook homeList), by module id */
  modules?: Record<string, unknown>;
}
const LIST_PICK = "kabine-home-list";
const DEFAULT_PICK: ListPick = { hidden: [], show: "all" };
const SHOWS: EventShow[] = ["all", "training", "game", "other"];

function readPick(): ListPick {
  try {
    const v = JSON.parse(localStorage.getItem(LIST_PICK) ?? "null") as Partial<ListPick> | null;
    return {
      hidden: Array.isArray(v?.hidden) ? v.hidden.filter((id): id is number => typeof id === "number") : [],
      show: v?.show && SHOWS.includes(v.show) ? v.show : "all",
      modules: v?.modules && typeof v.modules === "object" ? v.modules : {},
    };
  } catch {
    return DEFAULT_PICK;
  }
}

function savePick(pick: ListPick) {
  try {
    localStorage.setItem(LIST_PICK, JSON.stringify(pick));
  } catch {
    // Private mode: the selection only lasts until the page is reloaded
  }
}

const showLabels = (): { value: EventShow; label: string }[] => [
  { value: "all", label: t({ message: "All", context: "event kinds" }) },
  { value: "training", label: t`Training` },
  { value: "game", label: t`Games` },
  { value: "other", label: t({ message: "Other", context: "event kinds" }) },
];

const kindOk = (show: EventShow, kind: EventSummary["kind"]) => show === "all" || (show === "other" ? kind === "special" : kind === show);

/** An event as a row of the list; modules add rows of their own (src/module-api.ts, homeList). */
const eventRow = (e: EventSummary): HomeListRow => ({ key: `event-${e.id}`, startsAt: e.startsAt, id: e.id, node: <EventRow key={e.id} event={e} /> });

/** Events per section; "More events" loads that many more. */
const PAGE = 20;
/** Loaded events per view. Kept when opening an event and going back. */
const loaded: Record<When, number> = { upcoming: PAGE, past: PAGE };

const byStart = (list: EventSummary[]) => byStartTime([...new Map(list.map((e) => [e.id, e])).values()]);

export function HomePage() {
  useDocumentTitle(t`Events`);
  const me = useMe();
  const modules = useActiveModules();
  const offline = useOffline();
  const { query } = useLocation();
  const [when, setWhen] = useState<When>(query.zeit === "vergangen" ? "past" : "upcoming");
  const [pick, setPickState] = useState<ListPick>(readPick);
  // Several changes in one tap (a module gives up its view, then a team goes on) build on each other
  const latest = useRef(pick);
  latest.current = pick;
  const [limits, setLimits] = useState<Record<When, number>>(() => ({ ...loaded }));
  const setLimit = (view: When, n: number) => {
    loaded[view] = n;
    setLimits({ ...loaded });
  };
  const updatePick = (change: (current: ListPick) => ListPick) => {
    const next = change(latest.current);
    latest.current = next;
    savePick(next);
    setPickState(next);
    setLimit(when, PAGE);
  };
  const setPick = (next: Omit<ListPick, "modules">) => updatePick((p) => ({ ...p, ...next }));
  const [declineFor, setDeclineFor] = useState<{ event: EventSummary; p: MyParticipation } | null>(null);

  // Children only as far as parents are involved in their teams
  const children = me.children.filter((c) => c.parentsInCharge);
  const noTeam = !me.memberships.length && !children.length;
  // Own teams and the children's, each once, own first
  const ownTeams = [
    ...new Map([...me.memberships, ...children.flatMap((c) => c.teams.filter((t) => t.parentsEnabled))].map((t) => [t.id, { id: t.id, name: t.name }])).values(),
  ];
  // Parts of the modules (modules/<id>/app, homeList), e.g. the games of teams one follows. Here without data for their
  // query parameters, their own view and whether they are on; again below with the loaded page for buttons and rows.
  const listModules = modules.filter((m) => m.homeList);
  const partsWith = (page: EventPage | undefined) =>
    listModules
      .map((m) => {
        const id = m.manifest.id;
        const part = m.homeList!({
          me,
          when,
          show: pick.show,
          pick: pick.modules?.[id],
          setPick: (next) => updatePick((p) => ({ ...p, modules: { ...p.modules, [id]: next } })),
          data: page ? (page.modules?.[id] ?? null) : undefined,
        });
        return part ? { id, part } : null;
      })
      .filter((x): x is { id: string; part: HomeListPart } => !!x);
  const queryParts = partsWith(undefined);
  // A module's own view (all games of the club) stands in for the selection while it is on
  const takeover = queryParts.find((x) => x.part.takeover)?.part.takeover;
  const moduleOn = queryParts.some((x) => x.part.active);
  // Team buttons: own teams on by default, a new team is on (only switched-off ones are stored)
  const onTeams = takeover ? [] : ownTeams.filter((t) => !pick.hidden.includes(t.id));
  const onIds = new Set(onTeams.map((t) => t.id));
  const allOn = !takeover && onTeams.length === ownTeams.length;
  const nothing = ownTeams.length > 0 && !onTeams.length && !moduleOn && !takeover;
  const show = takeover ? takeover.show : pick.show;
  const toggleTeam = (id: number) => {
    // Tapping a team ends a module's own view: the selection from before comes back, with this team on
    if (takeover) {
      takeover.release();
      return updatePick((p) => ({ ...p, hidden: p.hidden.filter((h) => h !== id) }));
    }
    setPick({ ...pick, hidden: pick.hidden.includes(id) ? pick.hidden.filter((h) => h !== id) : [...pick.hidden.filter((h) => ownTeams.some((t) => t.id === h)), id] });
  };
  // Which children play in the selected teams?
  const teamKids = !allOn ? children.filter((c) => c.teams.some((t) => t.parentsEnabled && onIds.has(t.id))).map((c) => c.firstName) : [];
  const kids = joinNames(teamKids);
  const team = !allOn ? joinNames(onTeams.map((t) => t.name)) : null;

  // Page by page from the server, which also filters by relevance, the team buttons and the kind (so "More events"
  // stays right). Offline the last full list comes from storage and is filtered here.
  const limit = limits[when];
  const teamsParam = takeover || allOn || offline ? "all" : onIds.size ? [...onIds].join(",") : "none";
  const moduleQuery = queryParts
    .flatMap((x) => Object.entries(x.part.query ?? {}).map(([k, v]) => `&${x.id}.${encodeURIComponent(k)}=${encodeURIComponent(v)}`))
    .join("");
  const path = nothing
    ? null
    : `/events?limit=${limit}&teams=${teamsParam}${show !== "all" && !offline ? `&show=${show}` : ""}${when === "past" ? "&past=1" : ""}${moduleQuery}`;
  const { data, error, loading, reload } = useQuery<EventPage>(path, { refreshMs: 60_000 });
  // While loading more, the previous list stays instead of briefly disappearing
  const kept = useRef<Partial<Record<When, EventPage>>>({});
  if (data) kept.current[when] = data;
  const shown = nothing ? undefined : (data ?? kept.current[when]);
  const growing = !data && !!shown;
  const parts = partsWith(shown);
  const moduleButtons = parts.flatMap((x) => x.part.buttons ?? []);
  const buttons: HomeListButton[] = [
    ...ownTeams.map((tm) => ({ key: `team-${tm.id}`, label: tm.name, on: onIds.has(tm.id), toggle: () => toggleTeam(tm.id) })),
    ...moduleButtons,
  ];
  // Rows of modules about an event the core lists itself (a game one follows and helps at) are shown once, as the event
  const coreIds = new Set([...(shown?.events ?? []), ...(shown?.next ?? []), ...(shown?.live ?? []), ...(shown?.openHelp ?? [])].map((e) => e.id));
  // Large cards of modules (the home game day); rows of other modules about the events a card shows are left out
  const moduleCards = when === "upcoming" ? parts.flatMap((x) => (x.part.card ? [{ id: x.id, card: x.part.card }] : [])).sort((a, b) => a.card.day.localeCompare(b.card.day)) : [];
  const covered = (r: HomeListRow, id: string) => moduleCards.some((c) => c.id !== id && c.card.covers?.includes(r.id));
  const moduleRows = parts
    .flatMap((x) => (x.part.rows ?? []).filter((r) => !r.id || !covered(r, x.id)))
    .filter((r) => !r.id || !coreIds.has(r.id));
  // A module with more rows than it sent: the list stops at its last day until "More events" (whole days)
  const moduleMore = parts.map((x) => x.part.more?.slice(0, 10)).filter((d): d is string => !!d);
  const cutDay = moduleMore.length ? (when === "past" ? moduleMore.sort().at(-1)! : moduleMore.sort()[0]!) : null;
  const withinCut = (r: { startsAt: string }) => !cutDay || (when === "past" ? r.startsAt.slice(0, 10) >= cutDay : r.startsAt.slice(0, 10) <= cutDay);
  const hasMore = !!shown?.hasMore || moduleMore.length > 0;

  // The same rule as on the server, for the kept list while the new one loads and for offline
  const picked = (e: EventSummary) => kindOk(show, e.kind) && (!!takeover || allOn || e.clubWide || e.teams.some((t) => onIds.has(t.id)));
  const events = (shown?.events ?? []).filter(isRelevantEvent).filter(picked);
  const past = when === "past" ? events.filter((e) => e.isPast && !e.isRunning) : [];
  // Games that have started with a live score stay at the top until the end of the live window
  const liveGames = when === "upcoming" ? (shown?.live ?? []).filter(picked).filter((e) => isLiveWindow(e)) : [];
  // Running events stay under "Upcoming" until they end (games with a live card only there)
  const liveIds = new Set(liveGames.map((e) => e.id));
  const upcoming = when === "upcoming" ? events.filter((e) => (!e.isPast || e.isRunning) && !liveIds.has(e.id)) : [];
  // Events with an open stand-in request and your own next event, even if they lie beyond the page
  const helpRequests = when === "upcoming" ? (shown?.openHelp ?? []).filter(picked) : [];
  const pool = byStart([...upcoming, ...(when === "upcoming" ? (shown?.next ?? []).filter(picked) : []), ...helpRequests]);
  // Big card for the next event and further games on the same day (e.g. two games on a Sunday)
  // The next event always, further ones on the same day only if they are games
  const sameDayAs = (first: EventSummary | undefined, list: EventSummary[]) =>
    first ? list.filter((e) => e === first || (e.kind === "game" && e.startsAt.slice(0, 10) === first.startsAt.slice(0, 10))) : [];
  // Optional trainings only once accepted; otherwise they stay in the list with their "Optional" mark
  const isMine = (e: EventSummary) => !e.cancelled && e.mine.some((m) => (m.participant && (!m.optional || m.status === "yes")) || m.helpRequest?.status === "open");
  const mineCards = sameDayAs(pool.find(isMine), pool.filter(isMine));
  const mineIds = new Set(mineCards.map((e) => e.id));
  const next = mineCards[0];
  const openHelp = helpRequests.filter((e) => !mineIds.has(e.id));
  const coachCards = !next
    ? sameDayAs(
        upcoming.find((e) => !e.cancelled && e.canManage && e.counts),
        upcoming.filter((e) => !e.cancelled && e.canManage && e.counts),
      )
    : [];
  // Time order: whatever starts before the large card (an unconfirmed optional training this morning) is above it
  const listRows: HomeListRow[] = [
    ...upcoming.filter((e) => !mineIds.has(e.id) && !coachCards.includes(e)).map(eventRow),
    ...(when === "upcoming" ? moduleRows : []),
  ].filter(withinCut);
  const firstCard = mineCards[0] ?? coachCards[0];
  const { before, after: rest } = splitAtCard(listRows, firstCard);
  // A module's card on or before the day of the next event's card stands above it
  const cardsAbove = moduleCards.filter((c) => !firstCard || c.card.day <= firstCard.startsAt.slice(0, 10));
  const cardsBelow = moduleCards.filter((c) => !cardsAbove.includes(c));
  const pastRows: HomeListRow[] = byStartTime([...past.map(eventRow), ...(when === "past" ? moduleRows : [])].filter(withinCut)).reverse();
  const filtered = !takeover && (show !== "all" || !allOn);
  // Note from when on only games and special events follow (trainings are generated 70 days ahead)
  const trainingsUntil = when === "upcoming" ? (shown?.trainingsUntil ?? null) : null;
  const horizonAt =
    trainingsUntil && upcoming.some((e) => e.kind === "training") ? rest.findIndex((e) => e.startsAt.slice(0, 10) > trainingsUntil) : -1;
  const until = trainingsUntil ? longDate(`${trainingsUntil}T00:00`) : "";
  // Holiday plans and training breaks: a note where they begin (at the top while one applies),
  // beyond the loaded events only once there are no more
  const today = todayLocal();
  const breaks = (when === "upcoming" ? (shown?.breaks ?? []) : []).map((b) => ({
    b,
    at: b.startsOn <= today ? 0 : rest.findIndex((e) => e.startsAt.slice(0, 10) >= b.startsOn),
  }));
  const breaksAt = (i: number) => breaks.filter((x) => x.at === i).map((x) => <BreakNote key={`${x.b.name}${x.b.startsOn}`} item={x.b} />);
  const trailingBreaks = hasMore ? [] : breaksAt(-1);
  const moreButton = hasMore ? (
    <div class="stack-sm" style={{ alignItems: "center" }}>
      {growing && error ? (
        <p class="small muted">
          <Trans>More events could not be loaded.</Trans>
        </p>
      ) : null}
      <Button
        disabled={growing && !error}
        onClick={() => (growing && error ? reload() : setLimit(when, limit + PAGE))}
      >
        {growing ? (error ? t`Try again` : t`Loading …`) : t`More events`}
      </Button>
    </div>
  ) : null;

  const firstName = me.person.firstName;
  const childNames = joinNames(children.map((c) => c.firstName));
  // Under the greeting: what the list shows
  // The own part of the list; off when all own teams are switched off (only a module's rows are shown)
  const ownSub = ownTeams.length && !onTeams.length
    ? null
    : when === "past"
      ? team
        ? kids
          ? t`Past events of the ${team} for ${kids} this season`
          : t`Past events of the ${team} this season`
        : t`Past events this season`
      : team
        ? kids
          ? t`Events of the ${team} for ${kids}`
          : t`Events of the ${team}`
        : children.length
          ? me.memberships.length
            ? t`Events for you and ${childNames}`
            : t`Events for ${childNames}`
          : t`Your upcoming events`;
  const moduleSubs = parts.map((x) => x.part.sub).filter((x): x is string => !!x);
  const heroSub = nothing ? t`Nothing selected` : takeover ? takeover.sub : [ownSub, ...moduleSubs].filter(Boolean).join(" · ");
  let lastMonth = "";
  return (
    <main class="page">
      <header class="hero">
        <div class="hero-top">
          <div class="kicker">{clubName()}</div>
          {buttons.length > 1 || moduleButtons.length ? (
            <div class="row-gap team-filter" role="group" aria-label={t`Filter by team`}>
              {buttons.map((b) => (
                <button
                  key={b.key}
                  type="button"
                  class={`team-badge ${b.class ?? ""} ${b.on ? "" : "outline"}`}
                  aria-pressed={b.on ? "true" : "false"}
                  aria-label={b.ariaLabel}
                  onClick={b.toggle}
                >
                  {b.label}
                </button>
              ))}
            </div>
          ) : (
            ownTeams.map((tm) => <span class="team-badge">{tm.name}</span>)
          )}
        </div>
        <h1>
          <Trans>Hello {firstName}</Trans>
        </h1>
        <div class="hero-sub">{heroSub}</div>
      </header>

      <div class="content">
        {/* What waits for the person comes first (modules/<id>/app, homeCards), e.g. an open poll */}
        {modules.map((m) => (m.homeCards ? <m.homeCards key={m.manifest.id} /> : null))}
        <NewsCard />
        <CoachHints />
        {!noTeam ? <MotdBanner /> : null}
        <div class="list-controls">
          <Segmented<When>
            label={t`Period`}
            value={when}
            onChange={setWhen}
            options={[
              { value: "upcoming", label: t`Upcoming` },
              { value: "past", label: t`Past` },
            ]}
          />
          {/* A module's own view (all games of the club) has no chips */}
          {!takeover ? (
            <div class="kind-chips" role="group" aria-label={t`Kind of events`}>
              {showLabels().map((o) => (
                <button type="button" aria-pressed={show === o.value ? "true" : "false"} onClick={() => o.value !== show && setPick({ ...pick, show: o.value })}>
                  {o.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        {error && !shown ? <ErrorBox error={error} onRetry={reload} /> : null}
        {loading && !shown && !nothing ? (
          <div class="stack">
            <div class="skeleton" style={{ minHeight: "260px" }} />
            <div class="skeleton" />
            <div class="skeleton" />
          </div>
        ) : null}

        <InstallBanner />
        <PushPrompt />
        <FirstStepsCard />

        {openHelp.map((e) => {
          const date = longDate(e.startsAt);
          const at = time(e.startsAt);
          return (
          <section class="card card-pad stack" aria-label={t`Stand-in request`}>
            <a href={`/termine/${e.id}`} style={{ textDecoration: "none" }}>
              <div class="kicker" style={{ color: "var(--text-2)" }}>
                <Trans>
                  Game · {date}, {at}
                </Trans>
              </div>
              <strong>{e.title}</strong>
            </a>
            {e.mine
              .filter((m) => m.helpRequest?.status === "open")
              .map((m) => (
                <HelpRequestCard event={e} p={m} />
              ))}
          </section>
          );
        })}

        {liveGames.map((e) => (
          <LiveCard key={e.id} event={e} />
        ))}
        {cardsAbove.map((c) => (
          <Fragment key={c.card.key}>{c.card.node}</Fragment>
        ))}
        {before.length ? (
          <section class="stack" aria-label={t`Before your next event`}>
            {before.map((r) => r.node)}
          </section>
        ) : null}
        {mineCards.map((e, i) => (
          <NextCard key={e.id} event={e} later={i > 0} onDecline={(p) => setDeclineFor({ event: e, p })} />
        ))}
        {coachCards.map((e, i) => (
          <CoachNextCard key={e.id} event={e} later={i > 0} />
        ))}
        {cardsBelow.map((c) => (
          <Fragment key={c.card.key}>{c.card.node}</Fragment>
        ))}

        {nothing ? (
          <Empty title={t`Nothing selected`} icon="calendar">
            {moduleButtons.length ? t`Tap a button at the top to see its events.` : t`Tap a team at the top to see its events.`}
          </Empty>
        ) : null}

        {shown && when === "past" && !pastRows.length ? (
          <Empty title={t`No past events`} icon="calendar">
            {filtered
              ? t`There have been no events for this selection this season yet.`
              : t`There have been no events this season yet.`}
          </Empty>
        ) : null}

        {pastRows.length ? (
          <section class="stack" aria-label={t`Past events`}>
            {pastRows.map((r) => {
              const month = monthLabel(r.startsAt);
              const showMonth = month !== lastMonth;
              lastMonth = month;
              return (
                <>
                  {showMonth ? <div class="month-label">{month}</div> : null}
                  {r.node}
                </>
              );
            })}
          </section>
        ) : null}
        {when === "past" ? moreButton : null}

        {shown && when === "upcoming" && !upcoming.length && !moduleRows.length && !moduleCards.length ? (
          filtered ? (
            <Empty title={t`No events`} icon="calendar">
              {t`There are no upcoming events for this selection.`}
            </Empty>
          ) : noTeam && me.isAdmin ? (
            <Empty title={t`No events of your own`} icon="calendar">
              <p>
                <Trans>You are not assigned to any team. You can find the teams and their events in the administration.</Trans>
              </p>
              <a class="btn btn-primary" href="/verwaltung" style={{ marginTop: "12px" }}>
                <Trans>Go to administration</Trans>
              </a>
            </Empty>
          ) : (
            <Empty title={t`No events`} icon="calendar">
              {me.manageableTeams.length
                ? t`Create a training plan in the Team section, then the events will appear here.`
                : me.children.length && !children.length
                  ? t`Parents are not involved in your children's teams. Your children respond there themselves.`
                  : t`As soon as your coach creates events, you will see them here.`}
            </Empty>
          )
        ) : null}

        {rest.length || breaks.length ? (
          <section class="stack" aria-label={t`Other events`}>
            <h2 class="section-title">
              <Trans>Coming up</Trans>
            </h2>
            {rest.map((r, i) => {
              const month = monthLabel(r.startsAt);
              const showMonth = month !== lastMonth && lastMonth !== "";
              lastMonth = month;
              return (
                <>
                  {breaksAt(i)}
                  {i === horizonAt && trainingsUntil ? (
                    <p class="small muted horizon-note">
                      <Trans>Trainings are scheduled until {until}. After that only games and special events follow.</Trans>
                    </p>
                  ) : null}
                  {showMonth ? <div class="month-label">{month}</div> : null}
                  {r.node}
                </>
              );
            })}
            {rest.length ? trailingBreaks : breaks.map((x) => <BreakNote key={`${x.b.name}${x.b.startsOn}`} item={x.b} />)}
          </section>
        ) : null}
        {when === "upcoming" ? moreButton : null}
      </div>
      {declineFor ? <DeclineSheet event={declineFor.event} person={declineFor.p} onClose={() => setDeclineFor(null)} /> : null}
    </main>
  );
}
