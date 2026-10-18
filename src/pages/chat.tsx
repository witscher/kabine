import { useLocation } from "preact-iso";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { api } from "../api";
import { ago, clock, dayLabel, isoToLocalDate } from "../format";
import { PersonAvatar } from "../avatar";
import { refreshBadge } from "../badge";
import { loadOffline, saveOffline } from "../offline";
import { Icon } from "../icons";
import { useMe } from "../session";
import { invalidate, useQuery } from "../store";
import { Button, Empty, ErrorBox, Notice, Sheet, Spinner, toast, TopBar, useDocumentTitle } from "../ui";

interface Room {
  teamId: number;
  teamName: string;
  /** Gruppe (nur Chat und Sondertermine) statt Mannschaft. */
  isGroup: boolean;
  canRead: boolean;
  canWrite: boolean;
  isMod: boolean;
  muted: boolean;
  viaChildren: string[];
  optedOut: boolean;
  isMember: boolean;
  role: string | null;
  reason: string | null;
  lastMessageAt: string | null;
  unread: boolean;
  /** Nur als Admin sichtbar, erscheint nur unter "Alle Chats". */
  adminOnly: boolean;
}

interface Message {
  id: number;
  kind: "user" | "system" | "announcement";
  authorId: number | null;
  authorName: string | null;
  authorLabel: string | null;
  isFormer: boolean;
  text: string | null;
  createdAt: string;
  deleted: boolean;
  mentions?: number[];
  mentionAll?: boolean;
  reactions?: Reaction[];
  pending?: string;
}

interface Reaction {
  emoji: string;
  names: string[];
  mine: boolean;
}

/** Wie auf dem Server (worker/chat/room.ts), mit Bezeichnung für Screenreader. */
const REACTIONS: { emoji: string; label: string }[] = [
  { emoji: "👍", label: "Daumen hoch" },
  { emoji: "❤️", label: "Herz" },
  { emoji: "😂", label: "Lachen" },
  { emoji: "😢", label: "Traurig" },
  { emoji: "👋", label: "Winken" },
];

interface Mentionable {
  personId: number;
  name: string;
}

/** @alle für Trainer und Admins, Personen-ID 0 wie auf dem Server. */
const ALL: Mentionable = { personId: 0, name: "alle" };

/** "@Teil" direkt vor dem Cursor, wenn gerade ein Name getippt wird. */
function mentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf("@");
  if (at < 0 || (at > 0 && !/\s/.test(before[at - 1]!))) return null;
  const query = before.slice(at + 1);
  if (query.length > 24 || /\n/.test(query)) return null;
  return { start: at, query };
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Text mit hervorgehobenen @Namen. */
function MessageText({ text, names }: { text: string; names: string[] }) {
  if (!names.length) return <>{text}</>;
  const pattern = new RegExp(`(@(?:${names.map(escapeRegExp).join("|")}))`, "g");
  return <>{text.split(pattern).map((part, i) => (i % 2 === 1 ? <strong class="mention">{part}</strong> : part))}</>;
}

function ReactionPicker({ current, onPick }: { current: string | null; onPick: (emoji: string) => void }) {
  return (
    <div class="reaction-picker" role="group" aria-label="Reaktion wählen">
      {REACTIONS.map((r) => (
        <button type="button" aria-label={r.label} aria-pressed={current === r.emoji ? "true" : "false"} onClick={() => onPick(r.emoji)}>
          {r.emoji}
        </button>
      ))}
    </div>
  );
}

function ReactionChips({ reactions, onOpen }: { reactions: Reaction[]; onOpen: () => void }) {
  if (!reactions.length) return null;
  return (
    <button
      type="button"
      class="reactions"
      onClick={onOpen}
      aria-label={`Reaktionen: ${reactions.map((r) => `${REACTIONS.find((x) => x.emoji === r.emoji)?.label ?? r.emoji} ${r.names.length}`).join(", ")}. Wer hat reagiert?`}
    >
      {reactions.map((r) => (
        <span class={`reaction ${r.mine ? "mine" : ""}`}>
          {r.emoji}
          {r.names.length > 1 ? <span class="count">{r.names.length}</span> : null}
        </span>
      ))}
    </button>
  );
}

export function ChatListPage() {
  useDocumentTitle("Chat");
  const { route, query } = useLocation();
  // Admins: alle Mannschaftschats über die Verwaltung, sonst nur die eigenen
  const showAll = "alle" in query;
  const { data, error, loading, reload } = useQuery<{ rooms: Room[] }>("/chat/rooms");
  const rooms = (data?.rooms ?? []).filter((r) => showAll || !r.adminOnly);
  useEffect(() => {
    if (!showAll && rooms.length === 1 && rooms[0]!.canRead) route(`/chat/${rooms[0]!.teamId}`, true);
  }, [data]);
  return (
    <main class="page">
      <TopBar title={showAll ? "Alle Chats" : "Chat"} kicker={showAll ? "Verwaltung" : "Mannschaften"} back={showAll ? "/verwaltung" : undefined} />
      <div class="content">
        {error ? <ErrorBox error={error} onRetry={reload} /> : null}
        {loading ? <Spinner /> : null}
        {data && !rooms.length ? (
          <Empty title="Noch kein Chat" icon="chat">
            Sobald du zu einer Mannschaft gehörst, findest du hier ihren Chat.
          </Empty>
        ) : null}
        {rooms.length ? (
          <ul class="list">
            {rooms.map((r) => (
              <li>
                <a class="list-row" href={`/chat/${r.teamId}`}>
                  <span class="team-badge" style={{ minWidth: "44px", textAlign: "center" }}>
                    {r.teamName}
                  </span>
                  <span class="main">
                    <span class="title">{r.isGroup ? "Gruppenchat" : "Mannschaftschat"} {r.teamName}</span>
                    <span class="sub">
                      {r.reason ??
                        (r.viaChildren.length && !r.isMember ? `als Elternteil von ${r.viaChildren.join(" und ")}` : showAll && r.adminOnly ? `als Admin${r.lastMessageAt ? ` · letzte Nachricht ${ago(r.lastMessageAt)}` : ""}` : r.lastMessageAt ? `Letzte Nachricht ${ago(r.lastMessageAt)}` : "Noch keine Nachrichten")}
                    </span>
                  </span>
                  {r.unread ? (
                    <span class="pill pill-nominated">
                      neu<span class="sr-only"> (ungelesene Nachrichten)</span>
                    </span>
                  ) : null}
                  <Icon name="chevron" size={18} />
                </a>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </main>
  );
}

type Conn = "connecting" | "open" | "closed";

/** So lange darf der Verbindungsaufbau bis zur Begrüßung des Servers dauern. */
const HELLO_TIMEOUT_MS = 8000;

/**
 * iOS: Die Tastatur verkleinert nur den sichtbaren Bereich (visualViewport), nicht 100dvh. Das
 * Eingabefeld unten landete dann hinter Tastatur und Eingabeleiste von Safari. Solange die Tastatur
 * offen ist, liegt der Chat deshalb fest genau über dem sichtbaren Bereich.
 */
function useKeyboardFit(pageRef: { current: HTMLElement | null }, logRef: { current: HTMLElement | null }) {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    let fitted = false;
    const update = () => {
      // Die Seite kann erst nach dem Laden des Raums gerendert sein
      const el = pageRef.current;
      if (!el) return;
      const keyboard = window.innerHeight - vv.height > 120;
      if (keyboard) {
        const log = logRef.current;
        const atBottom = !log || log.scrollHeight - log.scrollTop - log.clientHeight < 80;
        el.classList.add("keyboard-fit");
        el.style.top = `${vv.offsetTop}px`;
        el.style.height = `${vv.height}px`;
        if (!fitted && atBottom && log) requestAnimationFrame(() => (log.scrollTop = log.scrollHeight));
        fitted = true;
      } else if (fitted) {
        el.classList.remove("keyboard-fit");
        el.style.top = "";
        el.style.height = "";
        fitted = false;
      }
    };
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);
}

export function ChatRoomPage({ teamId }: { teamId: string }) {
  const me = useMe();
  const rooms = useQuery<{ rooms: Room[] }>("/chat/rooms");
  const room = rooms.data?.rooms.find((r) => String(r.teamId) === teamId) ?? null;
  useDocumentTitle(room ? `Chat ${room.teamName}` : "Chat");
  const [messages, setMessages] = useState<Message[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [state, setState] = useState<{ canWrite: boolean; isMod: boolean; muted: boolean }>({ canWrite: false, isMod: false, muted: false });
  const [conn, setConn] = useState<Conn>("connecting");
  const [ready, setReady] = useState(false);
  const [text, setText] = useState("");
  const [caret, setCaret] = useState(0);
  const [mentionable, setMentionable] = useState<Mentionable[]>([]);
  const chosen = useRef(new Map<string, number>());
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [selected, setSelected] = useState<Message | null>(null);
  const [picking, setPicking] = useState<number | null>(null);
  const [whoFor, setWhoFor] = useState<Message | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const ws = useRef<WebSocket | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLElement>(null);
  useKeyboardFit(pageRef, logRef);
  const stickToBottom = useRef(true);
  const retry = useRef(0);
  const alive = useRef(true);
  const lastRead = useRef(0);

  const send = (data: unknown) => {
    if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify(data));
  };

  const markRead = (list: Message[]) => {
    const last = list.filter((m) => !m.pending).at(-1);
    if (last && last.id > lastRead.current && document.visibilityState === "visible") {
      lastRead.current = last.id;
      send({ type: "read", id: last.id });
      // Gelesene Erwähnungen verschwinden aus der Zahl am App-Icon
      refreshBadge(1500);
    }
  };

  useEffect(() => {
    alive.current = true;
    if (!room?.canRead) return;
    let timer: number | undefined;
    const connect = () => {
      setConn("connecting");
      const socket = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/chat/${teamId}/connect`);
      ws.current = socket;
      // Hängt der Aufbau (schlechter Empfang), kommt nie ein close. Dann selbst neu verbinden.
      const helloTimeout = window.setTimeout(() => socket.close(), HELLO_TIMEOUT_MS);
      socket.onopen = () => {
        retry.current = 0;
      };
      socket.onmessage = (ev) => {
        const msg = JSON.parse(ev.data as string);
        switch (msg.type) {
          case "hello":
            window.clearTimeout(helloTimeout);
            // Erst mit der Begrüßung stehen die Schreibrechte fest, vorher ginge ein Senden verloren
            setConn("open");
            setState(msg.me);
            setMentionable(msg.mentionable ?? []);
            setMessages(msg.messages);
            setHasMore(msg.hasMore);
            setReady(true);
            stickToBottom.current = true;
            lastRead.current = 0;
            setTimeout(() => markRead(msg.messages), 0);
            break;
          case "message":
            // Wer schreibt, kann ab jetzt erwähnt werden
            if (msg.message.authorId && msg.message.authorName && !msg.message.isFormer) {
              setMentionable((list) =>
                list.some((m) => m.personId === msg.message.authorId) ? list : [...list, { personId: msg.message.authorId, name: msg.message.authorName }],
              );
            }
            setMessages((list) => {
              if (list.some((m) => m.id === msg.message.id)) return list;
              const next = [...list, msg.message];
              setTimeout(() => markRead(next), 0);
              return next;
            });
            break;
          case "ack":
            setMessages((list) => {
              const withoutPending = list.filter((m) => m.pending !== msg.clientId);
              return withoutPending;
            });
            break;
          case "deleted":
            setMessages((list) => list.map((m) => (m.id === msg.id ? { ...m, deleted: true, text: null, reactions: [] } : m)));
            break;
          case "reactions":
            stickToBottom.current = false;
            setMessages((list) => list.map((m) => (m.id === msg.id ? { ...m, reactions: msg.reactions } : m)));
            break;
          case "history":
            stickToBottom.current = false;
            setMessages((list) => [...msg.messages.filter((m: Message) => !list.some((x) => x.id === m.id)), ...list]);
            setHasMore(msg.hasMore);
            break;
          case "state":
            setState((s) => ({ ...s, canWrite: msg.canWrite, muted: msg.muted }));
            break;
          case "cleared":
            setMessages([]);
            break;
          case "error":
            toast(msg.message, "error");
            break;
        }
      };
      socket.onclose = (ev) => {
        window.clearTimeout(helloTimeout);
        setConn("closed");
        if (!alive.current) return;
        if (ev.code === 4003) {
          // Kein Zugriff mehr, z. B. weil die Mannschaft ohne Eltern geführt wird
          setMessages([]);
          toast(ev.reason || "Du hast keinen Zugriff mehr auf diesen Chat.", "error");
          invalidate("/chat/rooms");
          return;
        }
        const delay = [1000, 2000, 5000, 10000, 20000][Math.min(retry.current++, 4)]!;
        timer = window.setTimeout(connect, delay);
      };
    };
    connect();
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        if (ws.current?.readyState === WebSocket.CLOSED) {
          window.clearTimeout(timer);
          connect();
        } else {
          setMessages((list) => {
            markRead(list);
            return list;
          });
        }
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive.current = false;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      ws.current?.close();
      invalidate("/chat/rooms");
    };
  }, [room?.canRead, teamId]);

  // Offline: den zuletzt gesehenen Verlauf zeigen, bis die Verbindung steht
  useEffect(() => {
    if (!room?.canRead) return;
    let cancelled = false;
    void loadOffline<Message[]>(`chat-${teamId}`).then((cached) => {
      if (cancelled || !cached?.length) return;
      setMessages((list) => (list.length ? list : cached));
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [room?.canRead, teamId]);

  // Sofort speichern: Wer den Chat gleich wieder verlässt, soll ihn trotzdem offline haben
  useEffect(() => {
    if (conn !== "open" || !ready) return;
    void saveOffline(`chat-${teamId}`, messages.filter((m) => !m.pending).slice(-100));
  }, [messages, conn, ready, teamId]);

  useLayoutEffect(() => {
    const el = logRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  if (rooms.loading) return <Spinner />;
  if (!room) {
    return (
      <main class="page">
        <TopBar title="Chat" back="/chat" />
        <div class="content">
          <Notice kind="warn">Diesen Chat gibt es nicht oder du hast keinen Zugriff.</Notice>
        </div>
      </main>
    );
  }

  const parentOnly = room.viaChildren.length > 0 && !room.isMember && !room.isMod;

  const header = (
    <header class="topbar" style={{ gap: "12px" }}>
      <a class="icon-btn" href="/chat" aria-label="Zurück zur Chatliste" onClick={(e) => {
        e.preventDefault();
        if (history.length > 1) history.back();
        else location.assign("/chat");
      }}>
        <Icon name="back" size={24} stroke={2.2} />
      </a>
      <div
        class="logo-mark"
        style={{ width: "44px", height: "44px", fontSize: room.teamName.length > 3 ? "14px" : "18px", borderRadius: "12px", flexShrink: 0 }}
        aria-hidden="true"
      >
        {/* Lange Namen (z. B. KiHaSL/JuHaSL) passen nicht in das Feld */}
        {room.teamName.length > 5 ? <Icon name="chat" size={22} /> : room.teamName}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <h1 style={{ fontSize: "24px" }}>{room.isGroup ? "Gruppenchat" : "Mannschaftschat"}</h1>
        <div style={{ fontSize: "13px", color: "var(--on-dark-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {conn === "open"
            ? room.isGroup
              ? room.teamName
              : "Spielerinnen, Trainer und Eltern"
            : conn === "connecting"
              ? "Verbinde …"
              : "Offline – verbinde neu …"}
        </div>
      </div>
      {parentOnly ? (
        <button type="button" class="icon-btn" aria-label="Chat-Einstellungen" onClick={() => setMenuOpen(true)}>
          <Icon name="more" size={22} />
        </button>
      ) : null}
    </header>
  );

  if (!room.canRead) {
    return (
      <main class="page no-tabs">
        {header}
        <div class="content">
          <Notice>{room.reason}</Notice>
          {room.optedOut ? (
            <Button
              variant="primary"
              onClick={async () => {
                await api.put(`/chat/${room.teamId}/optout`, { optedOut: false });
                await rooms.reload();
                toast("Du bist wieder im Chat angemeldet.");
              }}
            >
              Wieder anmelden
            </Button>
          ) : null}
        </div>
      </main>
    );
  }

  const submit = () => {
    const value = text.trim();
    if (!value || !state.canWrite) return;
    if (ws.current?.readyState !== WebSocket.OPEN) {
      toast("Keine Verbindung. Die Nachricht wurde nicht gesendet.", "error");
      return;
    }
    const clientId = `c${Date.now()}`;
    stickToBottom.current = true;
    setMessages((list) => [
      ...list,
      { id: Number.MAX_SAFE_INTEGER - list.length, kind: "user", authorId: me.person.id, authorName: me.person.firstName, authorLabel: null, isFormer: false, text: value, createdAt: new Date().toISOString(), deleted: false, pending: clientId },
    ]);
    // Nur Erwähnungen, deren @Name noch im Text steht
    const used = [...chosen.current].filter(([name]) => value.includes(`@${name}`)).map(([, id]) => id);
    const mentions = used.filter((id) => id !== ALL.personId);
    const mentionAll = state.isMod && used.includes(ALL.personId);
    send({ type: "send", text: value, clientId, mentions, mentionAll });
    chosen.current.clear();
    setText("");
  };

  const nameById = new Map(mentionable.map((m) => [m.personId, m.name]));
  for (const m of messages) if (m.authorId && m.authorName && !nameById.has(m.authorId)) nameById.set(m.authorId, m.authorName);
  const forMe = new Set([me.person.id, ...me.children.map((c) => c.id)]);
  const query = mentionQuery(text, caret);
  const candidates = state.isMod ? [ALL, ...mentionable] : mentionable;
  const suggestions = query
    ? candidates.filter((m) => m.personId !== me.person.id && m.name.toLowerCase().startsWith(query.query.toLowerCase())).slice(0, 5)
    : [];
  const pickMention = (m: Mentionable) => {
    if (!query) return;
    const next = `${text.slice(0, query.start)}@${m.name} ${text.slice(caret)}`;
    chosen.current.set(m.name, m.personId);
    const pos = query.start + m.name.length + 2;
    // Sofort ins Feld schreiben: wer gleich weitertippt, soll nicht im alten Text landen
    const el = inputRef.current;
    if (el) {
      el.value = next;
      el.focus();
      el.setSelectionRange(pos, pos);
    }
    setText(next);
    setCaret(pos);
  };

  let lastDay = "";
  return (
    <main class="chat-page" ref={pageRef}>
      {header}
      <div
        class="chat-log"
        ref={logRef}
        aria-live="polite"
        aria-label="Nachrichten"
        onScroll={(e) => {
          const el = e.currentTarget as HTMLDivElement;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
      >
        {!ready ? <Spinner label="Nachrichten werden geladen" /> : null}
        {hasMore ? (
          <button type="button" class="btn btn-sm btn-ghost" style={{ alignSelf: "center" }} onClick={() => send({ type: "history", before: messages[0]?.id })}>
            Ältere Nachrichten laden
          </button>
        ) : null}
        {ready && !messages.length ? (
          <Empty title="Noch keine Nachrichten" icon="chat">
            {room.isGroup ? `Schreib die erste Nachricht an die Gruppe ${room.teamName}.` : `Schreib die erste Nachricht an die ${room.teamName}.`}
          </Empty>
        ) : null}
        {messages.map((m) => {
          const day = isoToLocalDate(m.createdAt);
          const sep = day !== lastDay ? <div class="day-sep">{dayLabel(m.createdAt)}</div> : null;
          lastDay = day;
          if (m.kind === "system") {
            return (
              <>
                {sep}
                <div class="system-msg">
                  <Icon name="calendar" size={16} />
                  <span>{m.text}</span>
                </div>
              </>
            );
          }
          const mine = m.authorId === me.person.id;
          const isCoach = m.authorLabel === "Coach";
          if (m.kind === "announcement") {
            const reactionsA = m.reactions ?? [];
            const myA = reactionsA.find((r) => r.mine)?.emoji ?? null;
            const canReactA = state.canWrite && conn === "open" && !mine && !m.deleted;
            return (
              <>
                {sep}
                <div class="announcement">
                  {state.isMod && !m.deleted ? (
                    <button type="button" class="announcement-head" onClick={() => setSelected(m)} aria-label={`Ankündigung von ${m.authorName}, Optionen`}>
                      <Icon name="bell" size={16} /> Ankündigung · {m.authorName}
                    </button>
                  ) : (
                    <div class="announcement-head">
                      <Icon name="bell" size={16} /> Ankündigung · {m.authorName}
                    </div>
                  )}
                  <div class="text">{m.deleted ? "Ankündigung wurde entfernt" : m.text}</div>
                  <div class="announcement-foot">
                    <ReactionChips reactions={reactionsA} onOpen={() => setWhoFor(m)} />
                    <span class="time">{clock(m.createdAt)}</span>
                    {canReactA ? (
                      <button
                        type="button"
                        class="react-btn"
                        aria-label={picking === m.id ? "Reaktionen schließen" : `Auf Ankündigung von ${m.authorName} reagieren`}
                        aria-expanded={picking === m.id ? "true" : "false"}
                        onClick={() => setPicking(picking === m.id ? null : m.id)}
                      >
                        {myA ?? <Icon name="smile" size={18} />}
                      </button>
                    ) : null}
                  </div>
                  {picking === m.id && canReactA ? (
                    <ReactionPicker
                      current={myA}
                      onPick={(emoji) => {
                        send({ type: "react", id: m.id, emoji: emoji === myA ? null : emoji });
                        setPicking(null);
                      }}
                    />
                  ) : null}
                </div>
              </>
            );
          }
          const bubble = (
            <>
              {!mine ? (
                <div class="who">
                  <span class={`name ${m.isFormer ? "former" : ""}`}>{m.authorName}</span>
                  {isCoach ? <span class="badge">Coach</span> : m.authorLabel ? <span class="role">{m.authorLabel}</span> : null}
                </div>
              ) : null}
              <div class="text">
                {m.deleted ? (
                  "Nachricht wurde von einem Trainer entfernt"
                ) : (
                  <MessageText
                    text={m.text ?? ""}
                    names={[...(m.mentionAll ? [ALL.name] : []), ...(m.mentions ?? []).map((id) => nameById.get(id)).filter((n): n is string => !!n)]}
                  />
                )}
              </div>
              <div class="time">{m.pending ? "wird gesendet …" : clock(m.createdAt)}</div>
            </>
          );
          const mentioned = !mine && (!!m.mentionAll || (m.mentions ?? []).some((id) => forMe.has(id)));
          // Auf eigene Nachrichten reagiert man nicht, Ehemalige und System bleiben außen vor
          const canReact = state.canWrite && conn === "open" && !mine && !m.deleted && !m.pending && m.authorId != null;
          const reactions = m.reactions ?? [];
          const myReaction = reactions.find((r) => r.mine)?.emoji ?? null;
          const react = (emoji: string) => {
            send({ type: "react", id: m.id, emoji: emoji === myReaction ? null : emoji });
            setPicking(null);
          };
          return (
            <>
              {sep}
              <div class={`msg ${mine ? "mine" : ""} ${m.pending ? "pending" : ""} ${mentioned ? "mentioned" : ""}`}>
                {!mine ? <PersonAvatar personId={m.authorId} name={m.authorName ?? "?"} coach={isCoach} /> : null}
                <div class="msg-body">
                  {state.isMod && !m.deleted && !m.pending ? (
                    <button type="button" class={`bubble ${m.deleted ? "deleted" : ""}`} onClick={() => setSelected(m)} aria-label={`Nachricht von ${m.authorName}, Optionen`}>
                      {bubble}
                    </button>
                  ) : (
                    <div class={`bubble ${m.deleted ? "deleted" : ""}`}>{bubble}</div>
                  )}
                  {picking === m.id && canReact ? <ReactionPicker current={myReaction} onPick={react} /> : null}
                  <ReactionChips reactions={reactions} onOpen={() => setWhoFor(m)} />
                </div>
                {canReact ? (
                  <button
                    type="button"
                    class="react-btn"
                    aria-label={picking === m.id ? "Reaktionen schließen" : `Auf Nachricht von ${m.authorName} reagieren`}
                    aria-expanded={picking === m.id ? "true" : "false"}
                    onClick={() => setPicking(picking === m.id ? null : m.id)}
                  >
                    {myReaction ?? <Icon name="smile" size={18} />}
                  </button>
                ) : null}
              </div>
            </>
          );
        })}
      </div>
      {state.canWrite ? (
        <form
          class="composer"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          {suggestions.length ? (
            <ul class="mention-suggest" role="listbox" aria-label="Personen erwähnen">
              {suggestions.map((m) => (
                <li>
                  <button type="button" role="option" aria-selected="false" onMouseDown={(e) => e.preventDefault()} onClick={() => pickMention(m)}>
                    {m.personId === ALL.personId ? (
                      <>
                        <span class="avatar coach" style={{ width: "28px", height: "28px", fontSize: "13px" }} aria-hidden="true">
                          @
                        </span>
                        <span>
                          alle <span class="small muted">· alle im Chat benachrichtigen</span>
                        </span>
                      </>
                    ) : (
                      <>
                        <PersonAvatar personId={m.personId} name={m.name} size={28} />
                        <span>{m.name}</span>
                      </>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <label for="chat-input" class="sr-only">
            Nachricht schreiben
          </label>
          <textarea
            id="chat-input"
            ref={inputRef}
            rows={1}
            value={text}
            onKeyUp={(e) => setCaret((e.target as HTMLTextAreaElement).selectionStart ?? 0)}
            onClick={(e) => setCaret((e.target as HTMLTextAreaElement).selectionStart ?? 0)}
            maxLength={2000}
            placeholder={`Nachricht an ${room.teamName}`}
            onInput={(e) => {
              const el = e.target as HTMLTextAreaElement;
              setText(el.value);
              setCaret(el.selectionStart ?? el.value.length);
              el.style.height = "auto";
              el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && suggestions.length) {
                e.preventDefault();
                pickMention(suggestions[0]!);
                return;
              }
              if (e.key === "Enter" && !e.shiftKey && !window.matchMedia("(pointer: coarse)").matches) {
                e.preventDefault();
                submit();
              }
            }}
          />
          <button type="submit" class="send-btn" aria-label="Senden" disabled={!text.trim() || conn !== "open"}>
            <Icon name="send" size={20} stroke={2.2} />
          </button>
        </form>
      ) : (
        <div class="composer" style={{ justifyContent: "center" }}>
          <p class="small muted" style={{ textAlign: "center" }}>
            {state.muted ? "Du wurdest in diesem Chat stummgeschaltet." : (room.reason ?? "Du kannst in diesem Chat nur lesen.")}
          </p>
        </div>
      )}

      {selected ? (
        <Sheet open onClose={() => setSelected(null)} title="Moderation">
          <p class="muted">
            Nachricht von {selected.authorName}: „{(selected.text ?? "").slice(0, 120)}“
          </p>
          <Button
            variant="danger"
            icon="trash"
            onClick={() => {
              send({ type: "delete", id: selected.id });
              setSelected(null);
              toast("Nachricht entfernt.");
            }}
          >
            Nachricht entfernen
          </Button>
          {selected.authorId && selected.authorId !== me.person.id && selected.kind !== "announcement" ? (
            <>
              <Button
                onClick={async () => {
                  await api.post(`/chat/${teamId}/mutes/${selected.authorId}`, { muted: true });
                  toast(`${selected.authorName} ist stummgeschaltet.`);
                  setSelected(null);
                }}
              >
                {selected.authorName} stummschalten
              </Button>
              <Button
                variant="ghost"
                onClick={async () => {
                  await api.post(`/chat/${teamId}/mutes/${selected.authorId}`, { muted: false });
                  toast("Stummschaltung aufgehoben.");
                  setSelected(null);
                }}
              >
                Stummschaltung aufheben
              </Button>
            </>
          ) : null}
        </Sheet>
      ) : null}

      {whoFor ? (
        <Sheet open onClose={() => setWhoFor(null)} title="Reaktionen">
          <ul class="list">
            {(messages.find((x) => x.id === whoFor.id)?.reactions ?? []).flatMap((r) =>
              r.names.map((name) => (
                <li class="list-row">
                  <span aria-hidden="true" style={{ fontSize: "22px" }}>
                    {r.emoji}
                  </span>
                  <span class="main">
                    <span class="title">{name}</span>
                    <span class="sub">{REACTIONS.find((x) => x.emoji === r.emoji)?.label}</span>
                  </span>
                </li>
              )),
            )}
          </ul>
        </Sheet>
      ) : null}

      {menuOpen ? (
        <Sheet open onClose={() => setMenuOpen(false)} title="Chat-Einstellungen">
          <p class="muted">
            Du bist als Elternteil von {room.viaChildren.join(" und ")} im Chat. Wenn du dich abmeldest, bekommst du keine Nachrichten und keine Chat-Benachrichtigungen
            mehr. Anmelden kannst du dich jederzeit wieder.
          </p>
          <Button
            variant="danger"
            onClick={async () => {
              await api.put(`/chat/${room.teamId}/optout`, { optedOut: true });
              setMenuOpen(false);
              await rooms.reload();
              toast("Vom Chat abgemeldet.");
            }}
          >
            Vom Chat abmelden
          </Button>
        </Sheet>
      ) : null}
    </main>
  );
}
