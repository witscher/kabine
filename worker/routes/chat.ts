import { t } from "@lingui/core/macro";
import { Hono } from "hono";
import { z } from "zod";
import { type AppEnv, intParam, requireActor } from "../app";
import { type Actor, isCoachOf, requireAdmin } from "../auth/actor";
import { chatStub, postAnnouncement, setMuteInChat } from "../domain/chat";
import { currentLocale } from "../i18n";
import { all, first, run } from "../lib/db";
import { badRequest, forbidden, notFound, parse, readJson } from "../lib/http";

export const chatRoutes = new Hono<AppEnv>();

export interface ChatAccess {
  teamId: number;
  teamName: string;
  /** Group (only chat and special events) instead of a team. */
  isGroup: boolean;
  canRead: boolean;
  canWrite: boolean;
  /** Writing allowed in principle (ignoring muting). */
  writeBase: boolean;
  isMod: boolean;
  muted: boolean;
  /** Parents can opt out. */
  viaChildren: string[];
  optedOut: boolean;
  isMember: boolean;
  role: "player" | "coach" | "helper" | "staff" | null;
  reason: string | null;
  /** Only visible through admin rights (neither member, coach nor parent). */
  adminOnly: boolean;
}

/** Who may read and write which team chat? */
export async function chatAccess(db: D1Database, actor: Actor, teamIds?: number[]): Promise<ChatAccess[]> {
  const teams = await all<{ id: number; name: string; kind: string }>(
    db,
    teamIds ? "SELECT id, name, kind FROM teams WHERE id IN (SELECT value FROM json_each(?)) ORDER BY name" : "SELECT id, name, kind FROM teams ORDER BY name",
    ...(teamIds ? [JSON.stringify(teamIds)] : []),
  );
  const [childTeams, optouts, mutes] = await Promise.all([
    // Parents only take part in chats of teams with parents
    all<{ team_id: number; first_name: string }>(
      db,
      `SELECT tm.team_id, p.first_name FROM team_memberships tm JOIN persons p ON p.id = tm.person_id
         JOIN teams t ON t.id = tm.team_id AND t.parents_enabled = 1
        WHERE tm.person_id IN (SELECT value FROM json_each(?)) AND tm.role IN ('player', 'helper')`,
      JSON.stringify(actor.children.map((c) => c.id)),
    ),
    all<{ team_id: number }>(db, "SELECT team_id FROM chat_optouts WHERE account_id = ?", actor.accountId),
    all<{ team_id: number }>(db, "SELECT team_id FROM chat_mutes WHERE person_id = ?", actor.personId),
  ]);

  const out: ChatAccess[] = [];
  for (const team of teams) {
    const membership = actor.memberships.find((m) => m.teamId === team.id) ?? null;
    const viaChildren = [...new Set(childTeams.filter((c) => c.team_id === team.id).map((c) => c.first_name))];
    const isMod = isCoachOf(actor, team.id);
    if (!membership && !viaChildren.length && !isMod) continue;
    const optedOut = optouts.some((o) => o.team_id === team.id);
    const muted = mutes.some((m) => m.team_id === team.id);
    let canRead = true;
    // Read-only view of an admin (someone else): read only
    let canWriteBase = !actor.readOnly;
    let reason: string | null = null;
    const onlyAsChild = !!membership && !viaChildren.length && !isMod;
    if (onlyAsChild && actor.hasGuardians && membership.parentsEnabled) {
      canRead = actor.permissions.may_read_chat;
      canWriteBase = actor.permissions.may_write_chat && !actor.readOnly;
      if (!canRead) reason = t`Your parents have not allowed the chat for you yet.`;
      else if (!canWriteBase) reason = t`You can read along. Your parents have not allowed writing yet.`;
    }
    // Age class or team: players are not in this chat, or only read along (children in the app)
    const limits = onlyAsChild && (membership.role === "player" || membership.role === "helper") ? actor.teamLimits.get(team.id) : undefined;
    if (limits && limits.chat !== "write") {
      if (limits.chat === "none") {
        canRead = false;
        reason = t`Only the parents are in the chat of this team.`;
      } else if (canRead) {
        canWriteBase = false;
        reason = t`You can read along. In this team the parents write.`;
      }
    }
    if (!membership && viaChildren.length && !isMod && optedOut) {
      canRead = false;
      reason = t`You have opted out of this chat.`;
    }
    out.push({
      teamId: team.id,
      teamName: team.name,
      isGroup: team.kind === "group",
      canRead,
      canWrite: canRead && canWriteBase && !muted,
      writeBase: canRead && canWriteBase,
      isMod,
      muted,
      viaChildren,
      optedOut,
      isMember: !!membership,
      role: membership?.role ?? null,
      reason: muted && canRead ? t`You have been muted in this chat.` : reason,
      adminOnly: !membership && !viaChildren.length && !actor.coachTeamIds.includes(team.id),
    });
  }
  return out;
}

chatRoutes.get("/chat/rooms", async (c) => {
  const actor = requireActor(c);
  const rooms = await chatAccess(c.env.DB, actor);
  const state = await all<{ team_id: number; last_message_id: number; last_message_at: string | null; last_read_id: number | null }>(
    c.env.DB,
    `SELECT s.team_id, s.last_message_id, s.last_message_at, r.last_read_id
       FROM chat_state s LEFT JOIN chat_reads r ON r.team_id = s.team_id AND r.account_id = ?`,
    actor.accountId,
  );
  return c.json({
    rooms: rooms.map((r) => {
      const s = state.find((x) => x.team_id === r.teamId);
      return {
        ...r,
        lastMessageAt: s?.last_message_at ?? null,
        // Other people's chats do not count as unread for admins (dot in the navigation)
        unread: r.canRead && !r.adminOnly && !!s && s.last_message_id > (s.last_read_id ?? 0),
      };
    }),
  });
});

function displayName(actor: Actor): string {
  return actor.lastName ? `${actor.firstName} ${actor.lastName.charAt(0)}.` : actor.firstName;
}

chatRoutes.get("/chat/:teamId/connect", async (c) => {
  const actor = requireActor(c);
  const teamId = intParam(c, "teamId");
  if (c.req.header("upgrade")?.toLowerCase() !== "websocket") throw badRequest(t`Expected a WebSocket connection.`);
  const access = (await chatAccess(c.env.DB, actor, [teamId]))[0];
  if (!access) throw forbidden(t`You are not part of this team.`);
  if (!access.canRead) throw forbidden(access.reason ?? t`No access to this chat.`);
  // Role next to the name, stored as a code and shown in the language of each reader (room.ts, roleLabel)
  const label: string | null =
    access.role === "coach"
      ? access.isGroup
        ? "lead"
        : "coach"
      : access.role === "helper" || access.role === "staff"
        ? access.role
        : access.role === "player"
          ? null
          : access.viaChildren.length
            ? `parent:${JSON.stringify(access.viaChildren)}`
            : actor.isAdmin
              ? "admin"
              : null;
  const headers = new Headers(c.req.raw.headers);
  headers.set("x-team-id", String(teamId));
  headers.set("x-account-id", String(actor.accountId));
  headers.set("x-person-id", String(actor.personId));
  headers.set("x-name", encodeURIComponent(displayName(actor)));
  if (label) headers.set("x-label", encodeURIComponent(label));
  // Texts the chat room sends to this person (errors, labels) are in their language
  headers.set("x-locale", currentLocale());
  headers.set("x-can-write", access.writeBase ? "1" : "0");
  headers.set("x-muted", access.muted ? "1" : "0");
  headers.set("x-is-mod", access.isMod ? "1" : "0");
  // Read-only admin views (someone else's perspective) change nothing, not even by deleting messages
  headers.set("x-can-moderate", access.isMod && !actor.readOnly ? "1" : "0");
  headers.set("x-via-children", access.viaChildren.length && !access.isMember && !access.isMod ? "1" : "0");
  return chatStub(c.env, teamId).fetch(new Request("https://chat.internal/connect", { headers }));
});

chatRoutes.put("/chat/:teamId/optout", async (c) => {
  const actor = requireActor(c);
  const teamId = intParam(c, "teamId");
  const { optedOut } = parse(z.object({ optedOut: z.boolean() }), await readJson(c.req.raw));
  const access = (await chatAccess(c.env.DB, actor, [teamId]))[0];
  if (!access || !access.viaChildren.length || access.isMember) throw forbidden(t`Only parents can opt out.`);
  if (optedOut) await run(c.env.DB, "INSERT OR IGNORE INTO chat_optouts (account_id, team_id) VALUES (?, ?)", actor.accountId, teamId);
  else await run(c.env.DB, "DELETE FROM chat_optouts WHERE account_id = ? AND team_id = ?", actor.accountId, teamId);
  return c.json({ ok: true });
});

chatRoutes.post("/chat/:teamId/mutes/:personId", async (c) => {
  const actor = requireActor(c);
  const teamId = intParam(c, "teamId");
  const personId = intParam(c, "personId");
  if (!isCoachOf(actor, teamId)) throw forbidden(t`Only coaches and admins can mute people.`);
  if (personId === actor.personId) throw badRequest(t`You cannot mute yourself.`);
  const { muted } = parse(z.object({ muted: z.boolean() }), await readJson(c.req.raw));
  const person = await first(c.env.DB, "SELECT 1 AS ok FROM persons WHERE id = ?", personId);
  if (!person) throw notFound();
  if (muted) await run(c.env.DB, "INSERT OR IGNORE INTO chat_mutes (team_id, person_id, muted_by) VALUES (?, ?, ?)", teamId, personId, actor.personId);
  else await run(c.env.DB, "DELETE FROM chat_mutes WHERE team_id = ? AND person_id = ?", teamId, personId);
  await setMuteInChat(c.env, teamId, personId, muted);
  return c.json({ ok: true });
});

const broadcastSchema = z.object({
  /** Empty: all teams. */
  teamIds: z.array(z.number().int().positive()).max(100),
  text: z.string().trim().min(1).max(2000),
  notify: z.boolean(),
});

/** Announcement to selected or all team chats (admins only). */
chatRoutes.post("/admin/broadcast", async (c) => {
  const actor = requireActor(c);
  requireAdmin(actor);
  const input = parse(broadcastSchema, await readJson(c.req.raw));
  const teams = await all<{ id: number }>(
    c.env.DB,
    input.teamIds.length ? "SELECT id FROM teams WHERE id IN (SELECT value FROM json_each(?))" : "SELECT id FROM teams",
    ...(input.teamIds.length ? [JSON.stringify(input.teamIds)] : []),
  );
  if (input.teamIds.length && teams.length !== new Set(input.teamIds).size) throw badRequest(t`At least one of the teams does not exist.`);
  if (!teams.length) throw badRequest(t`There are no teams yet.`);
  await postAnnouncement(c.env, teams.map((x) => x.id), { personId: actor.personId, name: displayName(actor) }, input.text, input.notify);
  return c.json({ sent: teams.length });
});
