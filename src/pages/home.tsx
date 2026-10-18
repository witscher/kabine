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

const KIND_LABEL = { training: "Training", game: "Spiel", special: "Termin" } as const;

/** Mannschaft(en) am Termin nennen, wenn man mit mehr als einer Mannschaft zu tun hat (eigene oder die der Kinder). */
function useTeamLabel(): (e: EventSummary) => string {
  const me = useMe();
  const names = new Set([...me.memberships.map((m) => m.name), ...me.children.flatMap((c) => c.teams.map((t) => t.name))]);
  return (e) => (names.size > 1 && !e.clubWide ? e.teams.map((t) => t.name).join(" + ") : "");
}


/** later: weiterer Termin am selben Tag wie der nächste, ebenfalls als große Karte („Danach: Spiel“). */
function NextCard({ event, onDecline, later = false }: { event: EventSummary; onDecline: (p: MyParticipation) => void; later?: boolean }) {
  const me = useMe();
  const mine = event.mine.filter((m) => m.participant || m.helpRequest);
  const single = mine.length === 1 && mine[0]!.person.id === me.person.id && !mine[0]!.helpRequest;
  const counts = event.counts;
  const teamLabel = useTeamLabel();
  return (
    <section class="card" aria-label={`Nächster Termin: ${KIND_LABEL[event.kind]}`}>
      <div class="card-head">
        <span class="label">
          {later ? "Danach:" : "Nächstes"} {event.kind === "game" ? "Spiel" : event.kind === "training" ? "Training" : "Event"}
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
            Fahrgemeinschaften ({event.carpoolCount.taken}/{event.carpoolCount.seats})
            {event.carpoolCount.waiting ? ` · ${event.carpoolCount.waiting} ${event.carpoolCount.waiting === 1 ? "sucht" : "suchen"} noch` : ""}
          </a>
        ) : null}
        {counts ? (
          <div class="stats">
            <div class="stat">
              <div class="n">{counts.yes}</div>
              <div class="l">Nehmen teil</div>
            </div>
            <div class="stat">
              <div class="n">{counts.no + counts.standing}</div>
              <div class="l">Absagen</div>
            </div>
            <div class="stat">
              <div class="n">{counts.inactive}</div>
              <div class="l">Inaktiv</div>
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
            {mine[0]!.status === "no" && mine[0]!.reason ? <p class="small muted">Dein Grund: „{mine[0]!.reason}“</p> : null}
          </>
        ) : (
          mine.map((m) => <PersonResponseRow key={m.person.id} event={event} p={m} onDecline={onDecline} />)
        )}
        {event.deadline && mine.some((m) => m.participant) ? (
          <p class="small muted">Bitte sage rechtzeitig bis {deadlineText(event)} ab, damit deine Trainer besser planen können.</p>
        ) : null}
      </div>
    </section>
  );
}

/** Spiele: Treffpunkt und Uhrzeit; Trainern ein Hinweis, solange beides fehlt. */
function MeetingLine({ event }: { event: EventSummary }) {
  const g = event.game;
  if (event.kind !== "game" || !g || event.cancelled) return null;
  if (g.meetingTime || g.meetingPoint) {
    return (
      <div class="meeting-line">
        <Icon name="users" size={18} />
        <span>
          Treffen{g.meetingTime ? ` ${g.meetingTime} Uhr` : ""}
          {g.meetingPoint ? ` · ${g.meetingPoint}` : ""}
        </span>
      </div>
    );
  }
  return event.canManage ? (
    <a class="meeting-line missing" href={`/termine/${event.id}`}>
      <Icon name="alert" size={18} />
      <span>Treffpunkt und Uhrzeit noch nicht eingetragen</span>
    </a>
  ) : null;
}

/** Für Trainer: nächster Termin ihrer Mannschaften mit Rückmeldestand. */
function CoachNextCard({ event, later = false }: { event: EventSummary; later?: boolean }) {
  const c = event.counts!;
  return (
    <section class="card" aria-label="Nächster Termin deiner Mannschaft">
      <div class="card-head">
        <span class="label">
          {later ? "Danach:" : "Nächstes"} {event.kind === "game" ? "Spiel" : event.kind === "training" ? "Training" : "Event"} ·{" "}
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
            <div class="l">nehmen teil</div>
          </div>
          <div class="stat-tile" style={{ background: "var(--bg)" }}>
            <div class="n">{c.no}</div>
            <div class="l">abgesagt</div>
          </div>
          <div class="stat-tile" style={{ background: "var(--bg)" }}>
            <div class="n">{c.standing}</div>
            <div class="l">abwesend</div>
          </div>
          <div class="stat-tile dark">
            <div class="n">{c.inactive}</div>
            <div class="l">inaktiv</div>
          </div>
        </div>
        <a class="btn btn-primary" href={`/termine/${event.id}`}>
          Details und Erinnern
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
  const label =
    event.kind === "training"
      ? `Training${team ? ` ${team}` : ""} · ${time(event.startsAt)}`
      : event.kind === "game"
        ? `Spiel · ${event.title}`
        : `${event.title} · ${time(event.startsAt)}`;
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
            <span class="cancel-tag">Termin abgesagt</span>
            {event.cancelled!.byName ? `von ${event.cancelled!.byName}` : ""}
            {event.cancelled!.reason ? `${event.cancelled!.byName ? ": " : ""}${event.cancelled!.reason}` : ""}
          </div>
        ) : (
          <div class="sub">
            {event.kind === "game" ? `${time(event.startsAt)} · ` : ""}
            {event.location?.name ?? "Ort folgt"}
            {event.teams.length > 1 && !team ? ` · ${event.teams.map((t) => t.name).join(" + ")}` : ""}
          </div>
        )}
        {!cancelled ? <DutyChips event={event} /> : null}
        {event.isPast && !cancelled ? <UnexcusedChips event={event} /> : null}
        {others.length ? (
          <div class="who">
            {others.map((o) => o.person.firstName).join(", ")}
            {self ? " und du" : ""}
          </div>
        ) : null}
      </div>
      {!cancelled && single ? (
        single.helpRequest?.status === "open" ? (
          <span class="pill pill-nominated">Anfrage</span>
        ) : event.kind === "game" && single.nominated && single.status === "yes" ? (
          // In der Liste zählt bei Spielen, wer nominiert ist; Spiele ohne Nominierung stehen ohne Marke da
          <span class="pill pill-nominated">Nominiert</span>
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
        <span class="pill pill-muted" aria-label={`${event.counts.yes} von ${event.counts.yes + event.counts.no + event.counts.open + event.counts.standing + event.counts.inactive} zugesagt`}>
          <Icon name="check" size={13} stroke={3} />
          {event.counts.yes}/{event.counts.yes + event.counts.no + event.counts.open + event.counts.standing + event.counts.inactive}
        </span>
      ) : null}
      {event.kind === "game" && !cancelled ? <Ball class="event-ball" /> : null}
    </a>
  );
}

/** Vergangene Termine: eigene Markierung bzw. für Trainer die Zahl der Markierungen. */
function UnexcusedChips({ event }: { event: EventSummary }) {
  const me = useMe();
  const marked = event.mine.filter((m) => m.unexcused);
  if (!marked.length && !event.unexcusedCount) return null;
  return (
    <div class="row-gap" style={{ gap: "6px", marginTop: "4px" }}>
      {marked.map((m) => (
        <span class="badge warn">{m.person.id === me.person.id ? "Unentschuldigt gefehlt" : `${m.person.firstName}: unentschuldigt gefehlt`}</span>
      ))}
      {event.unexcusedCount && event.canManage ? <span class="badge warn">{event.unexcusedCount}× unentschuldigt</span> : null}
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
    // Privater Modus: Filter gilt nur bis zum Neuladen
  }
}

/** Termine pro Abschnitt; „Mehr Termine“ lädt so viele weitere. */
const PAGE = 20;
/** Geladene Termine je Ansicht. Bleibt beim Wechsel in einen Termin und zurück erhalten. */
const loaded: Record<When, number> = { upcoming: PAGE, past: PAGE };

const byStart = (list: EventSummary[]) => [...new Map(list.map((e) => [e.id, e])).values()].sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.id - b.id);

export function HomePage() {
  useDocumentTitle("Termine");
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

  // Kinder nur, soweit die Eltern in ihren Mannschaften eingebunden sind
  const children = me.children.filter((c) => c.parentsInCharge);
  const noTeam = !me.memberships.length && !children.length;
  const teamNames = [
    ...new Set([...me.memberships.map((m) => m.name), ...children.flatMap((c) => c.teams.filter((t) => t.parentsEnabled).map((t) => t.name))]),
  ];
  // Ein gemerkter Filter auf eine Mannschaft, zu der man nicht mehr gehört, gilt nicht
  const team = teamFilter && teamNames.includes(teamFilter) ? teamFilter : null;
  // Bei gesetztem Filter: welche Kinder spielen in dieser Mannschaft?
  const teamKids = team ? children.filter((c) => c.teams.some((t) => t.parentsEnabled && t.name === team)).map((c) => c.firstName) : [];
  const teamLabel = team ? `der ${team}${teamKids.length ? ` für ${teamKids.join(" und ")}` : ""}` : "";
  const pickTeam = (name: string) => {
    const next = team === name ? null : name;
    saveTeamFilter(next);
    setTeamFilter(next);
    setLimit(when, PAGE);
  };
  const teamId = team
    ? ([...me.memberships, ...children.flatMap((c) => c.teams.filter((t) => t.parentsEnabled))].find((t) => t.name === team)?.id ?? null)
    : null;

  // Seitenweise vom Server, der auch nach Relevanz und Mannschaft filtert. Offline ohne Mannschaft:
  // Dann kommt die zuletzt geladene Liste aus dem Speicher, gefiltert wird hier.
  const limit = limits[when];
  const serverTeam = offline ? null : teamId;
  const path = `/events?limit=${limit}${serverTeam ? `&team=${serverTeam}` : ""}${when === "past" ? "&past=1" : ""}`;
  const { data, error, loading, reload } = useQuery<EventPage>(path, { refreshMs: 60_000 });
  // Beim Nachladen bleibt die bisherige Liste stehen, statt kurz zu verschwinden
  const kept = useRef<Partial<Record<When, EventPage>>>({});
  if (data) kept.current[when] = data;
  const shown = data ?? kept.current[when];
  const growing = !data && !!shown;

  const teamOk = (e: EventSummary) => !team || e.teams.some((t) => t.name === team);
  const events = (shown?.events ?? []).filter(isRelevantEvent).filter(teamOk);
  const past = when === "past" ? events.filter((e) => e.isPast) : [];
  const upcoming = when === "upcoming" ? events.filter((e) => !e.isPast) : [];
  // Angepfiffene Spiele mit handball4all-Spielstand bleiben bis 3 Stunden nach Anpfiff oben
  const liveGames = when === "upcoming" ? (shown?.live ?? []).filter(teamOk).filter((e) => isLiveWindow(e)) : [];
  // Termine mit offener Aushilfe-Anfrage und der nächste eigene Termin, auch wenn sie hinter der Seite liegen
  const helpRequests = when === "upcoming" ? (shown?.openHelp ?? []).filter(teamOk) : [];
  const pool = byStart([...upcoming, ...(when === "upcoming" ? (shown?.next ?? []).filter(teamOk) : []), ...helpRequests]);
  // Große Karte für den nächsten Termin und weitere Spiele am selben Tag (z. B. zwei Spiele an einem Sonntag)
  // Der nächste Termin immer, weitere am selben Tag nur, wenn es Spiele sind
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
  // Hinweis, ab wann nur noch Spiele und Sondertermine folgen (Trainings werden 70 Tage im Voraus erzeugt)
  const trainingsUntil = when === "upcoming" ? (shown?.trainingsUntil ?? null) : null;
  const horizonAt =
    trainingsUntil && upcoming.some((e) => e.kind === "training") ? rest.findIndex((e) => e.startsAt.slice(0, 10) > trainingsUntil) : -1;
  const moreButton = shown?.hasMore ? (
    <div class="stack-sm" style={{ alignItems: "center" }}>
      {growing && error ? <p class="small muted">Weitere Termine ließen sich nicht laden.</p> : null}
      <Button
        disabled={growing && !error}
        onClick={() => (growing && error ? reload() : setLimit(when, limit + PAGE))}
      >
        {growing ? (error ? "Erneut versuchen" : "Lädt …") : "Mehr Termine"}
      </Button>
    </div>
  ) : null;

  let lastMonth = "";
  return (
    <main class="page">
      <header class="hero">
        <div class="hero-top">
          <div class="kicker">{clubName()}</div>
          {teamNames.length > 1 ? (
            <div class="row-gap team-filter" role="group" aria-label="Nach Mannschaft filtern">
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
        <h1>Hallo {me.person.firstName}</h1>
        <div class="hero-sub">
          {when === "past"
            ? `Vergangene Termine${team ? ` ${teamLabel}` : ""} in dieser Saison`
            : team
              ? `Termine ${teamLabel}`
              : children.length
            ? `Termine von ${me.memberships.length ? "dir und " : ""}${children.map((c) => c.firstName).join(" und ")}`
            : "Deine nächsten Termine"}
        </div>
      </header>

      <div class="content">
        {!noTeam ? <MotdBanner /> : null}
        <Segmented<When>
          label="Zeitraum"
          value={when}
          onChange={setWhen}
          options={[
            { value: "upcoming", label: "Kommend" },
            { value: "past", label: "Vergangen" },
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

        {openHelp.map((e) => (
          <section class="card card-pad stack" aria-label="Aushilfe-Anfrage">
            <a href={`/termine/${e.id}`} style={{ textDecoration: "none" }}>
              <div class="kicker" style={{ color: "var(--text-2)" }}>
                Spiel · {longDate(e.startsAt)}, {time(e.startsAt)}
              </div>
              <strong>{e.title}</strong>
            </a>
            {e.mine
              .filter((m) => m.helpRequest?.status === "open")
              .map((m) => (
                <HelpRequestCard event={e} p={m} />
              ))}
          </section>
        ))}

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
          <Empty title="Keine vergangenen Termine" icon="calendar">
            In dieser Saison gab es{team ? ` für die ${team}` : ""} noch keine Termine.
          </Empty>
        ) : null}

        {past.length ? (
          <section class="stack" aria-label="Vergangene Termine">
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
            <Empty title="Keine eigenen Termine" icon="calendar">
              <p>Du bist keiner Mannschaft zugeordnet. Die Mannschaften und ihre Termine findest du in der Verwaltung.</p>
              <a class="btn btn-primary" href="/verwaltung" style={{ marginTop: "12px" }}>
                Zur Verwaltung
              </a>
            </Empty>
          ) : (
            <Empty title="Keine Termine" icon="calendar">
              {me.manageableTeams.length
                ? "Lege im Bereich Team einen Trainingsplan an, dann erscheinen hier die Termine."
                : me.children.length && !children.length
                  ? "In den Mannschaften deiner Kinder sind keine Eltern eingebunden. Deine Kinder sagen dort selbst zu und ab."
                  : "Sobald dein Trainer Termine anlegt, siehst du sie hier."}
            </Empty>
          )
        ) : null}

        {rest.length ? (
          <section class="stack" aria-label="Weitere Termine">
            <h2 class="section-title">Demnächst</h2>
            {rest.map((e, i) => {
              const month = monthLabel(e.startsAt);
              const showMonth = month !== lastMonth && lastMonth !== "";
              lastMonth = month;
              return (
                <>
                  {i === horizonAt && trainingsUntil ? (
                    <p class="small muted horizon-note">
                      Trainings sind bis {longDate(`${trainingsUntil}T00:00`)} eingetragen. Danach folgen nur Spiele und Sondertermine.
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
