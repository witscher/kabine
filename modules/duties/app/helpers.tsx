// "Helpers" tab: the teams' helper plan (duties in time slots at games and special events).
import { plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useEffect, useRef, useState } from "preact/hooks";
import { api, errorMessage } from "../../../src/api";
import { dayOfMonth, monthShort, shortDate, time, todayLocal, weekdayShort } from "../../../src/format";
import { Icon } from "../../../src/icons";
import { useMe } from "../../../src/session";
import { useQuery } from "../../../src/store";
import { BlockEditSheet, BlockSheet, blockTime, type TemplateInfo } from "../../../src/duty-blocks";
import { Button, confirmDialog, Empty, ErrorBox, Field, Segmented, Sheet, Spinner, SwitchRow, TextField, toast, TopBar, useDocumentTitle } from "../../../src/ui";

interface Entry {
  id: number;
  name: string;
  child: string | null;
  note: string | null;
  mine: boolean;
  forMyChild: boolean;
}

interface Role {
  childId: number | null;
  childName: string | null;
}

/** Time slot of a duty at an event */
interface Block {
  id: number;
  dutyTypeId: number;
  label: string;
  mode: "onsite" | "task";
  referee: boolean;
  special: boolean;
  startsAt: string;
  endsAt: string;
  total: number;
  noteAllowed: boolean;
  needsSkill: boolean;
  skillMissing: boolean;
  /** As whom one can sign up (empty: not at all) */
  roles: Role[];
  entries: Entry[];
}

interface Game {
  id: number;
  kind: "game" | "special";
  startsAt: string;
  endsAt: string | null;
  isPast: boolean;
  isHome: boolean | null;
  homeTeam: string | null;
  guestTeam: string | null;
  title: string | null;
  location: string | null;
  cancelled: boolean;
  hidden: boolean;
  manual: boolean;
  blocks: Block[];
  /** Only in the KiHaSL/JuHaSL view (all teams) */
  teamName?: string;
  teamId?: number;
  canManage?: boolean;
}

interface HelperTeam {
  teamId: number;
  teamName: string;
  canManage: boolean;
  roles: Role[];
}

interface DutyList {
  team: HelperTeam;
  games: Game[];
}

function opponent(g: Game): string {
  if (g.kind === "special") return g.title ?? t`Event`;
  if (g.isHome === true) {
    const guest = g.guestTeam ?? t`Opponent`;
    return t`vs ${guest}`;
  }
  if (g.isHome === false) {
    const home = g.homeTeam ?? t`Opponent`;
    return t`at ${home}`;
  }
  return g.title ?? `${g.homeTeam ?? "?"} – ${g.guestTeam ?? "?"}`;
}

function eventTime(g: Game): string {
  return g.kind === "special" && g.endsAt && g.endsAt.slice(0, 10) === g.startsAt.slice(0, 10) ? `${time(g.startsAt)}–${time(g.endsAt)}` : time(g.startsAt);
}

const free = (b: Block) => Math.max(0, b.total - b.entries.length);

/** Note of an entry in quotation marks */
function quoted(note: string): string {
  return t`“${note}”`;
}

/** "for Anna": entry made for a child */
function forChild(child: string): string {
  return t`for ${child}`;
}

/** Virtual "team" of the KiHaSL/JuHaSL view: all youth home games F–C */
const REFEREE = 0;

/** Live: reload on every change (debounced), fallback: every 60 seconds. */
function useLiveReload(teamId: number | null, reload: () => void) {
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  useEffect(() => {
    if (teamId == null) return;
    let ws: WebSocket | null = null;
    let alive = true;
    let retry = 0;
    let timer: number | undefined;
    let debounce: number | undefined;
    let ping: number | undefined;
    const connect = () => {
      const path = teamId === REFEREE ? "/api/duties/referee/live" : `/api/duties/teams/${teamId}/live`;
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
    const poll = window.setInterval(() => document.visibilityState === "visible" && reloadRef.current(), 5 * 60_000);
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
      window.clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
      ws?.close();
    };
  }, [teamId]);
}

export function HelpersPage() {
  useDocumentTitle(t`Helpers`);
  const me = useMe();
  // Admins see all teams; the filter first shows only their own
  const hasOwn = me.helperTeams.some((ht) => ht.own);
  const hasOthers = me.helperTeams.some((ht) => !ht.own);
  const [scope, setScope] = useState<"own" | "all">("own");
  const helperTeams = hasOwn && hasOthers && scope === "own" ? me.helperTeams.filter((ht) => ht.own) : me.helperTeams;
  // KiHaSL/JuHaSL: first for everyone with the role, last for coaches and admins
  const refereeChip = { id: REFEREE, name: "KiHaSL/JuHaSL", own: true };
  const showReferee = me.referee || me.isAdmin || me.manageableTeams.length > 0;
  const teams = !showReferee ? helperTeams : me.referee ? [refereeChip, ...helperTeams] : [...helperTeams, refereeChip];
  const [teamId, setTeamId] = useState<number | null>(() => (showReferee && new URLSearchParams(location.search).has("kihasl") ? REFEREE : (teams[0]?.id ?? null)));
  const isReferee = teamId === REFEREE;
  const list = useQuery<DutyList>(teamId == null ? null : isReferee ? "/duties/referee" : `/duties?teamId=${teamId}`);
  useLiveReload(teamId, () => void list.reload());
  const [signup, setSignup] = useState<{ game: Game; block: Block } | null>(null);
  const [manage, setManage] = useState<number | null>(null);
  const [showTop, setShowTop] = useState(false);
  const [onlyOpen, setOnlyOpen] = useState(false);

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

  const data = list.data;
  const team = data?.team;
  // In the team view the KiHaSL slot does not count (separate list)
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
              if (v === "own" && teamId !== REFEREE && !me.helperTeams.some((ht) => ht.own && ht.id === teamId)) setTeamId(me.helperTeams.find((ht) => ht.own)?.id ?? null);
            }}
          />
        ) : null}
        {teams.length > 1 || isReferee || (hasOwn && hasOthers) ? (
          <div class="chips" role="group" aria-label={t`Team selection`}>
            {teams.map((tm) => (
              <button type="button" class={`chip ${teamId === tm.id ? "selected" : ""}`} aria-pressed={teamId === tm.id ? "true" : "false"} onClick={() => setTeamId(tm.id)}>
                {tm.name}
              </button>
            ))}
          </div>
        ) : null}
        {list.error ? <ErrorBox error={list.error} onRetry={list.reload} /> : null}
        {!data && !list.error ? <Spinner /> : null}

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
              ? t`As soon as there are youth home games F to C, they appear here.`
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
            <article class={`duty-game ${g.cancelled ? "cancelled" : ""}`} aria-label={t`${title}, ${weekday} ${day} ${month}`}>
              <header class="duty-game-head">
                <div class="date-block">
                  <div class="wd">{weekdayShort(g.startsAt)}</div>
                  <div class="d">{dayOfMonth(g.startsAt)}</div>
                  <div class="mo">{monthShort(g.startsAt)}</div>
                </div>
                <div class="main">
                  <div class="title">
                    {g.teamName ? <span class="team-badge duty-team">{g.teamName}</span> : null}
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
                    <Trans>Event cancelled</Trans>
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
                                  void list.reload();
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
                      free(b) > 0 && me.referee ? (
                        <button type="button" class="take" onClick={() => setTeamId(REFEREE)}>
                          <Trans>KiHaSL list</Trans>
                        </button>
                      ) : null
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
                  <Button size="sm" variant="ghost" icon="settings" onClick={() => setManage(g.id)}>
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

        {teamId && !isReferee ? (
          showTop ? (
            <TopHelpers teamId={teamId} />
          ) : (
            <Button variant="ghost" size="sm" icon="star" onClick={() => setShowTop(true)}>
              <Trans>Show top helpers</Trans>
            </Button>
          )
        ) : null}
      </div>

      {signup ? <SignupSheet game={signup.game} block={signup.block} onClose={() => setSignup(null)} onDone={() => void list.reload()} /> : null}
      {managed && team ? (
        <ManageSheet teamId={managed.teamId ?? team.teamId} game={managed} refereeView={isReferee} onClose={() => setManage(null)} onDone={() => void list.reload()} />
      ) : null}
    </main>
  );
}

function eventLine(g: Game) {
  const title = opponent(g);
  const weekday = weekdayShort(g.startsAt);
  const day = dayOfMonth(g.startsAt);
  const clock = time(g.startsAt);
  return t`${title}, ${weekday} ${day} at ${clock}`;
}

function SignupSheet({ game, block, onClose, onDone }: { game: Game; block: Block; onClose: () => void; onDone: () => void }) {
  const roles = block.roles;
  // KiHaSL/JuHaSL: whoever referees is the person in the entry (oneself or the child). Otherwise one is always signed up
  // oneself; the server links a child of the team automatically so the other parent sees it.
  const [role, setRole] = useState(String(roles.find((r) => r.childId != null)?.childId ?? roles[0]?.childId ?? "self"));
  const linkedChild = block.referee ? null : (roles.find((r) => r.childId != null)?.childName ?? null);
  const [note, setNote] = useState("");
  const range = blockTime(block, game.startsAt);
  return (
    <Sheet open onClose={onClose} title={block.label}>
      <p class="muted">{eventLine(game)}</p>
      <p class="duty-preview">{block.mode === "task" ? range : t`Duty ${range}`}</p>
      {block.referee && roles.length > 1 ? (
        <Segmented
          label={t`Who referees?`}
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
            ...(block.referee ? { childId: role === "self" ? null : Number(role) } : {}),
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

interface PersonOption {
  personId: number;
  name: string;
  childId: number | null;
  childName: string | null;
  teams?: string | null;
}

/** Sign someone up: without a search the team's people, from 2 characters the whole club. Otherwise a name without access. */
function OnBehalfPicker({ game, blocks, onDone }: { game: Game; blocks: Block[]; onDone: () => void }) {
  const [blockId, setBlockId] = useState(String(blocks[0]?.id ?? ""));
  const selected = blocks.find((b) => String(b.id) === blockId) ?? blocks[0];
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => {
    const timer = window.setTimeout(() => setQ(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);
  const referee = !!selected?.referee;
  const team = useQuery<{ people: PersonOption[] }>(referee ? "/duties/referee/people" : `/duties/events/${game.id}/people`);
  const club = useQuery<{ people: PersonOption[] }>(!referee && q.length >= 2 ? `/duties/events/${game.id}/people?q=${encodeURIComponent(q)}` : null);
  const needle = search.trim().toLowerCase();
  const name = search.trim();
  const list: PersonOption[] =
    !referee && q.length >= 2 ? (club.data?.people ?? []) : (team.data?.people ?? []).filter((p) => !needle || `${p.name} ${p.childName ?? ""}`.toLowerCase().includes(needle));
  const add = async (body: Record<string, unknown>) => {
    try {
      await api.post("/duties", { blockId: selected!.id, ...body });
      toast(t`Signed up.`);
      setSearch("");
      onDone();
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  };
  return (
    <section class="stack-sm" aria-label={t`Sign someone up`}>
      <strong>
        <Trans>Sign someone up</Trans>
      </strong>
      <Field label={t`Duty`}>
        {(id) => (
          <select id={id} class="select" value={String(selected?.id ?? "")} onChange={(e) => setBlockId((e.target as HTMLSelectElement).value)}>
            {blocks.map((b) => (
              <option value={String(b.id)}>
                {b.label} · {blockTime(b, game.startsAt)}
              </option>
            ))}
          </select>
        )}
      </Field>
      <TextField
        label={referee ? t`Search KiHaSL/JuHaSL` : t`Search name`}
        value={search}
        onInput={setSearch}
        maxLength={60}
        hint={referee ? t`Only people with the KiHaSL/JuHaSL role.` : t`Without input: people of the team. From 2 letters: everyone in the club.`}
      />
      <ul class="list" aria-label={t`People`}>
        {list.slice(0, 30).map((p) => (
          <li>
            <button type="button" class="list-row" onClick={() => add({ onBehalfPersonId: p.personId, childId: p.childId })}>
              <span class="main">
                <span class="title">{p.name}</span>
                {p.childName || p.teams ? <span class="sub">{p.childName ? forChild(p.childName) : p.teams}</span> : null}
              </span>
              <Icon name="plus" size={18} />
            </button>
          </li>
        ))}
      </ul>
      {needle && !list.length && !(club.data == null && q.length >= 2) ? (
        <p class="small muted">
          <Trans>No one found.</Trans>
        </p>
      ) : null}
      {!referee && search.trim() ? (
        <Button size="sm" variant="ghost" onClick={() => add({ manualName: search.trim() })}>
          <Trans>Add “{name}” as a name without access</Trans>
        </Button>
      ) : null}
    </section>
  );
}

function ManageSheet({ teamId, game, refereeView, onClose, onDone }: { teamId: number; game: Game; refereeView: boolean; onClose: () => void; onDone: () => void }) {
  const [sub, setSub] = useState<"main" | "add" | { edit: Block }>("main");
  const templates = useQuery<{ templates: TemplateInfo[] }>(game.kind === "special" ? "/duty-templates" : null);
  const [templateId, setTemplateId] = useState("");
  const date = game.startsAt.slice(0, 10);

  const patchBlock = async (b: Block, body: Record<string, unknown>) => {
    try {
      await api.patch(`/duties/blocks/${b.id}`, body);
      onDone();
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  };

  if (sub === "add") {
    // Suggestion: right after the last on-site block, otherwise at the start of the event
    const lastEnd = game.blocks.filter((b) => b.mode === "onsite" && !b.referee).reduce<string | null>((m, b) => (m == null || b.endsAt > m ? b.endsAt : m), null);
    const start = (lastEnd && lastEnd.slice(0, 10) === date ? lastEnd : game.startsAt).slice(11, 16);
    return (
      <BlockSheet
        date={date}
        start={start}
        eventEnd={game.endsAt}
        allowNewType={game.kind === "special"}
        onClose={() => setSub("main")}
        onSave={async (nb) => {
          await api.post(`/duties/events/${game.id}/blocks`, {
            ...(nb.newTypeName ? { newTypeName: nb.newTypeName } : { dutyTypeId: nb.dutyTypeId }),
            startsAt: nb.startsAt,
            endsAt: nb.endsAt,
            slots: nb.slots,
          });
          const label = nb.label;
          toast(t`Time slot ${label} added.`);
          onDone();
        }}
      />
    );
  }
  if (typeof sub === "object") {
    return (
      <BlockEditSheet
        block={sub.edit}
        onClose={() => setSub("main")}
        onSave={async (v) => {
          await api.patch(`/duties/blocks/${sub.edit.id}`, v);
          onDone();
        }}
      />
    );
  }

  const blocks = refereeView ? game.blocks.filter((b) => b.referee) : game.blocks;
  return (
    <Sheet open onClose={onClose} title={t`Manage duties`}>
      <p class="muted">{eventLine(game)}</p>
      <section class="stack-sm" aria-label={t`Time slots`}>
        {blocks.map((b) => {
          const label = b.label;
          return (
            <div class="duty-block-row">
              <button type="button" class="duty-block-label" aria-label={t`${label}: change time`} disabled={b.referee} onClick={() => setSub({ edit: b })}>
                <strong>{b.label}</strong>
                <span class="small muted">{blockTime(b, game.startsAt)}</span>
              </button>
              <div class="duty-stepper-inline">
                <button
                  type="button"
                  class="icon-btn icon-btn-sm"
                  aria-label={t`${label}: one slot fewer`}
                  disabled={b.total <= 0}
                  onClick={() => patchBlock(b, { slots: b.total - 1 })}
                >
                  −
                </button>
                <strong aria-live="polite">{b.total}</strong>
                <button
                  type="button"
                  class="icon-btn icon-btn-sm"
                  aria-label={t`${label}: one slot more`}
                  disabled={b.total >= 20}
                  onClick={() => patchBlock(b, { slots: b.total + 1 })}
                >
                  +
                </button>
              </div>
              {!b.referee ? (
                <button
                  type="button"
                  class="icon-btn icon-btn-sm"
                  aria-label={t`Remove ${label}`}
                  disabled={b.entries.length > 0}
                  title={b.entries.length ? t`Remove all entries first` : undefined}
                  onClick={async () => {
                    if (
                      !(await confirmDialog({
                        title: t`Remove ${label}?`,
                        message: t`The time slot is only removed from this event.`,
                        confirmLabel: t`Remove`,
                        danger: true,
                      }))
                    )
                      return;
                    try {
                      await api.del(`/duties/blocks/${b.id}`);
                      onDone();
                    } catch (err) {
                      toast(errorMessage(err), "error");
                    }
                  }}
                >
                  <Icon name="trash" size={16} />
                </button>
              ) : (
                <span />
              )}
            </div>
          );
        })}
        {!blocks.length ? (
          <p class="small muted">
            <Trans>No duties yet.</Trans>
          </p>
        ) : null}
        {!refereeView ? (
          <Button variant="dashed" size="sm" icon="plus" onClick={() => setSub("add")}>
            <Trans>Add time slot</Trans>
          </Button>
        ) : null}
        {game.kind === "special" && templates.data?.templates.length ? (
          <div class="duty-template-apply">
            <Field label={t`Apply from template`}>
              {(id) => (
                <select id={id} class="select" value={templateId} onChange={(e) => setTemplateId((e.target as HTMLSelectElement).value)}>
                  <option value="">{t`– Choose template –`}</option>
                  {templates.data!.templates.map((tpl) => (
                    <option value={String(tpl.id)}>{tpl.name}</option>
                  ))}
                </select>
              )}
            </Field>
            <Button
              size="sm"
              disabled={!templateId}
              onClick={async () => {
                const res = await api.post<{ created: number }>(`/duties/events/${game.id}/apply-template`, { templateId: Number(templateId) });
                const created = res.created;
                toast(
                  plural(created, {
                    one: "# time slot applied.",
                    other: "# time slots applied.",
                  }),
                );
                setTemplateId("");
                onDone();
              }}
            >
              <Trans>Apply</Trans>
            </Button>
          </div>
        ) : null}
      </section>
      <section class="stack-sm" aria-label={t`Entries`}>
        <strong>
          <Trans>Entries</Trans>
        </strong>
        <ul class="list">
          {blocks.flatMap((b) =>
            b.entries.map((e) => (
              <li class="list-row">
                <span class="main">
                  <span class="title">{e.name}</span>
                  <span class="sub">
                    {b.label}
                    {e.child ? ` · ${forChild(e.child)}` : ""}
                  </span>
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    await api.del(`/duties/${e.id}`);
                    onDone();
                  }}
                >
                  <Trans>Remove</Trans>
                </Button>
              </li>
            )),
          )}
        </ul>
        {!blocks.some((b) => b.entries.length) ? (
          <p class="small muted">
            <Trans>No one signed up yet.</Trans>
          </p>
        ) : null}
      </section>
      {blocks.length ? <OnBehalfPicker game={game} blocks={blocks} onDone={onDone} /> : null}
      {game.kind === "game" && !refereeView ? (
        <SwitchRow
          label={t`Hide in helper plan`}
          sub={t`Parents then don't see the game, e.g. for a game without catering.`}
          checked={game.hidden}
          onChange={async (hidden) => {
            await api.patch(`/duties/games/${game.id}`, { hidden });
            onDone();
          }}
        />
      ) : null}
      {game.manual && !refereeView ? (
        <Button
          variant="danger"
          icon="trash"
          onClick={async () => {
            await api.del(`/duties/games/${game.id}`);
            toast(t`Game deleted.`);
            onClose();
            onDone();
          }}
        >
          <Trans>Delete game</Trans>
        </Button>
      ) : null}
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
