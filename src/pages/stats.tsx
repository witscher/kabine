// Statistics: coaches see their team (training, games, and the views of modules such as helpers per family),
// players and parents their own figures. Only events where someone was expected count (docs/dev/design.md,
// Statistics).
import { plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useEffect, useState } from "preact/hooks";
import type { AttendanceCounts, MyStats, PersonRef, StatsEventRow, StatsRange, TeamStats, TeamStatsPlayer } from "../../shared/types";
import { currentLocale } from "../i18n";
import { fullDate, personName, shortDate } from "../format";
import { useActiveModules } from "../modules";
import { useQuery } from "../store";
import { Button, ErrorBox, InfoButton, Notice, Segmented, Sheet, Spinner, TopBar, useDocumentTitle } from "../ui";

const rangeOptions = (): { value: StatsRange; label: string }[] => [
  { value: "4w", label: t`Last 4 weeks` },
  { value: "season", label: t`Season` },
];

export function readSession<T extends string>(key: string, fallback: T, allowed: readonly T[]): T {
  try {
    const v = sessionStorage.getItem(key) as T | null;
    return v && allowed.includes(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

export function writeSession(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // without storage the choice only lasts until the next reload
  }
}

const pct = (n: number, of: number) => (of ? Math.round((n / of) * 100) : 0);
const rateOf = (c: AttendanceCounts) => (c.expected ? c.present / c.expected : -1);
const missed = (c: AttendanceCounts) => c.expected - c.present;
const decimal = (n: number) => n.toLocaleString(currentLocale(), { maximumFractionDigits: 1 });

function Bar({ value, low }: { value: number; low?: boolean }) {
  return (
    <div class={`stat-bar ${low ? "low" : ""}`} aria-hidden="true">
      <i style={{ width: `${Math.max(0, Math.min(100, value * 100))}%` }} />
    </div>
  );
}

export function Tiles({ items }: { items: { n: string | number; l: string }[] }) {
  return (
    <div class="stat-tiles" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
      {items.map((tile, i) => (
        <div class={`stat-tile ${i === 0 ? "yellow" : ""}`} style={i === 0 ? undefined : { background: "var(--bg)" }}>
          <div class="n">{tile.n}</div>
          <div class="l">{tile.l}</div>
        </div>
      ))}
    </div>
  );
}

/** "1 at short notice, 2 unexcused" in red, otherwise nothing. */
function Flags({ c }: { c: AttendanceCounts }) {
  const late = c.late;
  const unexcused = c.unexcused;
  const parts = [late ? t`${late} at short notice` : "", unexcused ? t`${unexcused} unexcused` : ""].filter(Boolean);
  return parts.length ? <span class="flag"> · {parts.join(", ")}</span> : null;
}

export function rangeNote(data: { range: StatsRange; from: string; dataSince?: string | null }): string {
  if (data.dataSince) {
    const since = fullDate(data.dataSince);
    return t`Season, data since ${since} (start of the app)`;
  }
  const from = fullDate(data.from);
  return data.range === "4w" ? t`Since ${from}` : t`Season since ${from}`;
}

// Coaches --------------------------------------------------------------------------

type View = "training" | "games" | string;

export function TeamStatsPage({ id }: { id: string }) {
  const [range, setRange] = useState<StatsRange>(() => readSession("stats-range", "4w", ["4w", "season"]));
  const [view, setView] = useState<View>(() => readSession(`stats-view-${id}`, "training", ["training", "games", "module:duties"]));
  const { data, error, loading, reload } = useQuery<TeamStats>(`/teams/${id}/stats?range=${range}`);
  const [person, setPerson] = useState<PersonRef | null>(null);
  const modules = useActiveModules().filter((m) => m.teamStats && data && m.teamStats.shown(data));
  const teamName = data?.teamName ?? "";
  useDocumentTitle(data ? t`Statistics ${teamName}` : t`Statistics`);
  useEffect(() => writeSession("stats-range", range), [range]);
  useEffect(() => writeSession(`stats-view-${id}`, view), [view]);
  const moduleView = modules.find((m) => `module:${m.manifest.id}` === view);
  const shown: View = view.startsWith("module:") && !moduleView ? "training" : view;

  return (
    <main class="page">
      <TopBar title={t`Statistics`} kicker={data ? t`Team ${teamName}` : t`Team`} back={`/team/${id}`} />
      <div class="content">
        <Segmented<StatsRange> label={t`Time span`} value={range} onChange={setRange} options={rangeOptions()} />
        <Segmented<View>
          label={t`Area`}
          value={shown}
          onChange={setView}
          options={[
            { value: "training", label: t`Training` },
            { value: "games", label: t`Games` },
            ...modules.map((m) => ({ value: `module:${m.manifest.id}`, label: m.teamStats!.label() })),
          ]}
        />
        {error ? <ErrorBox error={error} onRetry={reload} /> : null}
        {loading && !data ? <Spinner /> : null}
        {data ? (
          shown === "training" ? (
            <AttendanceView data={data} kind="training" onPick={setPerson} />
          ) : shown === "games" ? (
            <AttendanceView data={data} kind="games" onPick={setPerson} />
          ) : moduleView?.teamStats ? (
            <moduleView.teamStats.view teamId={Number(id)} range={range} />
          ) : null
        ) : null}
      </div>
      <PersonSheet teamId={id} range={range} person={person} counts={data?.players.find((p) => p.person.id === person?.id) ?? null} onClose={() => setPerson(null)} />
    </main>
  );
}

function AttendanceView({ data, kind, onPick }: { data: TeamStats; kind: "training" | "games"; onPick: (p: PersonRef) => void }) {
  const [sort, setSort] = useState<"rank" | "name">(() => readSession("stats-sort", "rank", ["rank", "name"]));
  useEffect(() => writeSession("stats-sort", sort), [sort]);
  const of = (p: TeamStatsPlayer) => (kind === "training" ? p.training : p.games);
  const counted = data.players.filter((p) => of(p).expected > 0);
  const notCounted = data.players.filter((p) => of(p).expected === 0);
  const sum = (f: (c: AttendanceCounts) => number) => counted.reduce((s, p) => s + f(of(p)), 0);
  const value = (p: TeamStatsPlayer) => (kind === "training" ? rateOf(of(p)) : of(p).played);
  const list = sort === "name" ? counted : [...counted].sort((a, b) => value(b) - value(a));
  const events = kind === "training" ? data.trainings : data.games;
  const title = kind === "training" ? t`Training` : t`Games`;
  const participation = pct(sum((c) => c.present), sum((c) => c.expected));

  return (
    <>
      <section class="card card-body stack-sm" aria-label={title}>
        <h2 class="section-title" style={{ margin: 0 }}>
          {title} <InfoButton topic="statsTeam" />
        </h2>
        {kind === "training" ? (
          <Tiles
            items={[
              { n: `${participation} %`, l: t`Participation` },
              { n: events, l: t`Trainings` },
              { n: sum((c) => c.late), l: t`at short notice` },
              { n: sum((c) => c.unexcused), l: t`unexcused` },
            ]}
          />
        ) : (
          <Tiles
            items={[
              { n: events, l: t`Games` },
              { n: data.avgSquad == null ? "–" : decimal(data.avgSquad), l: t`Avg. in squad` },
              { n: sum((c) => c.declined + c.unexcused), l: t`Declines` },
            ]}
          />
        )}
        <EventTable events={data.events.filter((e) => e.kind === (kind === "training" ? "training" : "game"))} kind={kind} />
        <p class="small muted" style={{ margin: 0 }}>
          {rangeNote(data)} · {sort === "rank" ? (kind === "training" ? t`by participation` : t`by appearances`) : t`by name`} ·{" "}
          <button type="button" class="link-btn" onClick={() => setSort(sort === "rank" ? "name" : "rank")}>
            {sort === "rank" ? t`Sort by name` : kind === "training" ? t`Sort by participation` : t`Sort by appearances`}
          </button>
        </p>
      </section>

      {list.length ? (
        <ul class="list" aria-label={kind === "training" ? t`Players training` : t`Players games`}>
          {list.map((p) => {
            const c = of(p);
            const present = c.present;
            const expected = c.expected;
            const extra = c.presentNotNominated;
            const declined = c.declined;
            const standing = c.standing;
            return (
              <li>
                <button type="button" class="list-row stat-row" onClick={() => onPick(p.person)}>
                  <span class="main">
                    <span class="title">{personName(p.person)}</span>
                    <span class="sub">
                      {kind === "training" ? t`${present} of ${expected}` : plural(c.played, { one: "# appearance", other: "# appearances" })}
                      {kind === "games" && extra ? ` · ${t`${extra} not nominated, there`}` : ""}
                      {kind === "games" && declined ? ` · ${t`${declined} declined`}` : ""}
                      <Flags c={c} />
                      {standing ? ` · ${t`${standing} away long-term`}` : ""}
                    </span>
                    <Bar value={kind === "training" ? rateOf(c) : events ? c.played / events : 0} low={kind === "training" && rateOf(c) < 0.6} />
                  </span>
                  <span class="stat-pct">{kind === "training" ? `${pct(c.present, c.expected)} %` : c.played}</span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p class="small muted">{kind === "training" ? t`There are no trainings in this time span yet.` : t`There are no games in this time span yet.`}</p>
      )}

      {notCounted.length ? (
        <section class="stack-sm" aria-label={t`Not counted`}>
          <h2 class="section-title" style={{ margin: 0 }}>
            <Trans>Not counted</Trans>
          </h2>
          <ul class="list">
            {notCounted.map((p) => {
              const c = of(p);
              return (
                <li class="list-row dim">
                  <span class="main">
                    <span class="title">{personName(p.person)}</span>
                    <span class="sub">
                      {c.standing
                        ? kind === "training"
                          ? plural(c.standing, { one: "Away long-term at # training", other: "Away long-term at # trainings" })
                          : plural(c.standing, { one: "Away long-term at # game", other: "Away long-term at # games" })
                        : c.inactive
                          ? t`Inactive`
                          : kind === "training"
                            ? t`No trainings yet`
                            : t`No games yet`}
                    </span>
                  </span>
                  {c.standing ? (
                    <span class="pill pill-muted">
                      <Trans>Away</Trans>
                    </span>
                  ) : c.inactive ? (
                    <span class="pill pill-muted">
                      <Trans>Inactive</Trans>
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
          <p class="small muted" style={{ margin: 0 }}>
            <Trans>Whoever was away long-term or inactive for the whole time span is only listed here. Stand-ins from other teams do not count.</Trans>
          </p>
        </section>
      ) : null}
    </>
  );
}

const TABLE_ROWS = 8;
const SHEET_ROWS = 15;

/** Per training or game: who was really there (after responses and recorded attendance), newest first. */
function EventTable({ events, kind }: { events: TeamStats["events"]; kind: "training" | "games" }) {
  const [limit, setLimit] = useState(TABLE_ROWS);
  if (!events.length) return null;
  const shown = events.slice(0, limit);
  const more = Math.min(20, events.length - limit);
  const total = events.length;
  return (
    <div class="stack-sm">
      <table class="table stat-table">
        <thead>
          <tr>
            <th>{kind === "training" ? t`Training` : t`Game`}</th>
            <th class="num">
              <Trans context="stats">There</Trans>
            </th>
            <th>
              <Trans>Missed</Trans>
            </th>
          </tr>
        </thead>
        <tbody>
          {shown.map((e) => {
            const unexcused = e.unexcused;
            const late = e.late;
            const expected = e.expected;
            const flags = [unexcused ? t`${unexcused} unexc.` : "", late ? t`${late} short n.` : ""].filter(Boolean);
            return (
              <tr>
                <td>
                  <a href={`/termine/${e.eventId}`}>{shortDate(e.startsAt)}</a>
                  {kind === "games" && e.title ? <div class="small muted">{e.title}</div> : null}
                </td>
                <td class="num">
                  <strong>{e.present}</strong> <span class="muted">{t`of ${expected}`}</span>
                </td>
                <td>
                  {e.expected - e.present}
                  {flags.length ? <span class="flag"> · {flags.join(", ")}</span> : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {events.length > TABLE_ROWS ? (
        <div class="row-gap">
          {events.length > limit ? (
            <button type="button" class="link-btn" onClick={() => setLimit(limit + 20)}>
              <Trans>
                Show {more} more of {total}
              </Trans>
            </button>
          ) : null}
          {limit > TABLE_ROWS ? (
            <button type="button" class="link-btn" onClick={() => setLimit(TABLE_ROWS)}>
              <Trans>Show fewer</Trans>
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function eventLabel(e: StatsEventRow): string {
  const opponent = e.title;
  if (e.kind === "game") return opponent ? t`Game against ${opponent}` : t`Game`;
  return e.title ?? t`Training`;
}

function EventPill({ e }: { e: StatsEventRow }) {
  switch (e.status) {
    case "present":
      if (e.kind === "game")
        return e.nominated ? (
          <span class="pill pill-nominated">
            <Trans>Played</Trans>
          </span>
        ) : (
          <span class="pill pill-muted">
            <Trans>There, not nominated</Trans>
          </span>
        );
      return (
        <span class="pill pill-yes">
          <Trans context="stats">There</Trans>
        </span>
      );
    case "declined":
      return e.late ? (
        <span class="pill pill-late">
          <Trans>Declined at short notice</Trans>
        </span>
      ) : (
        <span class="pill pill-muted">
          <Trans>Declined</Trans>
        </span>
      );
    case "unexcused":
      return (
        <span class="pill pill-no">
          <Trans>Unexcused</Trans>
        </span>
      );
    case "open":
      return (
        <span class="pill pill-open">
          <Trans>No response</Trans>
        </span>
      );
    case "standing":
      return (
        <span class="pill pill-muted">
          <Trans>Away long-term</Trans>
        </span>
      );
    default:
      return (
        <span class="pill pill-muted">
          <Trans>Inactive</Trans>
        </span>
      );
  }
}

function PersonSheet(props: { teamId: string; range: StatsRange; person: PersonRef | null; counts: TeamStatsPlayer | null; onClose: () => void }) {
  const { data, error } = useQuery<{ events: StatsEventRow[] }>(props.person ? `/teams/${props.teamId}/stats/persons/${props.person.id}?range=${props.range}` : null);
  const c = props.counts;
  const [filter, setFilter] = useState<"all" | "missed">("all");
  const [limit, setLimit] = useState(SHEET_ROWS);
  // Another person: all again, shortened again
  useEffect(() => {
    setFilter("all");
    setLimit(SHEET_ROWS);
  }, [props.person?.id]);
  const missedRow = (e: StatsEventRow) => e.status === "declined" || e.status === "unexcused" || e.status === "open";
  const list = (data?.events ?? []).filter((e) => filter === "all" || missedRow(e));
  const all = data?.events.length ?? 0;
  const missedCount = data?.events.filter(missedRow).length ?? 0;
  const more = Math.min(SHEET_ROWS, list.length - limit);
  return (
    <Sheet open={!!props.person} onClose={props.onClose} title={props.person ? personName(props.person) : ""}>
      {c ? (
        <div class="stats">
          <div class="stat">
            <div class="n">
              {c.training.present} / {c.training.expected}
            </div>
            <div class="l">
              <Trans>Training</Trans>
            </div>
          </div>
          <div class="stat">
            <div class="n">
              {c.games.played} / {c.games.expected}
            </div>
            <div class="l">
              <Trans>Appearances</Trans>
            </div>
          </div>
          <div class="stat">
            <div class="n">{c.training.unexcused + c.games.unexcused}</div>
            <div class="l">
              <Trans>unexcused</Trans>
            </div>
          </div>
        </div>
      ) : null}
      {error ? <ErrorBox error={error} /> : null}
      {data && data.events.length ? (
        <Segmented<"all" | "missed">
          label={t`Events`}
          value={filter}
          onChange={(v) => {
            setFilter(v);
            setLimit(SHEET_ROWS);
          }}
          options={[
            { value: "all", label: t`All (${all})` },
            { value: "missed", label: t`Only missed (${missedCount})` },
          ]}
        />
      ) : null}
      {data ? (
        list.length ? (
          <ul class="list" aria-label={t`Events`}>
            {list.slice(0, limit).map((e) => (
              <li>
                <a class="list-row" href={`/termine/${e.eventId}`}>
                  <span class="main">
                    <span class="title" style={{ fontWeight: 600 }}>
                      {shortDate(e.startsAt)} · {eventLabel(e)}
                    </span>
                  </span>
                  <EventPill e={e} />
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p class="small muted">{filter === "missed" ? t`Missed nothing in this time span.` : t`No events in this time span.`}</p>
        )
      ) : !error && props.person ? (
        <Spinner />
      ) : null}
      {list.length > limit ? (
        <Button variant="ghost" block onClick={() => setLimit(limit + SHEET_ROWS)}>
          <Trans>Show {more} more</Trans>
        </Button>
      ) : null}
      <p class="small muted" style={{ margin: 0 }}>
        <Trans>Reasons for declines are at the event.</Trans>
      </p>
    </Sheet>
  );
}

// Players and parents ----------------------------------------------------------------

function CountsCard({ title, c, games }: { title: string; c: AttendanceCounts; games?: boolean }) {
  const played = c.played;
  const present = c.present;
  const expected = c.expected;
  return (
    <section class="card card-body" aria-label={title}>
      <h2 class="section-title" style={{ margin: "0 0 6px" }}>
        {title}
      </h2>
      {c.expected === 0 ? (
        <p class="small muted" style={{ margin: 0 }}>
          {c.standing ? t`Away long-term in this time span; that does not count as missing.` : t`Nothing to count in this time span yet.`}
        </p>
      ) : (
        <>
          {games ? (
            <>
              <div class="kv">
                <span>
                  <Trans>Appearances</Trans>
                </span>
                <b>{t`${played} of ${expected}`}</b>
              </div>
              {c.presentNotNominated ? (
                <div class="kv">
                  <span>
                    <Trans>There, not nominated</Trans>
                  </span>
                  <b>{c.presentNotNominated}</b>
                </div>
              ) : null}
            </>
          ) : (
            <div class="kv">
              <span>
                <Trans context="stats">There</Trans>
              </span>
              <b>{t`${present} of ${expected}`}</b>
            </div>
          )}
          <div class="kv">
            <span>
              <Trans>Missed</Trans>
            </span>
            <b>{missed(c)}</b>
          </div>
          <div class="kv sub">
            <span>
              <Trans>of which declined at short notice</Trans>
            </span>
            <b>{c.late}</b>
          </div>
          <div class="kv sub">
            <span>
              <Trans>of which unexcused</Trans>
            </span>
            <b>{c.unexcused}</b>
          </div>
        </>
      )}
    </section>
  );
}

export function MyStatsPage() {
  const { data, error, loading, reload } = useQuery<MyStats>("/stats/me");
  const [range, setRange] = useState<StatsRange>(() => readSession("my-stats-range", "4w", ["4w", "season"]));
  const wanted = Number(new URLSearchParams(location.search).get("person")) || null;
  const [personId, setPersonId] = useState<number | null>(wanted);
  const modules = useActiveModules().filter((m) => m.myStats);
  useEffect(() => writeSession("my-stats-range", range), [range]);
  const entry = data?.persons.find((p) => p.person.id === personId) ?? data?.persons[0] ?? null;
  const child = entry && !entry.self ? entry.person.firstName : null;
  const title = child ? t`Statistics of ${child}` : t`My statistics`;
  useDocumentTitle(title);

  return (
    <main class="page">
      <TopBar
        title={title}
        kicker={
          entry
            ? entry.teams
                .map((tm) => {
                  const name = tm.teamName;
                  return t`Team ${name}`;
                })
                .join(" · ")
            : t`Profile`
        }
        back="/profil"
      />
      <div class="content">
        {error ? <ErrorBox error={error} onRetry={reload} /> : null}
        {loading && !data ? <Spinner /> : null}
        {data && !entry ? (
          <Notice>
            <Trans>There is nothing to count here yet. The statistics are for players and for parents who respond for their child.</Trans>
          </Notice>
        ) : null}
        {data && data.persons.length > 1 && entry ? (
          <Segmented<string>
            label={t`Person`}
            value={String(entry.person.id)}
            onChange={(v) => setPersonId(Number(v))}
            options={data.persons.map((p) => ({ value: String(p.person.id), label: p.self ? t`Me` : p.person.firstName }))}
          />
        ) : null}
        {entry ? (
          <>
            <Segmented<StatsRange> label={t`Time span`} value={range} onChange={setRange} options={rangeOptions()} />
            {entry.teams.map((tm) => {
              const name = tm.teamName;
              return (
                <div class="stack-sm">
                  {entry.teams.length > 1 ? <h2 class="section-title">{t`Team ${name}`}</h2> : null}
                  <CountsCard title={t`Training`} c={tm.ranges[range].training} />
                  <CountsCard title={t`Games`} c={tm.ranges[range].games} games />
                  {modules.map((m) => (m.myStats ? <m.myStats personId={entry.person.id} self={entry.self} teamId={tm.teamId} /> : null))}
                </div>
              );
            })}
            <p class="small muted" style={{ margin: 0 }}>
              {entry.self ? t`Only you, your parents and the coaches see these figures.` : t`Only you, your child and the coaches see these figures.`}{" "}
              <Trans>Away long-term (e.g. injured) does not count as missing.</Trans>
            </p>
          </>
        ) : null}
      </div>
    </main>
  );
}
