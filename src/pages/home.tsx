import { plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { clubName } from "../club";
import { useLocation } from "preact-iso";
import { useRef, useState } from "preact/hooks";
import type { EventPage, EventSummary, MyParticipation } from "../../shared/types";
import { DutyChips } from "../duties";
import { dayOfMonth, longDate, monthLabel, monthShort, relativeDay, timeRange, time, weekdayShort } from "../format";
import { InstallBanner, MotdBanner, PushSetupBanner } from "../howto";
import { Ball, Icon } from "../icons";
import { DeclineSheet, deadlineText, HelpRequestCard, PersonResponseRow, ResponseButtons } from "../respond";
import { useMe } from "../session";
import { useOffline } from "../offline";
import { useQuery } from "../store";
import { Button, Empty, ErrorBox, Segmented, StatusPill, useDocumentTitle } from "../ui";
import { isLiveWindow, LiveCard } from "../live";
import { isRelevantEvent } from "../../shared/relevance";

const kindLabel = () => ({ training: t`Training`, game: t`Game`, special: t`Event` }) as const;

/** "A and B and C": names as one list, in the app's language. */
function joinAnd(names: string[]): string {
  return names.reduce((list, name) => (list ? t`${list} and ${name}` : name), "");
}

/** Card heading "Up next: game" or, for a further event on the same day, "Then: game". */
function nextHeading(kind: EventSummary["kind"], later: boolean): string {
  if (later) return kind === "game" ? t`Then: game` : kind === "training" ? t`Then: training` : t`Then: event`;
  return kind === "game" ? t`Up next: game` : kind === "training" ? t`Up next: training` : t`Up next: event`;
}

/** Carpool summary on the card: "Carpools (2/5) · 1 is still looking". */
function carpoolLine(c: { taken: number; seats: number; waiting: number }): string {
  const { taken, seats, waiting } = c;
  const head = t`Carpools (${taken}/${seats})`;
  return waiting ? `${head} · ${plural(waiting, { one: "# is still looking", other: "# are still looking" })}` : head;
}

/** Name the team(s) of the event when you deal with more than one team (your own or your children's). */
function useTeamLabel(): (e: EventSummary) => string {
  const me = useMe();
  const names = new Set([...me.memberships.map((m) => m.name), ...me.children.flatMap((c) => c.teams.map((t) => t.name))]);
  return (e) => (names.size > 1 && !e.clubWide ? e.teams.map((t) => t.name).join(" + ") : "");
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
  const deadline = deadlineText(event);
  return (
    <section class="card" aria-label={t`Next event: ${kind}`}>
      <div class="card-head">
        <span class="label">
          {nextHeading(event.kind, later)}
          {teamLabel(event) ? ` · ${teamLabel(event)}` : ""}
        </span>
        <span style={{ fontWeight: 600, fontSize: "14px" }}>{relativeDay(event.startsAt)}</span>
      </div>
      <div class={`card-body ${event.kind === "game" ? "has-ball" : ""}`}>
        {event.kind === "game" ? <Ball class="next-ball" /> : null}
        <a href={`/termine/${event.id}`} style={{ textDecoration: "none" }} class="stack-sm">
          <div class="big-date">{longDate(event.startsAt)}</div>
          {event.kind !== "training" ? <div style={{ fontWeight: 700, fontSize: "17px" }}>{event.title}</div> : null}
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
        <DutyChips event={event} />
        {event.carpoolCount ? (
          <a class="carpool-line" href={`/termine/${event.id}`}>
            <Icon name="car" size={16} />
            {carpoolLine(event.carpoolCount)}
          </a>
        ) : null}
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
        {single ? (
          <>
            {mine[0]!.participant ? (
              <div class="row-gap">
                <StatusPill status={mine[0]!.status} late={mine[0]!.isLate} />
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
        {event.deadline && mine.some((m) => m.participant) ? (
          <p class="small muted">
            <Trans>Please decline in good time by {deadline} so that your coaches can plan better.</Trans>
          </p>
        ) : null}
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
      <div class="card-head">
        <span class="label">
          {nextHeading(event.kind, later)} ·{" "}
          <span class="nocaps">{event.teams.map((t) => t.name).join(" + ")}</span>
        </span>
        <span style={{ fontWeight: 600, fontSize: "14px" }}>{relativeDay(event.startsAt)}</span>
      </div>
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
        <a class="btn btn-primary" href={`/termine/${event.id}`}>
          <Trans>Details and reminders</Trans>
        </a>
      </div>
    </section>
  );
}

function EventRow({ event }: { event: EventSummary }) {
  const me = useMe();
  const mine = event.mine.filter((m) => m.participant || m.helpRequest || event.kind === "game");
  const dark = event.kind === "game";
  const cancelled = !!event.cancelled;
  const others = mine.filter((m) => m.person.id !== me.person.id);
  const self = mine.find((m) => m.person.id === me.person.id);
  const single = mine.length === 1 ? mine[0]! : null;
  const team = useTeamLabel()(event);
  const at = time(event.startsAt);
  const title = event.title;
  const label =
    event.kind === "training"
      ? team
        ? t`Training ${team} · ${at}`
        : t`Training · ${at}`
      : event.kind === "game"
        ? t`Game · ${title}`
        : `${event.title} · ${time(event.startsAt)}`;
  const byName = event.cancelled?.byName;
  const names = others.map((o) => o.person.firstName).join(", ");
  const counts = event.counts;
  const yes = counts?.yes ?? 0;
  const total = counts ? counts.yes + counts.no + counts.open + counts.standing + counts.inactive : 0;
  return (
    <a href={`/termine/${event.id}`} class={`event-row ${dark && !cancelled ? "dark" : ""} ${cancelled ? "cancelled" : ""}`}>
      <div class="date-block">
        <div class="wd">{weekdayShort(event.startsAt)}</div>
        <div class="d">{dayOfMonth(event.startsAt)}</div>
        <div class="mo">{monthShort(event.startsAt)}</div>
      </div>
      <div class="main">
        <div class="title">{label}</div>
        {cancelled ? (
          <div class="sub">
            <span class="cancel-tag">
              <Trans>Event cancelled</Trans>
            </span>
            {byName ? t`by ${byName}` : ""}
            {event.cancelled!.reason ? `${event.cancelled!.byName ? ": " : ""}${event.cancelled!.reason}` : ""}
          </div>
        ) : (
          <div class="sub">
            {event.kind === "game" ? `${time(event.startsAt)} · ` : ""}
            {event.location?.name ?? t`Location to follow`}
            {event.teams.length > 1 && !team ? ` · ${event.teams.map((t) => t.name).join(" + ")}` : ""}
          </div>
        )}
        {!cancelled ? <DutyChips event={event} /> : null}
        {event.isPast && !cancelled ? <UnexcusedChips event={event} /> : null}
        {others.length ? (
          <div class="who">
            {self ? t`${names} and you` : names}
          </div>
        ) : null}
      </div>
      {!cancelled && single ? (
        single.helpRequest?.status === "open" ? (
          <span class="pill pill-nominated">
            <Trans context="help request">Request</Trans>
          </span>
        ) : event.kind === "game" && single.nominated && single.status === "yes" ? (
          // For games the list counts who is nominated; games without a nomination have no mark
          <span class="pill pill-nominated">
            <Trans>Nominated</Trans>
          </span>
        ) : (
          <StatusPill status={single.status} late={single.isLate} nominated={single.nominated} game={event.kind === "game"} />
        )
      ) : null}
      {!cancelled && !single && mine.length > 1 ? (
        <span class="pill pill-muted">
          {mine.filter((m) => m.status === "yes").length}/{mine.filter((m) => m.participant).length}
        </span>
      ) : null}
      {!cancelled && !mine.length && event.canManage && event.counts ? (
        <span class="pill pill-muted" aria-label={t`${yes} of ${total} accepted`}>
          <Icon name="check" size={13} stroke={3} />
          {event.counts.yes}/{event.counts.yes + event.counts.no + event.counts.open + event.counts.standing + event.counts.inactive}
        </span>
      ) : null}
      {event.kind === "game" && !cancelled ? <Ball class="event-ball" /> : null}
    </a>
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
const TEAM_FILTER = "kabine-home-team";

function readTeamFilter(): string | null {
  try {
    return sessionStorage.getItem(TEAM_FILTER);
  } catch {
    return null;
  }
}

function saveTeamFilter(team: string | null) {
  try {
    if (team) sessionStorage.setItem(TEAM_FILTER, team);
    else sessionStorage.removeItem(TEAM_FILTER);
  } catch {
    // Private mode: the filter only lasts until the page is reloaded
  }
}

/** Events per section; "More events" loads that many more. */
const PAGE = 20;
/** Loaded events per view. Kept when opening an event and going back. */
const loaded: Record<When, number> = { upcoming: PAGE, past: PAGE };

const byStart = (list: EventSummary[]) => [...new Map(list.map((e) => [e.id, e])).values()].sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.id - b.id);

export function HomePage() {
  useDocumentTitle(t`Events`);
  const me = useMe();
  const offline = useOffline();
  const { query } = useLocation();
  const [when, setWhen] = useState<When>(query.zeit === "vergangen" ? "past" : "upcoming");
  const [teamFilter, setTeamFilter] = useState<string | null>(readTeamFilter);
  const [limits, setLimits] = useState<Record<When, number>>(() => ({ ...loaded }));
  const setLimit = (view: When, n: number) => {
    loaded[view] = n;
    setLimits({ ...loaded });
  };
  const [declineFor, setDeclineFor] = useState<{ event: EventSummary; p: MyParticipation } | null>(null);

  // Children only as far as parents are involved in their teams
  const children = me.children.filter((c) => c.parentsInCharge);
  const noTeam = !me.memberships.length && !children.length;
  const teamNames = [
    ...new Set([...me.memberships.map((m) => m.name), ...children.flatMap((c) => c.teams.filter((t) => t.parentsEnabled).map((t) => t.name))]),
  ];
  // A remembered filter for a team you no longer belong to does not apply
  const team = teamFilter && teamNames.includes(teamFilter) ? teamFilter : null;
  // With a filter set: which children play in this team?
  const teamKids = team ? children.filter((c) => c.teams.some((t) => t.parentsEnabled && t.name === team)).map((c) => c.firstName) : [];
  const kids = joinAnd(teamKids);
  const pickTeam = (name: string) => {
    const next = team === name ? null : name;
    saveTeamFilter(next);
    setTeamFilter(next);
    setLimit(when, PAGE);
  };
  const teamId = team
    ? ([...me.memberships, ...children.flatMap((c) => c.teams.filter((t) => t.parentsEnabled))].find((t) => t.name === team)?.id ?? null)
    : null;

  // Page by page from the server, which also filters by relevance and team. Offline without a team:
  // then the last loaded list comes from storage and is filtered here.
  const limit = limits[when];
  const serverTeam = offline ? null : teamId;
  const path = `/events?limit=${limit}${serverTeam ? `&team=${serverTeam}` : ""}${when === "past" ? "&past=1" : ""}`;
  const { data, error, loading, reload } = useQuery<EventPage>(path, { refreshMs: 60_000 });
  // While loading more, the previous list stays instead of briefly disappearing
  const kept = useRef<Partial<Record<When, EventPage>>>({});
  if (data) kept.current[when] = data;
  const shown = data ?? kept.current[when];
  const growing = !data && !!shown;

  const teamOk = (e: EventSummary) => !team || e.teams.some((t) => t.name === team);
  const events = (shown?.events ?? []).filter(isRelevantEvent).filter(teamOk);
  const past = when === "past" ? events.filter((e) => e.isPast) : [];
  const upcoming = when === "upcoming" ? events.filter((e) => !e.isPast) : [];
  // Games that have started with a handball4all score stay at the top until 3 hours after throw-off
  const liveGames = when === "upcoming" ? (shown?.live ?? []).filter(teamOk).filter((e) => isLiveWindow(e)) : [];
  // Events with an open stand-in request and your own next event, even if they lie beyond the page
  const helpRequests = when === "upcoming" ? (shown?.openHelp ?? []).filter(teamOk) : [];
  const pool = byStart([...upcoming, ...(when === "upcoming" ? (shown?.next ?? []).filter(teamOk) : []), ...helpRequests]);
  // Big card for the next event and further games on the same day (e.g. two games on a Sunday)
  // The next event always, further ones on the same day only if they are games
  const sameDayAs = (first: EventSummary | undefined, list: EventSummary[]) =>
    first ? list.filter((e) => e === first || (e.kind === "game" && e.startsAt.slice(0, 10) === first.startsAt.slice(0, 10))) : [];
  const isMine = (e: EventSummary) => !e.cancelled && e.mine.some((m) => m.participant || m.helpRequest?.status === "open");
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
  const rest = upcoming.filter((e) => !mineIds.has(e.id) && !coachCards.includes(e));
  // Note from when on only games and special events follow (trainings are generated 70 days ahead)
  const trainingsUntil = when === "upcoming" ? (shown?.trainingsUntil ?? null) : null;
  const horizonAt =
    trainingsUntil && upcoming.some((e) => e.kind === "training") ? rest.findIndex((e) => e.startsAt.slice(0, 10) > trainingsUntil) : -1;
  const until = trainingsUntil ? longDate(`${trainingsUntil}T00:00`) : "";
  const moreButton = shown?.hasMore ? (
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
  const childNames = joinAnd(children.map((c) => c.firstName));
  let lastMonth = "";
  return (
    <main class="page">
      <header class="hero">
        <div class="hero-top">
          <div class="kicker">{clubName()}</div>
          {teamNames.length > 1 ? (
            <div class="row-gap team-filter" role="group" aria-label={t`Filter by team`}>
              {teamNames.map((t) => (
                <button
                  type="button"
                  class={`team-badge ${team && team !== t ? "outline" : ""}`}
                  aria-pressed={team === t ? "true" : "false"}
                  onClick={() => pickTeam(t)}
                >
                  {t}
                </button>
              ))}
            </div>
          ) : (
            teamNames.map((t) => <span class="team-badge">{t}</span>)
          )}
        </div>
        <h1>
          <Trans>Hello {firstName}</Trans>
        </h1>
        <div class="hero-sub">
          {when === "past"
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
                : t`Your upcoming events`}
        </div>
      </header>

      <div class="content">
        {!noTeam ? <MotdBanner /> : null}
        <Segmented<When>
          label={t`Period`}
          value={when}
          onChange={setWhen}
          options={[
            { value: "upcoming", label: t`Upcoming` },
            { value: "past", label: t`Past` },
          ]}
        />
        {error && !shown ? <ErrorBox error={error} onRetry={reload} /> : null}
        {loading && !shown ? (
          <div class="stack">
            <div class="skeleton" style={{ minHeight: "260px" }} />
            <div class="skeleton" />
            <div class="skeleton" />
          </div>
        ) : null}

        <InstallBanner />
        <PushSetupBanner />

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
        {mineCards.map((e, i) => (
          <NextCard key={e.id} event={e} later={i > 0} onDecline={(p) => setDeclineFor({ event: e, p })} />
        ))}
        {coachCards.map((e, i) => (
          <CoachNextCard key={e.id} event={e} later={i > 0} />
        ))}

        {shown && when === "past" && !past.length ? (
          <Empty title={t`No past events`} icon="calendar">
            {team ? t`There have been no events for the ${team} this season yet.` : t`There have been no events this season yet.`}
          </Empty>
        ) : null}

        {past.length ? (
          <section class="stack" aria-label={t`Past events`}>
            {past.map((e) => {
              const month = monthLabel(e.startsAt);
              const showMonth = month !== lastMonth;
              lastMonth = month;
              return (
                <>
                  {showMonth ? <div class="month-label">{month}</div> : null}
                  <EventRow key={e.id} event={e} />
                </>
              );
            })}
          </section>
        ) : null}
        {when === "past" ? moreButton : null}

        {shown && when === "upcoming" && !upcoming.length ? (
          noTeam && me.isAdmin ? (
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

        {rest.length ? (
          <section class="stack" aria-label={t`Other events`}>
            <h2 class="section-title">
              <Trans>Coming up</Trans>
            </h2>
            {rest.map((e, i) => {
              const month = monthLabel(e.startsAt);
              const showMonth = month !== lastMonth && lastMonth !== "";
              lastMonth = month;
              return (
                <>
                  {i === horizonAt && trainingsUntil ? (
                    <p class="small muted horizon-note">
                      <Trans>Trainings are scheduled until {until}. After that only games and special events follow.</Trans>
                    </p>
                  ) : null}
                  {showMonth ? <div class="month-label">{month}</div> : null}
                  <EventRow key={e.id} event={e} />
                </>
              );
            })}
          </section>
        ) : null}
        {when === "upcoming" ? moreButton : null}
      </div>
      {declineFor ? <DeclineSheet event={declineFor.event} person={declineFor.p} onClose={() => setDeclineFor(null)} /> : null}
    </main>
  );
}
