// "Helpers" tab: the teams' helper plan (duties in time slots at games and special events).
import { plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useEffect, useRef, useState } from "preact/hooks";
import { api, errorMessage } from "../../../src/api";
import { dayOfMonth, monthShort, shortDate, time, todayLocal, weekdayShort } from "../../../src/format";
import { Icon } from "../../../src/icons";
import { useMe } from "../../../src/session";
import { useQuery, useSearch } from "../../../src/store";
import { blockTime, helperFromText } from "../../../src/duty-blocks";
import { type DutyBlock, type DutyGame, type DutyRole, eventLine, forChild, ManageSheet, opponent } from "../../../src/duty-manage";
import { Button, Empty, ErrorBox, Segmented, Sheet, Spinner, TextField, toast, TopBar, useDocumentTitle } from "../../../src/ui";

type Game = DutyGame;
type Block = DutyBlock;

interface HelperTeam {
  teamId: number | null;
  teamName: string;
  canManage: boolean;
  roles: DutyRole[];
}

interface DutyList {
  /** Only for a single team; null for "all" */
  team: HelperTeam | null;
  games: Game[];
}

function eventTime(g: Game): string {
  return g.kind === "special" && g.endsAt && g.endsAt.slice(0, 10) === g.startsAt.slice(0, 10) ? `${time(g.startsAt)}–${time(g.endsAt)}` : time(g.startsAt);
}

const free = (b: Block) => Math.max(0, b.total - b.entries.length);

/** Note of an entry in quotation marks */
function quoted(note: string): string {
  return t`“${note}”`;
}

/**
 * What the Helpers tab shows: a team (id > 0), a list of approved people from all teams (e.g. youth referees, negative
 * duty type id as in the live channel), the club events ("club") or help out at other teams ("help").
 */
type ListKey = number | "club" | "help";

/** Lists of approved people are keyed by the negative duty type id (team ids are always > 0). */
const listChip = (dutyTypeId: number) => -dutyTypeId;

/** Live channel of a list; help out has none (events of many teams), it reloads when the page is opened. */
function livePath(key: ListKey): string | null {
  if (key === "help") return null;
  if (key === "club") return "/api/duties/club/live";
  return key < 0 ? `/api/duties/qualified/${-key}/live` : `/api/duties/teams/${key}/live`;
}

/** Live connection to one list (one per team for "all"); only one of them also polls every 5 minutes. */
function LiveReload(props: { path: string; reload: () => void; poll: boolean }) {
  useLiveReload(props.path, props.reload, props.poll);
  return null;
}

/** Live: reload on every change (debounced), fallback: every 5 minutes. */
function useLiveReload(path: string | null, reload: () => void, poll = true) {
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  useEffect(() => {
    if (path == null) return;
    let ws: WebSocket | null = null;
    let alive = true;
    let retry = 0;
    let timer: number | undefined;
    let debounce: number | undefined;
    let ping: number | undefined;
    const connect = () => {
      ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${path}`);
      ws.onopen = () => {
        retry = 0;
        ping = window.setInterval(() => ws?.readyState === WebSocket.OPEN && ws.send("ping"), 40_000);
      };
      ws.onmessage = (ev) => {
        if (typeof ev.data !== "string" || ev.data === "pong") return;
        if (JSON.parse(ev.data).type === "changed") {
          window.clearTimeout(debounce);
          debounce = window.setTimeout(() => reloadRef.current(), 300);
        }
      };
      ws.onclose = () => {
        window.clearInterval(ping);
        if (!alive) return;
        timer = window.setTimeout(connect, [1000, 2000, 5000, 10000, 30000][Math.min(retry++, 4)]);
      };
    };
    connect();
    // Only as a fallback in case a live message gets lost: changes come through the connection
    const pollTimer = poll ? window.setInterval(() => document.visibilityState === "visible" && reloadRef.current(), 5 * 60_000) : undefined;
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      reloadRef.current();
      if (ws?.readyState === WebSocket.CLOSED) {
        window.clearTimeout(timer);
        connect();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      window.clearTimeout(timer);
      window.clearTimeout(debounce);
      window.clearInterval(ping);
      window.clearInterval(pollTimer);
      document.removeEventListener("visibilitychange", onVisible);
      ws?.close();
    };
  }, [path, poll]);
}

export function HelpersPage() {
  useDocumentTitle(t`Helpers`);
  const me = useMe();
  // Admins see all teams; the filter first shows only their own
  const hasOwn = me.helperTeams.some((ht) => ht.own);
  const hasOthers = me.helperTeams.some((ht) => !ht.own);
  // From an event: ?mannschaft=<id>&spiel=<id> selects the team and jumps to the event
  const [target] = useState(() => {
    const q = new URLSearchParams(location.search);
    // ?liste=<duty type>: a list of approved people; ?kihasl from before 0.8.0: the first of one's own lists
    const list = Number(q.get("liste")) || (q.has("kihasl") ? (me.qualifiedLists.find((l) => l.mine)?.id ?? null) : null);
    return { team: Number(q.get("mannschaft")) || null, game: Number(q.get("spiel")) || null, list, club: q.has("verein"), helpOut: q.has("aushelfen") };
  });
  const [scope, setScope] = useState<"own" | "all">(() => (target.team && me.helperTeams.some((ht) => ht.id === target.team && !ht.own) ? "all" : "own"));
  const helperTeams = hasOwn && hasOthers && scope === "own" ? me.helperTeams.filter((ht) => ht.own) : me.helperTeams;
  // Lists of approved people (e.g. youth referees): first for the approved, last for coaches and admins
  const listChips = me.qualifiedLists.map((l) => ({ id: listChip(l.id) as ListKey, name: l.name, mine: l.mine }));
  // Whole club in front (everyone is invited), help out at the end
  const teams: { id: ListKey; name: string }[] = [
    ...(me.clubDuties ? [{ id: "club" as const, name: t`Whole club` }] : []),
    ...listChips.filter((l) => l.mine),
    ...helperTeams,
    ...listChips.filter((l) => !l.mine),
    ...(me.helpOut ? [{ id: "help" as const, name: t`Help out` }] : []),
  ];
  // Like the team filter of the events list: without a selection all teams together, a tap filters, a second
  // tap clears the filter. A list of approved people and help out are lists of their own and not part of "all".
  const [selected, setSelected] = useState<ListKey | null>(() => {
    if (target.list && teams.some((ht) => ht.id === listChip(target.list!))) return listChip(target.list);
    if (target.club && me.clubDuties) return "club";
    if (target.helpOut && me.helpOut) return "help";
    if (teams.some((ht) => ht.id === target.team)) return target.team;
    // Nothing of one's own teams: the first list there is
    if (!helperTeams.length && !me.qualifiedLists.some((l) => l.mine)) return me.clubDuties ? "club" : me.helpOut ? "help" : null;
    return null;
  });
  const isReferee = typeof selected === "number" && selected < 0;
  const isClub = selected === "club";
  const isHelpOut = selected === "help";
  const ownList = isReferee || isHelpOut;
  const allIds = helperTeams.map((ht) => ht.id);
  // A single team: top helpers as before
  const teamId = typeof selected === "number" && selected > 0 ? selected : selected == null && allIds.length === 1 ? allIds[0]! : null;
  const listPath = isReferee
    ? `/duties/qualified/${-(selected as number)}`
    : isClub
      ? "/duties/club"
      : isHelpOut
        ? "/duties/help-out"
        : selected != null
          ? `/duties?teamId=${selected}`
          : allIds.length
            ? `/duties?teamIds=${allIds.join(",")}`
            : null;
  const list = useQuery<DutyList>(listPath);
  // Without a filter the club events belong to the overall view (everyone is invited); the chip filters to them alone
  const withClub = selected == null && me.clubDuties;
  const clubList = useQuery<DutyList>(withClub ? "/duties/club" : null);
  const reload = () => {
    void list.reload();
    if (withClub) void clubList.reload();
  };
  const liveKeys: ListKey[] = selected != null ? [selected] : withClub ? [...allIds, "club"] : allIds;
  const livePaths = liveKeys.map(livePath).filter((p): p is string => p != null);
  const [signup, setSignup] = useState<{ game: Game; block: Block } | null>(null);
  const [manage, setManage] = useState<number | null>(null);
  const [showTop, setShowTop] = useState(false);
  const [onlyOpen, setOnlyOpen] = useState(false);
  const data: DutyList | undefined = !withClub
    ? list.data
    : (list.data || !listPath) && clubList.data
      ? {
          team: list.data ? list.data.team : null,
          games: [...(list.data?.games ?? []), ...clubList.data.games].sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
        }
      : undefined;
  const listError = list.error ?? (withClub ? clubList.error : undefined);
  // Scroll to the event from the link once and highlight it briefly
  const scrolled = useRef(false);
  useEffect(() => {
    if (scrolled.current || !target.game || !data) return;
    scrolled.current = true;
    const el = document.getElementById(`termin-${target.game}`);
    if (!el) return;
    el.scrollIntoView({ block: "center" });
    el.classList.add("duty-game-target");
    setTimeout(() => el.classList.remove("duty-game-target"), 2500);
  }, [list.data, clubList.data]);

  if (!teams.length) {
    return (
      <main class="page">
        <TopBar title={t`Helpers`} kicker={t`Helper plan`} />
        <div class="content">
          <Empty title={t`No helper plan`} icon="helping">
            <Trans>As soon as a team of your child or your own team uses the helper plan, you can sign up here for duties at games and events.</Trans>
          </Empty>
        </div>
      </main>
    );
  }

  // In the team view the slots of lists of approved people do not count (separate list)
  const openSlots = (g: Game) => g.blocks.reduce((n, b) => n + (b.referee && !isReferee ? 0 : free(b)), 0);
  const allUpcoming = (data?.games ?? []).filter((g) => !g.isPast);
  const upcoming = onlyOpen ? allUpcoming.filter((g) => !g.cancelled && openSlots(g) > 0) : allUpcoming;
  const mine = upcoming.flatMap((g) => g.blocks.flatMap((b) => b.entries.filter((e) => e.mine || e.forMyChild).map((e) => ({ g, b, e }))));
  const skillHint = upcoming.some((g) => !g.cancelled && g.blocks.some((b) => b.skillMissing && b.roles.length && free(b) > 0));
  const managed = manage == null ? null : (data?.games.find((g) => g.id === manage) ?? null);

  return (
    <main class="page">
      <TopBar title={t`Helpers`} kicker={t`Helper plan`} />
      <div class="content">
        {hasOwn && hasOthers ? (
          <Segmented
            label={t`Teams`}
            value={scope}
            options={[
              { value: "own", label: t`Own teams` },
              { value: "all", label: t`All teams` },
            ]}
            onChange={(v) => {
              setScope(v);
              if (v === "own" && typeof selected === "number" && selected > 0 && !me.helperTeams.some((ht) => ht.own && ht.id === selected)) setSelected(null);
            }}
          />
        ) : null}
        {livePaths.map((path, i) => (
          <LiveReload key={path} path={path} poll={i === 0} reload={reload} />
        ))}
        {teams.length > 1 || ownList || isClub || (hasOwn && hasOthers) ? (
          <div class="chips" role="group" aria-label={t`Filter by team`}>
            {teams.map((tm) => {
              // Without a filter all teams are on (not the lists of approved people, those are lists of their own)
              const on = selected == null ? tm.id === "club" || (typeof tm.id === "number" && tm.id > 0) : selected === tm.id;
              return (
                <button type="button" class={`chip ${on ? "selected" : ""}`} aria-pressed={on ? "true" : "false"} onClick={() => setSelected(selected === tm.id ? null : tm.id)}>
                  {tm.name}
                </button>
              );
            })}
          </div>
        ) : null}
        {listError ? <ErrorBox error={listError} onRetry={reload} /> : null}
        {!data && !listError ? <Spinner /> : null}

        {data ? (
          <section class="duty-mine" aria-label={t`My duties`}>
            <strong>
              <Trans>My duties</Trans>
            </strong>
            {mine.length ? (
              <ul class="duty-mine-list">
                {mine.map(({ g, b, e }) => (
                  <li>
                    <span>
                      {shortDate(g.startsAt)} · {b.label} · {blockTime(b, g.startsAt)}
                    </span>
                    <span class="muted">{e.child ? forChild(e.child) : e.mine ? t`me` : e.name}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p class="small muted">
                <Trans>You are not signed up for any upcoming duty.</Trans>
              </p>
            )}
          </section>
        ) : null}

        {allUpcoming.length ? (
          <Segmented
            label={t`Events`}
            value={onlyOpen ? "open" : "all"}
            options={[
              { value: "all", label: t`All events` },
              { value: "open", label: t`Only with free slots` },
            ]}
            onChange={(v) => setOnlyOpen(v === "open")}
          />
        ) : null}

        {data && allUpcoming.length && !upcoming.length ? (
          <p class="muted">
            <Trans>All slots are taken.</Trans>
          </p>
        ) : null}

        {data && !allUpcoming.length ? (
          <Empty title={t`No upcoming events`} icon="ball">
            {isReferee
              ? t`As soon as games need this duty, they appear here.`
              : isHelpOut
                ? t`As soon as another team needs helpers from your team, the events appear here.`
                : t`The games come from the team's fixture list. Special events appear here as soon as helpers are needed for them.`}
          </Empty>
        ) : null}

        {upcoming.map((g) => {
          const open = openSlots(g);
          const title = opponent(g);
          const weekday = weekdayShort(g.startsAt);
          const day = dayOfMonth(g.startsAt);
          const month = monthShort(g.startsAt);
          return (
            <article id={`termin-${g.id}`} class={`duty-game ${g.cancelled ? "cancelled" : ""}`} aria-label={t`${title}, ${weekday} ${day} ${month}`}>
              <header class="duty-game-head">
                <div class="date-block">
                  <div class="wd">{weekdayShort(g.startsAt)}</div>
                  <div class="d">{dayOfMonth(g.startsAt)}</div>
                  <div class="mo">{monthShort(g.startsAt)}</div>
                </div>
                <div class="main">
                  <div class="title">
                    {g.teamName && (ownList || teamId == null || g.club) ? <span class="team-badge duty-team">{g.teamName}</span> : null}
                    {opponent(g)}
                  </div>
                  <div class="sub">
                    {eventTime(g)}
                    {g.location ? ` · ${g.location}` : ""}
                    {g.kind === "special" ? ` · ${t`Special event`}` : g.isHome === true ? ` · ${t`Home`}` : g.isHome === false ? ` · ${t`Away`}` : ""}
                  </div>
                </div>
                {g.cancelled ? (
                  <span class="badge badge-cancelled">
                    <Trans>Not taking place</Trans>
                  </span>
                ) : g.hidden ? (
                  <span class="badge">
                    <Trans>Hidden</Trans>
                  </span>
                ) : open ? (
                  <span class="badge badge-open">
                    <Trans>{open} free</Trans>
                  </span>
                ) : g.blocks.length ? (
                  <span class="badge badge-full">
                    <Trans>full</Trans>
                  </span>
                ) : null}
              </header>
              {!g.blocks.length ? (
                <p class="small muted duty-none">
                  <Trans>No duties have been set up for this event.</Trans>
                </p>
              ) : null}
              {g.blocks.map((b) => {
                const already = b.entries.some((e) => e.mine);
                const label = b.label;
                return (
                  <div class="duty-slot">
                    <span class="duty-name">
                      {b.label}
                      <span class="duty-time">
                        {blockTime(b, g.startsAt)} · {b.entries.length}/{b.total}
                      </span>
                      {b.helperFrom ? <span class="duty-from">{helperFromText(b.helperFrom)}</span> : null}
                      {b.helperFrom?.conflict ? <span class="duty-conflict">{b.helperFrom.conflict}</span> : null}
                    </span>
                    <span class="duty-who">
                      {b.entries.map((e) => (
                        <span class="duty-entry">
                          <span class={e.mine || e.forMyChild ? "me" : ""}>
                            {e.name}
                            {e.child ? <span class="muted"> · {forChild(e.child)}</span> : null}
                          </span>
                          {e.note ? <span class="note">{quoted(e.note)}</span> : null}
                          {e.mine || e.forMyChild ? (
                            <button
                              type="button"
                              class="icon-btn icon-btn-sm"
                              aria-label={t`Withdraw from ${label}`}
                              onClick={async () => {
                                try {
                                  await api.del(`/duties/${e.id}`);
                                  toast(t`Withdrawn.`);
                                  reload();
                                } catch (err) {
                                  toast(errorMessage(err), "error");
                                }
                              }}
                            >
                              <Icon name="x" size={16} />
                            </button>
                          ) : null}
                        </span>
                      ))}
                      {!b.entries.length ? (
                        <span class="muted">
                          <Trans>free</Trans>
                        </span>
                      ) : null}
                    </span>
                    {b.referee && !isReferee ? (
                      free(b) > 0 && me.qualifiedLists.some((l) => l.mine && l.id === b.dutyTypeId) ? (
                        <button type="button" class="take" onClick={() => setSelected(listChip(b.dutyTypeId))}>
                          <Trans>To the list</Trans>
                        </button>
                      ) : null
                    ) : b.assignOnly && free(b) > 0 && !g.cancelled && !b.roles.length ? (
                      <span class="small muted">
                        <Trans>assigned by the coach</Trans>
                      </span>
                    ) : free(b) > 0 && !g.cancelled && !already && b.skillByAdmin && b.skillMissing ? (
                      // Approved by an admin: shown only to the approved people, managers and those with an entry
                      <span class="small muted">
                        <Trans>Only with approval</Trans>
                      </span>
                    ) : free(b) > 0 && !g.cancelled && !already && b.roles.length ? (
                      b.skillMissing ? (
                        <a class="small muted" href="/profil" title={t`Turn on in your profile under “I can do this”`}>
                          <Trans>Profile</Trans>
                        </a>
                      ) : (
                        <button type="button" class="take" onClick={() => setSignup({ game: g, block: b })}>
                          <Trans>Sign up</Trans>
                        </button>
                      )
                    ) : null}
                  </div>
                );
              })}
              {g.canManage ? (
                <div class="duty-manage">
                  <Button size="sm" variant="coach" onClick={() => setManage(g.id)}>
                    <Trans>Manage</Trans>
                  </Button>
                </div>
              ) : null}
            </article>
          );
        })}

        {skillHint ? (
          <p class="small muted">
            <Trans>
              You can take on duties that need prior knowledge (e.g. timekeeper) once you turn them on in your <a href="/profil">profile</a> under “I can do this”.
            </Trans>
          </p>
        ) : null}

        {teamId ? (
          showTop ? (
            <TopHelpers teamId={teamId} />
          ) : (
            <Button variant="ghost" size="sm" icon="star" onClick={() => setShowTop(true)}>
              <Trans>Show top helpers</Trans>
            </Button>
          )
        ) : null}
      </div>

      {signup ? <SignupSheet game={signup.game} block={signup.block} onClose={() => setSignup(null)} onDone={reload} /> : null}
      {managed ? <ManageSheet game={managed} refereeView={isReferee} onClose={() => setManage(null)} onDone={reload} /> : null}
    </main>
  );
}

function SignupSheet({ game, block, onClose, onDone }: { game: Game; block: Block; onClose: () => void; onDone: () => void }) {
  const roles = block.roles;
  // youth referee and help out: whoever does the duty is the person in the entry (oneself or the child). Otherwise one
  // is always signed up oneself; the server links a child of the team automatically so the other parent sees it.
  const [role, setRole] = useState(String(roles.find((r) => r.childId != null)?.childId ?? roles[0]?.childId ?? "self"));
  const childDoes = block.referee || roles.some((r) => r.doer);
  const linkedChild = childDoes ? null : (roles.find((r) => r.childId != null)?.childName ?? null);
  const [note, setNote] = useState("");
  const range = blockTime(block, game.startsAt);
  return (
    <Sheet open onClose={onClose} title={block.label}>
      <p class="muted">{eventLine(game)}</p>
      <p class="duty-preview">{block.mode === "task" ? range : t`Duty ${range}`}</p>
      {childDoes && roles.length > 1 ? (
        <Segmented
          label={block.referee ? t`Who referees?` : t`Who helps?`}
          value={role}
          onChange={setRole}
          options={roles.map((r) => ({
            value: String(r.childId ?? "self"),
            label: r.childName ?? t`Myself`,
          }))}
        />
      ) : null}
      {linkedChild ? (
        <p class="small muted">
          <Trans>The duty also appears for {linkedChild}'s other parent.</Trans>
        </p>
      ) : null}
      {block.noteAllowed ? <TextField label={t`What are you bringing? (optional)`} value={note} onInput={setNote} maxLength={200} placeholder={t`e.g. marble cake`} /> : null}
      <Button
        variant="primary"
        size="lg"
        block
        onClick={async () => {
          await api.post("/duties", {
            blockId: block.id,
            ...(childDoes ? { childId: role === "self" ? null : Number(role) } : {}),
            note: block.noteAllowed ? note.trim() || null : null,
          });
          const label = block.label;
          toast(t`Signed up: ${label}.`);
          onClose();
          onDone();
        }}
      >
        <Trans>Sign up</Trans>
      </Button>
    </Sheet>
  );
}

function TopHelpers({ teamId }: { teamId: number }) {
  const top = useQuery<{
    top: { name: string; count: number; star: boolean }[];
  }>(`/duties/teams/${teamId}/top`);
  if (!top.data) return <Spinner />;
  return (
    <section class="stack-sm" aria-label={t`Top helpers`}>
      <h2 class="section-title">
        <Trans>Top helpers</Trans>
      </h2>
      {top.data.top.length ? (
        <ol class="duty-top">
          {top.data.top.map((h) => (
            <li>
              <span>
                {h.name}
                {h.star ? <span aria-label={t`First place`}> ★</span> : null}
              </span>
              <span class="muted">{h.count}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p class="small muted">
          <Trans>No entries in this team yet.</Trans>
        </p>
      )}
    </section>
  );
}
