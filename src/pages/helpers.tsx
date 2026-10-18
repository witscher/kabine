// Reiter "Helfer": Helferplan der Mannschaften (Dienste in Zeitblöcken bei Spielen und Sonderterminen).
import { useEffect, useRef, useState } from "preact/hooks";
import { api, errorMessage } from "../api";
import { dayOfMonth, monthShort, shortDate, time, todayLocal, weekdayShort } from "../format";
import { Icon } from "../icons";
import { useMe } from "../session";
import { useQuery } from "../store";
import { BlockEditSheet, BlockSheet, blockTime, type TemplateInfo } from "../duty-blocks";
import { Button, confirmDialog, Empty, ErrorBox, Field, Segmented, Sheet, Spinner, SwitchRow, TextField, toast, TopBar, useDocumentTitle } from "../ui";

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

/** Zeitblock eines Dienstes bei einem Termin */
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
  /** Als wer man sich eintragen kann (leer: gar nicht) */
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
  /** Nur in der KiHaSL/JuHaSL-Ansicht (alle Mannschaften) */
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
  if (g.kind === "special") return g.title ?? "Termin";
  if (g.isHome === true) return `gegen ${g.guestTeam ?? "Gegner"}`;
  if (g.isHome === false) return `bei ${g.homeTeam ?? "Gegner"}`;
  return g.title ?? `${g.homeTeam ?? "?"} – ${g.guestTeam ?? "?"}`;
}

function eventTime(g: Game): string {
  return g.kind === "special" && g.endsAt && g.endsAt.slice(0, 10) === g.startsAt.slice(0, 10) ? `${time(g.startsAt)}–${time(g.endsAt)}` : time(g.startsAt);
}

const free = (b: Block) => Math.max(0, b.total - b.entries.length);

/** Virtuelle „Mannschaft“ der KiHaSL/JuHaSL-Ansicht: alle Jugend-Heimspiele F–C */
const REFEREE = 0;

/** Live: bei jeder Änderung neu laden (entprellt), Rückfall: alle 60 Sekunden. */
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
    // Nur als Rückfall, falls eine Live-Meldung verloren geht: Änderungen kommen über die Verbindung
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
  useDocumentTitle("Helfer");
  const me = useMe();
  // Admins sehen alle Mannschaften; der Filter zeigt zuerst nur die eigenen
  const hasOwn = me.helperTeams.some((t) => t.own);
  const hasOthers = me.helperTeams.some((t) => !t.own);
  const [scope, setScope] = useState<"own" | "all">("own");
  const helperTeams = hasOwn && hasOthers && scope === "own" ? me.helperTeams.filter((t) => t.own) : me.helperTeams;
  // KiHaSL/JuHaSL: für alle mit Rolle zuerst, für Trainer und Admins am Ende
  const refereeChip = { id: REFEREE, name: "KiHaSL/JuHaSL", own: true };
  const showReferee = me.referee || me.isAdmin || me.manageableTeams.length > 0;
  const teams = !showReferee ? helperTeams : me.referee ? [refereeChip, ...helperTeams] : [...helperTeams, refereeChip];
  const [teamId, setTeamId] = useState<number | null>(() =>
    showReferee && new URLSearchParams(location.search).has("kihasl") ? REFEREE : (teams[0]?.id ?? null),
  );
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
        <TopBar title="Helfer" kicker="Helferplan" />
        <div class="content">
          <Empty title="Kein Helferplan" icon="helping">
            Sobald eine Mannschaft deines Kindes oder deine Mannschaft den Helferplan nutzt, kannst du dich hier für Dienste bei Spielen und Terminen eintragen.
          </Empty>
        </div>
      </main>
    );
  }

  const data = list.data;
  const team = data?.team;
  // In der Mannschafts-Ansicht zählt der KiHaSL-Platz nicht mit (eigene Liste)
  const openSlots = (g: Game) => g.blocks.reduce((n, b) => n + (b.referee && !isReferee ? 0 : free(b)), 0);
  const allUpcoming = (data?.games ?? []).filter((g) => !g.isPast);
  const upcoming = onlyOpen ? allUpcoming.filter((g) => !g.cancelled && openSlots(g) > 0) : allUpcoming;
  const mine = upcoming.flatMap((g) => g.blocks.flatMap((b) => b.entries.filter((e) => e.mine || e.forMyChild).map((e) => ({ g, b, e }))));
  const skillHint = upcoming.some((g) => !g.cancelled && g.blocks.some((b) => b.skillMissing && b.roles.length && free(b) > 0));
  const managed = manage == null ? null : (data?.games.find((g) => g.id === manage) ?? null);

  return (
    <main class="page">
      <TopBar title="Helfer" kicker="Helferplan" />
      <div class="content">
        {hasOwn && hasOthers ? (
          <Segmented
            label="Mannschaften"
            value={scope}
            options={[
              { value: "own", label: "Meine Teams" },
              { value: "all", label: "Alle Mannschaften" },
            ]}
            onChange={(v) => {
              setScope(v);
              if (v === "own" && teamId !== REFEREE && !me.helperTeams.some((t) => t.own && t.id === teamId)) setTeamId(me.helperTeams.find((t) => t.own)?.id ?? null);
            }}
          />
        ) : null}
        {teams.length > 1 || isReferee || (hasOwn && hasOthers) ? (
          <div class="chips" role="group" aria-label="Mannschaft">
            {teams.map((t) => (
              <button type="button" class={`chip ${teamId === t.id ? "selected" : ""}`} aria-pressed={teamId === t.id ? "true" : "false"} onClick={() => setTeamId(t.id)}>
                {t.name}
              </button>
            ))}
          </div>
        ) : null}
        {list.error ? <ErrorBox error={list.error} onRetry={list.reload} /> : null}
        {!data && !list.error ? <Spinner /> : null}

        {data ? (
          <section class="duty-mine" aria-label="Meine Dienste">
            <strong>Meine Dienste</strong>
            {mine.length ? (
              <ul class="duty-mine-list">
                {mine.map(({ g, b, e }) => (
                  <li>
                    <span>
                      {shortDate(g.startsAt)} · {b.label} · {blockTime(b, g.startsAt)}
                    </span>
                    <span class="muted">{e.child ? `für ${e.child}` : e.mine ? "ich" : e.name}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p class="small muted">Du bist für keinen kommenden Dienst eingetragen.</p>
            )}
          </section>
        ) : null}

        {allUpcoming.length ? (
          <Segmented
            label="Termine"
            value={onlyOpen ? "open" : "all"}
            options={[
              { value: "all", label: "Alle Termine" },
              { value: "open", label: "Nur mit freien Plätzen" },
            ]}
            onChange={(v) => setOnlyOpen(v === "open")}
          />
        ) : null}

        {data && allUpcoming.length && !upcoming.length ? <p class="muted">Alle Plätze sind vergeben.</p> : null}

        {data && !allUpcoming.length ? (
          <Empty title="Keine kommenden Termine" icon="ball">
            {isReferee
              ? "Sobald es Jugend-Heimspiele F bis C gibt, erscheinen sie hier."
              : "Die Spiele kommen aus dem Spielplan der Mannschaft. Sondertermine erscheinen hier, sobald Helfer dafür gesucht werden."}
          </Empty>
        ) : null}

        {upcoming.map((g) => {
          const open = openSlots(g);
          return (
            <article class={`duty-game ${g.cancelled ? "cancelled" : ""}`} aria-label={`${opponent(g)}, ${weekdayShort(g.startsAt)} ${dayOfMonth(g.startsAt)}. ${monthShort(g.startsAt)}`}>
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
                    {g.kind === "special" ? " · Sondertermin" : g.isHome === true ? " · Heim" : g.isHome === false ? " · Auswärts" : ""}
                  </div>
                </div>
                {g.cancelled ? (
                  <span class="badge badge-cancelled">Termin abgesagt</span>
                ) : g.hidden ? (
                  <span class="badge">Ausgeblendet</span>
                ) : open ? (
                  <span class="badge badge-open">{open} frei</span>
                ) : g.blocks.length ? (
                  <span class="badge badge-full">voll</span>
                ) : null}
              </header>
              {!g.blocks.length ? <p class="small muted duty-none">Für diesen Termin sind keine Dienste eingetragen.</p> : null}
              {g.blocks.map((b) => {
                const already = b.entries.some((e) => e.mine);
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
                            {e.child ? <span class="muted"> · für {e.child}</span> : null}
                          </span>
                          {e.note ? <span class="note">„{e.note}“</span> : null}
                          {e.mine || e.forMyChild ? (
                            <button
                              type="button"
                              class="icon-btn icon-btn-sm"
                              aria-label={`${b.label} austragen`}
                              onClick={async () => {
                                try {
                                  await api.del(`/duties/${e.id}`);
                                  toast("Ausgetragen.");
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
                      {!b.entries.length ? <span class="muted">frei</span> : null}
                    </span>
                    {b.referee && !isReferee ? (
                      free(b) > 0 && me.referee ? (
                        <button type="button" class="take" onClick={() => setTeamId(REFEREE)}>
                          KiHaSL-Liste
                        </button>
                      ) : null
                    ) : free(b) > 0 && !g.cancelled && !already && b.roles.length ? (
                      b.skillMissing ? (
                        <a class="small muted" href="/profil" title="Im Profil unter „Das kann ich“ einschalten">
                          Profil
                        </a>
                      ) : (
                        <button type="button" class="take" onClick={() => setSignup({ game: g, block: b })}>
                          Eintragen
                        </button>
                      )
                    ) : null}
                  </div>
                );
              })}
              {g.canManage ? (
                <div class="duty-manage">
                  <Button size="sm" variant="ghost" icon="settings" onClick={() => setManage(g.id)}>
                    Verwalten
                  </Button>
                </div>
              ) : null}
            </article>
          );
        })}

        {skillHint ? (
          <p class="small muted">
            Dienste, die Vorkenntnisse brauchen (z. B. Zeitnehmer), kannst du übernehmen, wenn du sie in deinem <a href="/profil">Profil</a> unter „Das kann ich“ einschaltest.
          </p>
        ) : null}

        {teamId && !isReferee ? (
          showTop ? (
            <TopHelpers teamId={teamId} />
          ) : (
            <Button variant="ghost" size="sm" icon="star" onClick={() => setShowTop(true)}>
              Top-Helfer anzeigen
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
  return `${opponent(g)}, ${weekdayShort(g.startsAt)} ${dayOfMonth(g.startsAt)}. um ${time(g.startsAt)}`;
}

function SignupSheet({ game, block, onClose, onDone }: { game: Game; block: Block; onClose: () => void; onDone: () => void }) {
  const roles = block.roles;
  // KiHaSL/JuHaSL: Wer pfeift, ist die Person im Eintrag (man selbst oder das Kind). Sonst ist man immer selbst
  // eingetragen; ein Kind der Mannschaft verknüpft der Server automatisch, damit das andere Elternteil es sieht.
  const [role, setRole] = useState(String(roles.find((r) => r.childId != null)?.childId ?? roles[0]?.childId ?? "self"));
  const linkedChild = block.referee ? null : (roles.find((r) => r.childId != null)?.childName ?? null);
  const [note, setNote] = useState("");
  return (
    <Sheet open onClose={onClose} title={block.label}>
      <p class="muted">{eventLine(game)}</p>
      <p class="duty-preview">{block.mode === "task" ? blockTime(block, game.startsAt) : `Dienst ${blockTime(block, game.startsAt)} Uhr`}</p>
      {block.referee && roles.length > 1 ? (
        <Segmented
          label="Wer pfeift?"
          value={role}
          onChange={setRole}
          options={roles.map((r) => ({ value: String(r.childId ?? "self"), label: r.childName ?? "Ich selbst" }))}
        />
      ) : null}
      {linkedChild ? <p class="small muted">Der Dienst erscheint auch bei {linkedChild}s anderem Elternteil.</p> : null}
      {block.noteAllowed ? <TextField label="Was bringst du mit? (optional)" value={note} onInput={setNote} maxLength={200} placeholder="z. B. Marmorkuchen" /> : null}
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
          toast(`Eingetragen: ${block.label}.`);
          onClose();
          onDone();
        }}
      >
        Eintragen
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

/** Jemanden eintragen: ohne Suche die Personen der Mannschaft, ab 2 Zeichen der ganze Verein. Sonst Name ohne Zugang. */
function OnBehalfPicker({ game, blocks, onDone }: { game: Game; blocks: Block[]; onDone: () => void }) {
  const [blockId, setBlockId] = useState(String(blocks[0]?.id ?? ""));
  const selected = blocks.find((b) => String(b.id) === blockId) ?? blocks[0];
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => {
    const t = window.setTimeout(() => setQ(search.trim()), 250);
    return () => window.clearTimeout(t);
  }, [search]);
  const referee = !!selected?.referee;
  const team = useQuery<{ people: PersonOption[] }>(referee ? "/duties/referee/people" : `/duties/events/${game.id}/people`);
  const club = useQuery<{ people: PersonOption[] }>(!referee && q.length >= 2 ? `/duties/events/${game.id}/people?q=${encodeURIComponent(q)}` : null);
  const needle = search.trim().toLowerCase();
  const list: PersonOption[] =
    !referee && q.length >= 2
      ? (club.data?.people ?? [])
      : (team.data?.people ?? []).filter((p) => !needle || `${p.name} ${p.childName ?? ""}`.toLowerCase().includes(needle));
  const add = async (body: Record<string, unknown>) => {
    try {
      await api.post("/duties", { blockId: selected!.id, ...body });
      toast("Eingetragen.");
      setSearch("");
      onDone();
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  };
  return (
    <section class="stack-sm" aria-label="Jemanden eintragen">
      <strong>Jemanden eintragen</strong>
      <Field label="Dienst">
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
        label={referee ? "KiHaSL/JuHaSL suchen" : "Name suchen"}
        value={search}
        onInput={setSearch}
        maxLength={60}
        hint={referee ? "Nur Personen mit KiHaSL/JuHaSL-Rolle." : "Ohne Eingabe: Personen der Mannschaft. Ab 2 Buchstaben: alle im Verein."}
      />
      <ul class="list" aria-label="Personen">
        {list.slice(0, 30).map((p) => (
          <li>
            <button type="button" class="list-row" onClick={() => add({ onBehalfPersonId: p.personId, childId: p.childId })}>
              <span class="main">
                <span class="title">{p.name}</span>
                {p.childName || p.teams ? <span class="sub">{p.childName ? `für ${p.childName}` : p.teams}</span> : null}
              </span>
              <Icon name="plus" size={18} />
            </button>
          </li>
        ))}
      </ul>
      {needle && !list.length && !(club.data == null && q.length >= 2) ? <p class="small muted">Niemand gefunden.</p> : null}
      {!referee && search.trim() ? (
        <Button size="sm" variant="ghost" onClick={() => add({ manualName: search.trim() })}>
          „{search.trim()}“ als Name ohne Zugang eintragen
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
    // Vorschlag: im Anschluss an den letzten Block vor Ort, sonst zum Beginn des Termins
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
          toast(`Zeitblock ${nb.label} hinzugefügt.`);
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
    <Sheet open onClose={onClose} title="Dienste verwalten">
      <p class="muted">{eventLine(game)}</p>
      <section class="stack-sm" aria-label="Zeitblöcke">
        {blocks.map((b) => (
          <div class="duty-block-row">
            <button type="button" class="duty-block-label" aria-label={`${b.label}: Uhrzeit ändern`} disabled={b.referee} onClick={() => setSub({ edit: b })}>
              <strong>{b.label}</strong>
              <span class="small muted">{blockTime(b, game.startsAt)}</span>
            </button>
            <div class="duty-stepper-inline">
              <button type="button" class="icon-btn icon-btn-sm" aria-label={`${b.label}: ein Platz weniger`} disabled={b.total <= 0} onClick={() => patchBlock(b, { slots: b.total - 1 })}>
                −
              </button>
              <strong aria-live="polite">{b.total}</strong>
              <button type="button" class="icon-btn icon-btn-sm" aria-label={`${b.label}: ein Platz mehr`} disabled={b.total >= 20} onClick={() => patchBlock(b, { slots: b.total + 1 })}>
                +
              </button>
            </div>
            {!b.referee ? (
              <button
                type="button"
                class="icon-btn icon-btn-sm"
                aria-label={`${b.label} entfernen`}
                disabled={b.entries.length > 0}
                title={b.entries.length ? "Erst alle Einträge entfernen" : undefined}
                onClick={async () => {
                  if (!(await confirmDialog({ title: `${b.label} entfernen?`, message: "Der Zeitblock wird nur bei diesem Termin entfernt.", confirmLabel: "Entfernen", danger: true }))) return;
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
        ))}
        {!blocks.length ? <p class="small muted">Noch keine Dienste.</p> : null}
        {!refereeView ? (
          <Button variant="dashed" size="sm" icon="plus" onClick={() => setSub("add")}>
            Zeitblock hinzufügen
          </Button>
        ) : null}
        {game.kind === "special" && templates.data?.templates.length ? (
          <div class="duty-template-apply">
            <Field label="Aus Vorlage übernehmen">
              {(id) => (
                <select id={id} class="select" value={templateId} onChange={(e) => setTemplateId((e.target as HTMLSelectElement).value)}>
                  <option value="">– Vorlage wählen –</option>
                  {templates.data!.templates.map((t) => (
                    <option value={String(t.id)}>{t.name}</option>
                  ))}
                </select>
              )}
            </Field>
            <Button
              size="sm"
              disabled={!templateId}
              onClick={async () => {
                const res = await api.post<{ created: number }>(`/duties/events/${game.id}/apply-template`, { templateId: Number(templateId) });
                toast(res.created === 1 ? "1 Zeitblock übernommen." : `${res.created} Zeitblöcke übernommen.`);
                setTemplateId("");
                onDone();
              }}
            >
              Übernehmen
            </Button>
          </div>
        ) : null}
      </section>
      <section class="stack-sm" aria-label="Einträge">
        <strong>Einträge</strong>
        <ul class="list">
          {blocks.flatMap((b) =>
            b.entries.map((e) => (
              <li class="list-row">
                <span class="main">
                  <span class="title">{e.name}</span>
                  <span class="sub">
                    {b.label}
                    {e.child ? ` · für ${e.child}` : ""}
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
                  Entfernen
                </Button>
              </li>
            )),
          )}
        </ul>
        {!blocks.some((b) => b.entries.length) ? <p class="small muted">Noch niemand eingetragen.</p> : null}
      </section>
      {blocks.length ? <OnBehalfPicker game={game} blocks={blocks} onDone={onDone} /> : null}
      {game.kind === "game" && !refereeView ? (
        <SwitchRow
          label="Im Helferplan ausblenden"
          sub="Eltern sehen das Spiel dann nicht, z. B. bei einem Spiel ohne Bewirtung."
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
            toast("Spiel gelöscht.");
            onClose();
            onDone();
          }}
        >
          Spiel löschen
        </Button>
      ) : null}
    </Sheet>
  );
}

function TopHelpers({ teamId }: { teamId: number }) {
  const top = useQuery<{ top: { name: string; count: number; star: boolean }[] }>(`/duties/teams/${teamId}/top`);
  if (!top.data) return <Spinner />;
  return (
    <section class="stack-sm" aria-label="Top-Helfer">
      <h2 class="section-title">Top-Helfer</h2>
      {top.data.top.length ? (
        <ol class="duty-top">
          {top.data.top.map((t) => (
            <li>
              <span>
                {t.name}
                {t.star ? <span aria-label="Platz 1"> ★</span> : null}
              </span>
              <span class="muted">{t.count}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p class="small muted">Noch keine Einträge in dieser Mannschaft.</p>
      )}
    </section>
  );
}
