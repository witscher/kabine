// Children in the app: what players of a youth age class may do themselves. Three levels, each only restricts:
// the age class (admins, age_classes.child_*), the team (coaches, teams.child_*, NULL = as the age class) and
// the parents' permissions per child (worker/auth/actor.ts). Adult classes and groups are never limited.
import { t } from "@lingui/core/macro";
import type { ChildChat, ChildLimits } from "../../shared/types";
import { all, first } from "../lib/db";

export const FULL_LIMITS: ChildLimits = { account: true, respond: true, chat: "write", help: true };

const CHAT_RANK: Record<ChildChat, number> = { none: 0, read: 1, write: 2 };

export interface LimitRow {
  child_account: number;
  child_respond: number;
  child_chat: ChildChat;
  child_help: number;
}

/** Without an own account nothing themselves either: they only read what another team shows them. */
export function toLimits(r: LimitRow): ChildLimits {
  const account = r.child_account === 1;
  return {
    account,
    respond: account && r.child_respond === 1,
    chat: account ? r.child_chat : "none",
    help: account && r.child_help === 1,
  };
}

/** Fills a partial limit (sport profile) and switches everything off without an own account. */
export function completeLimits(l: Partial<ChildLimits> | undefined): ChildLimits {
  const full = { ...FULL_LIMITS, ...l };
  return full.account ? full : { account: false, respond: false, chat: "none", help: false };
}

/** The stricter of two limits. */
export function stricter(a: ChildLimits, b: ChildLimits): ChildLimits {
  return {
    account: a.account && b.account,
    respond: a.respond && b.respond,
    chat: CHAT_RANK[a.chat] <= CHAT_RANK[b.chat] ? a.chat : b.chat,
    help: a.help && b.help,
  };
}

/** Does `team` allow more than `ageClass` anywhere? The team level may only restrict. */
export function loosens(team: Partial<ChildLimits>, ageClass: ChildLimits): boolean {
  return (
    (team.account === true && !ageClass.account) ||
    (team.respond === true && !ageClass.respond) ||
    (team.help === true && !ageClass.help) ||
    (team.chat !== undefined && CHAT_RANK[team.chat] > CHAT_RANK[ageClass.chat])
  );
}

const chatRank = (col: string) => `CASE ${col} WHEN 'none' THEN 0 WHEN 'read' THEN 1 ELSE 2 END`;

/**
 * Teams with limited children's rights (youth class of the current season, stricter value of age class and team).
 * All other teams allow everything. Few rows: only teams that restrict something.
 */
export const LIMITED_TEAMS_SQL = `SELECT team_id, child_account, child_respond, CASE chat_rank WHEN 0 THEN 'none' WHEN 1 THEN 'read' ELSE 'write' END AS child_chat, child_help
   FROM (SELECT t.id AS team_id,
                min(ac.child_account, coalesce(t.child_account, 1)) AS child_account,
                min(ac.child_respond, coalesce(t.child_respond, 1)) AS child_respond,
                min(${chatRank("ac.child_chat")}, ${chatRank("t.child_chat")}) AS chat_rank,
                min(ac.child_help, coalesce(t.child_help, 1)) AS child_help
           FROM teams t JOIN age_classes ac ON ac.code = t.age_class_code AND ac.season_id = (SELECT id FROM seasons WHERE is_current = 1)
          WHERE t.kind = 'team' AND ac.is_youth = 1)
  WHERE child_account = 0 OR child_respond = 0 OR chat_rank < 2 OR child_help = 0`;

export async function teamLimits(db: D1Database, teamId: number): Promise<ChildLimits> {
  const r = await first<LimitRow>(db, `SELECT * FROM (${LIMITED_TEAMS_SQL}) WHERE team_id = ?`, teamId);
  return r ? toLimits(r) : FULL_LIMITS;
}

/** SQL: in this team (expression) players are not in the chat. For push and the badge. */
export const CHILD_CHAT_OFF_SQL = (team: string) =>
  `${team} IN (SELECT team_id FROM (${LIMITED_TEAMS_SQL}) WHERE child_account = 0 OR child_chat = 'none')`;

/**
 * May this person have an own account? Yes if they play in a team that allows it, or not as a player
 * in any team at all (parents, coaches). Groups do not count.
 */
export async function childAccountAllowed(db: D1Database, personId: number): Promise<boolean> {
  const row = await first<{ teams: number; allowed: number; coach: number }>(
    db,
    `SELECT
       (SELECT count(*) FROM team_memberships tm JOIN teams t ON t.id = tm.team_id AND t.kind = 'team'
         WHERE tm.person_id = ?1 AND tm.role IN ('player', 'helper')) AS teams,
       (SELECT count(*) FROM team_memberships tm JOIN teams t ON t.id = tm.team_id AND t.kind = 'team'
         WHERE tm.person_id = ?1 AND tm.role IN ('player', 'helper')
           AND t.id NOT IN (SELECT team_id FROM (${LIMITED_TEAMS_SQL}) WHERE child_account = 0)) AS allowed,
       EXISTS (SELECT 1 FROM team_memberships WHERE person_id = ?1 AND role = 'coach') AS coach`,
    personId,
  );
  return !row || row.coach === 1 || row.teams === 0 || row.allowed > 0;
}

/** Teams of a child with limits, for the parents' page. */
export async function limitedTeamsOf(db: D1Database, personId: number): Promise<{ name: string; limits: ChildLimits }[]> {
  const rows = await all<LimitRow & { name: string }>(
    db,
    `SELECT t.name, l.child_account, l.child_respond, l.child_chat, l.child_help
       FROM team_memberships tm JOIN teams t ON t.id = tm.team_id JOIN (${LIMITED_TEAMS_SQL}) l ON l.team_id = tm.team_id
      WHERE tm.person_id = ? AND tm.role IN ('player', 'helper') ORDER BY t.name`,
    personId,
  );
  return rows.map((r) => ({ name: r.name, limits: toLimits(r) }));
}

export const NO_CHILD_ACCOUNT = () => t`Children in this team have no own access. Please use the parent link.`;

export const CHILD_LIMITED = () => t`Your parents take care of this in this team.`;
