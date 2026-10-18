import { DurableObject } from "cloudflare:workers";
import { enqueuePush, notifyPersons } from "../domain/notify";
import { all, run } from "../lib/db";

// Ein Chatraum pro Mannschaft. Der Worker prüft die Berechtigung und reicht
// die Identität per Header weiter; das Durable Object ist von außen nicht
// erreichbar.

export interface ChatAttachment {
  accountId: number;
  personId: number;
  name: string;
  label: string | null;
  baseCanWrite: boolean;
  muted: boolean;
  isMod: boolean;
  /** May delete messages: moderator and not in a read-only admin view. Missing in attachments from older versions. */
  canModerate?: boolean;
  /** Nur als Elternteil im Chat (nicht Mitglied, nicht Trainer). */
  viaChildren?: boolean;
}

/** announcement: Rundnachricht eines Admins aus der Verwaltung. */
export type MessageKind = "user" | "system" | "announcement";

export interface ChatMessage {
  id: number;
  kind: MessageKind;
  authorId: number | null;
  authorName: string | null;
  authorLabel: string | null;
  isFormer: boolean;
  text: string | null;
  createdAt: string;
  deleted: boolean;
  /** Erwähnte Personen (@Name). */
  mentions: number[];
  /** @alle, nur von Trainern und Admins. */
  mentionAll: boolean;
  /** Emoji-Reaktionen, je Person höchstens eine. */
  reactions: ChatReaction[];
}

export interface ChatReaction {
  emoji: string;
  /** Namen wie im Chat, Ehemalige nur für Trainer sichtbar. */
  names: string[];
  /** Die Reaktion der verbundenen Person. */
  mine: boolean;
}

/** Erlaubte Reaktionen, in dieser Reihenfolge angezeigt. */
export const REACTIONS = ["👍", "❤️", "😂", "😢", "👋"] as const;

/** In der Spalte mentions steht 0 für @alle (Personen-IDs beginnen bei 1). */
const ALL = 0;

/** Wer per @ erwähnt werden kann: wer im Chat schon geschrieben hat, und Trainer. */
export interface Mentionable {
  personId: number;
  name: string;
}

type ReactionRow = { message_id: number; person_id: number; emoji: string; name: string | null; is_former: number | null };

type MessageRow = {
  id: number;
  kind: MessageKind;
  person_id: number | null;
  text: string;
  created_at: string;
  deleted_at: string | null;
  mentions: string | null;
  name: string | null;
  label: string | null;
  is_former: number | null;
};

const PAGE = 60;
const MAX_LENGTH = 2000;
const MAX_MENTIONS = 10;
/** Pushes für neue Nachrichten werden gebündelt. */
const PUSH_DELAY_MS = 20_000;
export const FORMER_LABEL = "Ehemalige/r Spieler/in";
/** Name gelöschter Personen in Chats, für alle gleich (auch für Trainer). */
export const DELETED_NAME = "Gelöschte Person";

export class ChatRoom extends DurableObject<Env> {
  private sql: SqlStorage;
  private rate = new Map<number, number[]>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL DEFAULT 'user',
        person_id INTEGER,
        text TEXT NOT NULL,
        created_at TEXT NOT NULL,
        deleted_at TEXT,
        deleted_by INTEGER
      );
      CREATE TABLE IF NOT EXISTS authors (
        person_id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        label TEXT,
        is_former INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS reactions (
        message_id INTEGER NOT NULL,
        person_id INTEGER NOT NULL,
        emoji TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (message_id, person_id)
      );
    `);
    // Spalte für Erwähnungen in bestehenden Chaträumen nachrüsten
    const columns = this.sql.exec<{ name: string }>("PRAGMA table_info(messages)").toArray();
    if (!columns.some((c) => c.name === "mentions")) this.sql.exec("ALTER TABLE messages ADD COLUMN mentions TEXT");
  }

  /**
   * Wen man mit @ erwähnen kann. Mannschaften: wer schon geschrieben hat, und die Trainer
   * (Schutz der Kinder). Gruppen: alle Mitglieder und Verantwortlichen (docs/entscheidungen.md, Gruppen).
   */
  private async mentionable(): Promise<Mentionable[]> {
    const local = this.sql
      .exec<{ person_id: number; name: string }>(
        `SELECT a.person_id, a.name FROM authors a
          WHERE a.is_former = 0
            AND (a.label IN ('Coach', 'Verantwortlich') OR EXISTS (SELECT 1 FROM messages m WHERE m.person_id = a.person_id AND m.kind = 'user' AND m.deleted_at IS NULL))
          ORDER BY a.name`,
      )
      .toArray()
      .map((r) => ({ personId: r.person_id, name: r.name }));
    const teamId = this.teamId();
    if (!teamId) return local;
    const members = await all<{ id: number; first_name: string; last_name: string | null }>(
      this.env.DB,
      `SELECT DISTINCT p.id, p.first_name, p.last_name FROM team_memberships tm
         JOIN teams t ON t.id = tm.team_id AND t.kind = 'group'
         JOIN persons p ON p.id = tm.person_id AND p.is_former = 0
        WHERE tm.team_id = ?`,
      teamId,
    );
    if (!members.length) return local;
    const byId = new Map(local.map((m) => [m.personId, m]));
    for (const p of members) {
      if (!byId.has(p.id)) byId.set(p.id, { personId: p.id, name: p.last_name ? `${p.first_name} ${p.last_name.charAt(0)}.` : p.first_name });
    }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, "de"));
  }

  private teamId(): number {
    const row = this.sql.exec<{ value: string }>("SELECT value FROM meta WHERE key = 'team_id'").toArray()[0];
    return row ? Number(row.value) : 0;
  }

  private rememberTeam(request: Request) {
    const id = request.headers.get("x-team-id");
    if (id && /^\d+$/.test(id)) {
      this.sql.exec("INSERT INTO meta (key, value) VALUES ('team_id', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", id);
    }
  }

  override async fetch(request: Request): Promise<Response> {
    this.rememberTeam(request);
    const url = new URL(request.url);
    if (url.pathname === "/connect") return this.openSocket(request);
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    switch (url.pathname) {
      case "/system":
        if (typeof body.text === "string" && body.text.trim()) await this.addMessage("system", null, body.text.trim().slice(0, 300));
        return Response.json({ ok: true });
      case "/announce": {
        // Rundnachricht (worker/routes/chat.ts prüft, dass ein Admin sendet)
        const personId = Number(body.personId);
        const text = typeof body.text === "string" ? body.text.trim().slice(0, MAX_LENGTH) : "";
        if (!personId || !text) return Response.json({ ok: false }, { status: 400 });
        this.sql.exec("INSERT OR IGNORE INTO authors (person_id, name, label) VALUES (?, ?, NULL)", personId, String(body.name ?? ""));
        const id = await this.addMessage("announcement", personId, text, body.notify === true ? [ALL] : []);
        return Response.json({ ok: true, id });
      }
      case "/forget": {
        // Person wurde gelöscht: Nachrichten bleiben anonym, Reaktionen verschwinden
        const ids = Array.isArray(body.personIds) ? body.personIds.filter((x): x is number => typeof x === "number") : [];
        for (const id of ids) {
          this.sql.exec("UPDATE authors SET name = ?, label = NULL, is_former = 1 WHERE person_id = ?", DELETED_NAME, id);
          const reacted = this.sql.exec<{ message_id: number }>("SELECT message_id FROM reactions WHERE person_id = ?", id).toArray();
          this.sql.exec("DELETE FROM reactions WHERE person_id = ?", id);
          for (const { message_id } of reacted) {
            const rows = this.reactionRows([message_id]);
            this.broadcast((viewer) => ({ type: "reactions", id: message_id, reactions: this.reactionsFor(message_id, rows, viewer) }));
          }
        }
        return Response.json({ ok: true });
      }
      case "/former":
        this.sql.exec("UPDATE authors SET is_former = 1 WHERE person_id = ?", Number(body.personId));
        return Response.json({ ok: true });
      case "/mute":
        this.setMuted(Number(body.personId), body.muted === true);
        return Response.json({ ok: true });
      case "/parents-off":
        // Die Mannschaft wird ab jetzt ohne Eltern geführt
        for (const ws of this.ctx.getWebSockets()) {
          const att = ws.deserializeAttachment() as ChatAttachment | null;
          if (att?.viaChildren) ws.close(4003, "In dieser Mannschaft sind keine Eltern eingebunden.");
        }
        return Response.json({ ok: true });
      case "/export":
        return Response.json({
          messages: this.sql.exec("SELECT id, kind, person_id, text, created_at, deleted_at FROM messages ORDER BY id").toArray(),
          authors: this.sql.exec("SELECT person_id, name, label, is_former FROM authors").toArray(),
          reactions: this.sql.exec("SELECT message_id, person_id, emoji, created_at FROM reactions ORDER BY message_id").toArray(),
        });
      case "/clear":
        this.sql.exec("DELETE FROM messages; DELETE FROM authors; DELETE FROM reactions; DELETE FROM meta WHERE key <> 'team_id';");
        if (this.teamId()) await run(this.env.DB, "DELETE FROM chat_mentions WHERE team_id = ?", this.teamId()).catch(() => undefined);
        for (const ws of this.ctx.getWebSockets()) this.send(ws, { type: "cleared" });
        return Response.json({ ok: true });
      default:
        return new Response("Not found", { status: 404 });
    }
  }

  private async openSocket(request: Request): Promise<Response> {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return new Response("Expected websocket", { status: 426 });
    const h = request.headers;
    const attachment: ChatAttachment = {
      accountId: Number(h.get("x-account-id")),
      personId: Number(h.get("x-person-id")),
      name: decodeURIComponent(h.get("x-name") ?? ""),
      label: h.get("x-label") ? decodeURIComponent(h.get("x-label")!) : null,
      baseCanWrite: h.get("x-can-write") === "1",
      muted: h.get("x-muted") === "1",
      isMod: h.get("x-is-mod") === "1",
      canModerate: h.get("x-can-moderate") === "1",
      viaChildren: h.get("x-via-children") === "1",
    };
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment(attachment);
    this.sql.exec(
      `INSERT INTO authors (person_id, name, label) VALUES (?, ?, ?)
       ON CONFLICT(person_id) DO UPDATE SET name = excluded.name, label = excluded.label`,
      attachment.personId,
      attachment.name,
      attachment.label,
    );
    const messages = this.page(null, attachment);
    this.send(server, {
      type: "hello",
      me: { personId: attachment.personId, canWrite: attachment.baseCanWrite && !attachment.muted, isMod: attachment.isMod, muted: attachment.muted },
      messages,
      hasMore: messages.length === PAGE,
      mentionable: await this.mentionable(),
    });
    return new Response(null, { status: 101, webSocket: client });
  }

  private page(beforeId: number | null, viewer: ChatAttachment): ChatMessage[] {
    const rows = this.sql
      .exec<MessageRow>(
        `SELECT m.id, m.kind, m.person_id, m.text, m.created_at, m.deleted_at, m.mentions, a.name, a.label, a.is_former
           FROM messages m LEFT JOIN authors a ON a.person_id = m.person_id
          WHERE (? IS NULL OR m.id < ?) ORDER BY m.id DESC LIMIT ?`,
        beforeId,
        beforeId,
        PAGE,
      )
      .toArray();
    const reactions = this.reactionRows(rows.map((r) => r.id));
    return rows.reverse().map((r) => this.view(r, viewer, reactions));
  }

  private reactionRows(messageIds: number[]): ReactionRow[] {
    if (!messageIds.length) return [];
    return this.sql
      .exec<ReactionRow>(
        `SELECT r.message_id, r.person_id, r.emoji, a.name, a.is_former FROM reactions r LEFT JOIN authors a ON a.person_id = r.person_id
          WHERE r.message_id IN (SELECT value FROM json_each(?)) ORDER BY r.created_at`,
        JSON.stringify(messageIds),
      )
      .toArray();
  }

  private reactionsFor(messageId: number, rows: ReactionRow[], viewer: ChatAttachment): ChatReaction[] {
    const out: ChatReaction[] = [];
    for (const emoji of REACTIONS) {
      const hits = rows.filter((r) => r.message_id === messageId && r.emoji === emoji);
      if (!hits.length) continue;
      out.push({
        emoji,
        names: hits.map((r) => (r.is_former === 1 && !viewer.isMod ? FORMER_LABEL : (r.name ?? "?"))),
        mine: hits.some((r) => r.person_id === viewer.personId),
      });
    }
    return out;
  }

  private view(r: MessageRow, viewer: ChatAttachment, reactions: ReactionRow[] = []): ChatMessage {
    const isMod = viewer.isMod;
    const former = r.is_former === 1;
    const deleted = r.name === DELETED_NAME;
    const hideName = (former && !isMod) || deleted;
    return {
      id: r.id,
      kind: r.kind,
      authorId: hideName ? null : r.person_id,
      authorName: r.kind === "system" ? null : deleted ? DELETED_NAME : hideName ? FORMER_LABEL : r.name,
      authorLabel: hideName ? null : r.label,
      isFormer: former,
      text: r.deleted_at ? null : r.text,
      createdAt: r.created_at,
      deleted: r.deleted_at != null,
      mentions: r.deleted_at || !r.mentions ? [] : (JSON.parse(r.mentions) as number[]).filter((id) => id !== ALL),
      mentionAll: !r.deleted_at && !!r.mentions && (JSON.parse(r.mentions) as number[]).includes(ALL),
      reactions: r.deleted_at ? [] : this.reactionsFor(r.id, reactions, viewer),
    };
  }

  private send(ws: WebSocket, data: unknown) {
    try {
      ws.send(JSON.stringify(data));
    } catch {
      // Verbindung bereits geschlossen
    }
  }

  private broadcast(build: (att: ChatAttachment) => unknown) {
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as ChatAttachment | null;
      if (att) this.send(ws, build(att));
    }
  }

  private async addMessage(kind: MessageKind, personId: number | null, text: string, mentions: number[] = []): Promise<number> {
    const createdAt = new Date().toISOString();
    const row = this.sql
      .exec<{ id: number }>(
        "INSERT INTO messages (kind, person_id, text, created_at, mentions) VALUES (?, ?, ?, ?, ?) RETURNING id",
        kind,
        personId,
        text,
        createdAt,
        mentions.length ? JSON.stringify(mentions) : null,
      )
      .one();
    const message = this.sql
      .exec<MessageRow>(
        `SELECT m.id, m.kind, m.person_id, m.text, m.created_at, m.deleted_at, m.mentions, a.name, a.label, a.is_former
           FROM messages m LEFT JOIN authors a ON a.person_id = m.person_id WHERE m.id = ?`,
        row.id,
      )
      .one();
    this.broadcast((att) => ({ type: "message", message: this.view(message, att) }));
    const teamId = this.teamId();
    if (teamId) {
      await run(
        this.env.DB,
        `INSERT INTO chat_state (team_id, last_message_id, last_message_at) VALUES (?, ?, ?)
         ON CONFLICT(team_id) DO UPDATE SET last_message_id = excluded.last_message_id, last_message_at = excluded.last_message_at`,
        teamId,
        row.id,
        createdAt,
      ).catch((err) => console.warn("chat_state", err));
      if (mentions.length) await this.notifyMentions(teamId, row.id, message, mentions);
    }
    if (kind !== "system" && !(await this.ctx.storage.getAlarm())) {
      await this.ctx.storage.setAlarm(Date.now() + PUSH_DELAY_MS);
    }
    return row.id;
  }

  /** Erwähnte sofort benachrichtigen (bei Kindern auch die zuständigen Eltern) und für die Zahl am Icon merken. */
  private async notifyMentions(teamId: number, messageId: number, message: MessageRow, mentions: number[]) {
    try {
      const all_ = mentions.includes(ALL);
      const persons = mentions.filter((id) => id !== ALL);
      const statements = persons.map((personId) =>
        this.env.DB.prepare("INSERT OR IGNORE INTO chat_mentions (team_id, message_id, person_id) VALUES (?, ?, ?)").bind(teamId, messageId, personId),
      );
      if (all_) {
        // @alle: alle Mitglieder. Eltern zählen über ihre Kinder; ob ein Kind ohne
        // Lesefreigabe mitzählt, entscheidet die Zählung (worker/domain/badge.ts)
        statements.push(
          this.env.DB.prepare(
            `INSERT OR IGNORE INTO chat_mentions (team_id, message_id, person_id)
             SELECT DISTINCT ?1, ?2, tm.person_id FROM team_memberships tm JOIN persons p ON p.id = tm.person_id AND p.is_former = 0
              WHERE tm.team_id = ?1 AND tm.person_id <> ?3`,
          ).bind(teamId, messageId, message.person_id),
        );
      }
      if (statements.length) await this.env.DB.batch(statements);
      const team = await all<{ name: string }>(this.env.DB, "SELECT name FROM teams WHERE id = ?", teamId);
      const author = await all<{ id: number }>(this.env.DB, "SELECT id FROM accounts WHERE person_id = ?", message.person_id);
      const payload = {
        title:
          message.kind === "announcement"
            ? `Ankündigung im Chat ${team[0]?.name ?? ""}`.trim()
            : all_
              ? `An alle im Chat ${team[0]?.name ?? ""}`.trim()
              : `Erwähnung im Chat ${team[0]?.name ?? ""}`.trim(),
        body: `${message.name ?? ""}: ${message.text.slice(0, 140)}`,
        url: `/chat/${teamId}`,
        tag: `mention-${teamId}-${messageId}`,
      };
      const exclude = author.map((a) => a.id);
      if (all_) {
        // Dieselben Empfänger wie Chat-Pushes, aber nach der Einstellung für Erwähnungen
        const recipients = await chatPushRecipients(this.env.DB, teamId, messageId, "mentions");
        await enqueuePush(this.env, [...new Set(recipients.map((r) => r.account_id))], payload, { exclude });
      } else {
        await notifyPersons(this.env, persons, "mentions", payload, { teamIds: [teamId], exclude });
      }
    } catch (err) {
      console.warn("Erwähnung", err);
    }
  }

  private setMuted(personId: number, muted: boolean) {
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as ChatAttachment | null;
      if (!att || att.personId !== personId) continue;
      att.muted = muted;
      ws.serializeAttachment(att);
      this.send(ws, { type: "state", canWrite: att.baseCanWrite && !muted, muted });
    }
  }

  private allowed(accountId: number): boolean {
    const now = Date.now();
    const recent = (this.rate.get(accountId) ?? []).filter((t) => now - t < 10_000);
    if (recent.length >= 8) return false;
    recent.push(now);
    this.rate.set(accountId, recent);
    return true;
  }

  override async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const att = ws.deserializeAttachment() as ChatAttachment | null;
    if (!att || typeof raw !== "string" || raw.length > 10_000) return;
    let msg: { type?: string; text?: unknown; id?: unknown; before?: unknown; clientId?: unknown; mentions?: unknown; mentionAll?: unknown; emoji?: unknown };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    switch (msg.type) {
      case "send": {
        const text = typeof msg.text === "string" ? msg.text.trim() : "";
        if (!att.baseCanWrite || att.muted) {
          this.send(ws, { type: "error", message: att.muted ? "Du bist in diesem Chat stummgeschaltet." : "Du kannst in diesem Chat nur lesen." });
          return;
        }
        if (!text) return;
        if (text.length > MAX_LENGTH) {
          this.send(ws, { type: "error", message: `Nachrichten dürfen höchstens ${MAX_LENGTH} Zeichen lang sein.` });
          return;
        }
        if (!this.allowed(att.accountId)) {
          this.send(ws, { type: "error", message: "Bitte nicht so schnell hintereinander." });
          return;
        }
        // Nur Personen, die erwähnt werden dürfen, nie man selbst
        const allowed = new Set((await this.mentionable()).map((m) => m.personId));
        const mentions = Array.isArray(msg.mentions)
          ? [...new Set(msg.mentions.filter((m): m is number => typeof m === "number" && allowed.has(m) && m !== att.personId))].slice(0, MAX_MENTIONS)
          : [];
        // @alle dürfen nur Trainer und Admins
        if (msg.mentionAll === true && att.isMod) mentions.unshift(ALL);
        const id = await this.addMessage("user", att.personId, text, mentions);
        this.send(ws, { type: "ack", clientId: msg.clientId ?? null, id });
        await this.markRead(att.accountId, id);
        return;
      }
      case "delete": {
        if (!att.canModerate || typeof msg.id !== "number") return;
        this.sql.exec("UPDATE messages SET deleted_at = ?, deleted_by = ? WHERE id = ? AND kind IN ('user', 'announcement')", new Date().toISOString(), att.personId, msg.id);
        this.broadcast(() => ({ type: "deleted", id: msg.id }));
        const teamId = this.teamId();
        if (teamId) await run(this.env.DB, "DELETE FROM chat_mentions WHERE team_id = ? AND message_id = ?", teamId, msg.id).catch(() => undefined);
        return;
      }
      case "react": {
        // Reagieren darf, wer schreiben darf; nie auf eigene Nachrichten
        if (typeof msg.id !== "number") return;
        if (!att.baseCanWrite || att.muted) {
          this.send(ws, { type: "error", message: att.muted ? "Du bist in diesem Chat stummgeschaltet." : "Du kannst in diesem Chat nur lesen." });
          return;
        }
        const emoji = msg.emoji === null ? null : REACTIONS.find((e) => e === msg.emoji);
        if (emoji === undefined) return;
        const target = this.sql
          .exec<{ person_id: number | null }>("SELECT person_id FROM messages WHERE id = ? AND kind IN ('user', 'announcement') AND deleted_at IS NULL", msg.id)
          .toArray()[0];
        if (!target || target.person_id === att.personId) return;
        if (!this.allowed(att.accountId)) {
          this.send(ws, { type: "error", message: "Bitte nicht so schnell hintereinander." });
          return;
        }
        if (emoji) {
          this.sql.exec(
            `INSERT INTO reactions (message_id, person_id, emoji, created_at) VALUES (?, ?, ?, ?)
             ON CONFLICT (message_id, person_id) DO UPDATE SET emoji = excluded.emoji, created_at = excluded.created_at`,
            msg.id,
            att.personId,
            emoji,
            new Date().toISOString(),
          );
        } else {
          this.sql.exec("DELETE FROM reactions WHERE message_id = ? AND person_id = ?", msg.id, att.personId);
        }
        const id = msg.id;
        const rows = this.reactionRows([id]);
        this.broadcast((viewer) => ({ type: "reactions", id, reactions: this.reactionsFor(id, rows, viewer) }));
        return;
      }
      case "history": {
        const before = typeof msg.before === "number" ? msg.before : null;
        const messages = this.page(before, att);
        this.send(ws, { type: "history", messages, hasMore: messages.length === PAGE });
        return;
      }
      case "read": {
        if (typeof msg.id === "number") await this.markRead(att.accountId, msg.id);
        return;
      }
    }
  }

  private async markRead(accountId: number, id: number) {
    const teamId = this.teamId();
    if (!teamId) return;
    await run(
      this.env.DB,
      `INSERT INTO chat_reads (account_id, team_id, last_read_id) VALUES (?, ?, ?)
       ON CONFLICT(account_id, team_id) DO UPDATE SET last_read_id = max(last_read_id, excluded.last_read_id)`,
      accountId,
      teamId,
      id,
    ).catch((err) => console.warn("chat_reads", err));
  }

  override async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    try {
      ws.close(code === 1005 ? 1000 : code, "bye");
    } catch {
      // schon geschlossen
    }
  }

  /** Gebündelte Push an Mitglieder, die gerade nicht verbunden sind und noch nicht gelesen haben. */
  override async alarm(): Promise<void> {
    const teamId = this.teamId();
    if (!teamId) return;
    const pushedUpTo = Number(this.sql.exec<{ value: string }>("SELECT value FROM meta WHERE key = 'pushed_upto'").toArray()[0]?.value ?? 0);
    const fresh = this.sql
      .exec<MessageRow>(
        `SELECT m.id, m.kind, m.person_id, m.text, m.created_at, m.deleted_at, m.mentions, a.name, a.label, a.is_former
           FROM messages m LEFT JOIN authors a ON a.person_id = m.person_id
          WHERE m.id > ? AND m.kind IN ('user', 'announcement') AND m.deleted_at IS NULL ORDER BY m.id`,
        pushedUpTo,
      )
      .toArray();
    if (!fresh.length) return;
    const last = fresh[fresh.length - 1]!;
    this.sql.exec("INSERT INTO meta (key, value) VALUES ('pushed_upto', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", String(last.id));

    const connected = new Set<number>();
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as ChatAttachment | null;
      if (att) connected.add(att.accountId);
    }
    const authors = new Set(fresh.map((m) => m.person_id));
    const recipients = await chatPushRecipients(this.env.DB, teamId, last.id);
    const team = await all<{ name: string }>(this.env.DB, "SELECT name FROM teams WHERE id = ?", teamId);
    // Wer in der einzigen neuen Nachricht erwähnt wurde, hat dafür schon eine eigene Push
    const mentionedOnly = fresh.length === 1 && last.mentions ? new Set(JSON.parse(last.mentions) as number[]) : new Set<number>();
    // Bei @alle hat schon jeder eine Push bekommen
    if (mentionedOnly.has(ALL)) return;
    const targets = recipients.filter(
      (r) => !connected.has(r.account_id) && !(authors.size === 1 && authors.has(r.person_id)) && !mentionedOnly.has(r.person_id),
    );
    if (!targets.length) return;
    const author = last.is_former ? FORMER_LABEL : (last.name ?? "");
    const body =
      fresh.length === 1
        ? `${author}: ${last.text.slice(0, 140)}`
        : `${fresh.length} neue Nachrichten, zuletzt ${author}: ${last.text.slice(0, 100)}`;
    await enqueuePush(this.env, [...new Set(targets.map((t) => t.account_id))], {
      title: `Chat ${team[0]?.name ?? ""}`.trim(),
      body,
      url: `/chat/${teamId}`,
      tag: `chat-${teamId}`,
    });
  }
}

/**
 * Accounts mit Lesezugriff auf den Chat einer Mannschaft, die Chat-Pushes
 * wollen und die Nachricht noch nicht gelesen haben.
 */
export async function chatPushRecipients(db: D1Database, teamId: number, upToId: number, topic: "chat" | "mentions" = "chat") {
  return all<{ account_id: number; person_id: number }>(
    db,
    `WITH direct AS (
        SELECT a.id AS account_id, tm.person_id FROM team_memberships tm
          JOIN persons p ON p.id = tm.person_id AND p.is_former = 0
          JOIN accounts a ON a.person_id = tm.person_id AND a.disabled_at IS NULL
         WHERE tm.team_id = ?1
           AND NOT (EXISTS (SELECT 1 FROM teams t WHERE t.id = ?1 AND t.parents_enabled = 1)
                    AND EXISTS (SELECT 1 FROM guardianships g WHERE g.child_id = tm.person_id)
                    AND EXISTS (SELECT 1 FROM child_permissions cp WHERE cp.child_id = tm.person_id AND cp.may_read_chat = 0))
      ),
      parents AS (
        SELECT a.id AS account_id, g.child_id AS person_id FROM guardianships g
          JOIN team_memberships tm ON tm.person_id = g.child_id AND tm.team_id = ?1 AND tm.role IN ('player', 'helper')
          JOIN teams t ON t.id = tm.team_id AND t.parents_enabled = 1
          JOIN accounts a ON a.person_id = g.guardian_id AND a.disabled_at IS NULL
         WHERE NOT EXISTS (SELECT 1 FROM chat_optouts o WHERE o.account_id = a.id AND o.team_id = ?1)
      )
      SELECT DISTINCT x.account_id, x.person_id FROM (SELECT * FROM direct UNION SELECT * FROM parents) x
       WHERE NOT EXISTS (SELECT 1 FROM notification_settings ns
                          WHERE ns.account_id = x.account_id AND ns.person_id = x.person_id AND ns.topic = ?3 AND ns.enabled = 0)
         AND NOT EXISTS (SELECT 1 FROM chat_reads cr WHERE cr.account_id = x.account_id AND cr.team_id = ?1 AND cr.last_read_id >= ?2)`,
    teamId,
    upToId,
    topic,
  );
}
