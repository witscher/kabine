// Helferplan: Dienstarten, Vorlagen und Zeitblöcke je Termin. Eine Dienstart legt fest,
// wer hilft (Eltern, Spieler, Trainer, KiHaSL/JuHaSL-Rolle) und ob es ein Dienst vor Ort
// oder eine Aufgabe ist. Spiele bekommen ihre Blöcke aus der Vorlage der Mannschaft,
// Sondertermine von Hand. Siehe docs/entscheidungen.md, Abschnitt Helferdienste.
import type { Actor } from "../auth/actor";
import { isCoachOf, isCoachOfAny } from "../auth/actor";
import type { MyDuty } from "../../shared/types";
import { all, first, stmt } from "../lib/db";
import { addMinutesLocal, localToInstant } from "../lib/time";
import { gameLiveMinutes } from "./events";

/** Code der KiHaSL/JuHaSL-Dienstart (Startbestand der Migration 0018). */
export const REFEREE_CODE = "referee";

export interface DutyType {
  id: number;
  code: string | null;
  name: string;
  mode: "onsite" | "task";
  whoParents: boolean;
  whoPlayers: boolean;
  whoCoaches: boolean;
  /** Ordentliche Mitglieder (club_members), die zur Mannschaft gehören */
  whoMembers: boolean;
  whoReferees: boolean;
  noteAllowed: boolean;
  needsSkill: boolean;
  /** Sonderdienst nur für diesen Termin */
  eventId: number | null;
  archived: boolean;
}

interface DutyTypeRow {
  id: number;
  code: string | null;
  name: string;
  mode: "onsite" | "task";
  who_parents: number;
  who_players: number;
  who_coaches: number;
  who_members: number;
  who_referees: number;
  note_allowed: number;
  needs_skill: number;
  event_id: number | null;
  archived: number;
}

export function toDutyType(r: DutyTypeRow): DutyType {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    mode: r.mode,
    whoParents: r.who_parents === 1,
    whoPlayers: r.who_players === 1,
    whoCoaches: r.who_coaches === 1,
    whoMembers: r.who_members === 1,
    whoReferees: r.who_referees === 1,
    noteAllowed: r.note_allowed === 1,
    needsSkill: r.needs_skill === 1,
    eventId: r.event_id,
    archived: r.archived === 1,
  };
}

/** Vereinsweite Dienstarten (ohne Sonderdienste) und optional die Sonderdienste der genannten Termine. */
export async function loadDutyTypes(db: D1Database, eventIds: number[] = []): Promise<Map<number, DutyType>> {
  const rows = await all<DutyTypeRow>(
    db,
    "SELECT * FROM duty_types WHERE event_id IS NULL OR event_id IN (SELECT value FROM json_each(?)) ORDER BY sort, id",
    JSON.stringify(eventIds),
  );
  return new Map(rows.map((r) => [r.id, toDutyType(r)]));
}

/** Alle Dienstarten einschließlich aller Sonderdienste (für den Cron). */
export async function loadAllDutyTypes(db: D1Database): Promise<Map<number, DutyType>> {
  const rows = await all<DutyTypeRow>(db, "SELECT * FROM duty_types ORDER BY sort, id");
  return new Map(rows.map((r) => [r.id, toDutyType(r)]));
}

/**
 * KiHaSL/JuHaSL braucht es bei jedem Heimspiel der Jugenden F bis C, unabhängig
 * vom Helferplan der Mannschaft. Erkennung über den Code der Altersklasse (gE, wD, mC …).
 */
export function isRefereeAgeClass(code: string | null | undefined): boolean {
  return !!code && /^[a-z][FEDC]$/.test(code);
}

/** SQL-Bedingung für dasselbe (Alias der Mannschaft). */
export const REFEREE_TEAM_SQL = (t: string) => `(length(${t}.age_class_code) = 2 AND substr(${t}.age_class_code, 2, 1) IN ('F', 'E', 'D', 'C'))`;

/** Zeitraum des KiHaSL/JuHaSL-Blocks: ab 15 Minuten vor Anpfiff bis Spielende. */
const REFEREE_BEFORE_MIN = 15;

/** Als wer kann man sich eintragen: selbst oder als Elternteil für ein Kind. */
export interface HelperRole {
  childId: number | null;
  childName: string | null;
}

export interface HelperTeam {
  teamId: number;
  teamName: string;
  /** Trainer der Mannschaft oder Admin: verwalten, für andere eintragen. */
  canManage: boolean;
  /** Alle Rollen, mit denen man sich bei irgendeinem Dienst eintragen kann. */
  roles: HelperRole[];
  /** Eigene Mannschaft (Trainer, Spieler oder Elternteil), unabhängig von Admin-Rechten. */
  own: boolean;
  /** Intern: Grundlage für rolesFor */
  parentsEnabled: boolean;
  isPlayer: boolean;
  isCoach: boolean;
  /** Ordentliches Mitglied (für „Wer hilft: Mitglieder“) */
  isMember: boolean;
  childRoles: HelperRole[];
}

/**
 * Mit welchen Rollen darf man sich bei einer Dienstart in dieser Mannschaft eintragen?
 * - Eltern: für ihr Kind, wenn die Mannschaft Eltern einbindet; sonst die Spieler selbst
 * - Spieler: selbst
 * - Trainer: selbst
 * Trainer und Admins der Mannschaft dürfen sich immer selbst eintragen (wie bisher).
 * KiHaSL/JuHaSL läuft über refereeRoles.
 */
export function rolesFor(team: HelperTeam, type: DutyType): HelperRole[] {
  if (type.whoReferees) return [];
  const self =
    team.canManage ||
    (type.whoParents && !team.parentsEnabled && team.isPlayer) ||
    (type.whoPlayers && team.isPlayer) ||
    (type.whoCoaches && team.isCoach) ||
    (type.whoMembers && team.isMember && (team.isPlayer || team.isCoach || team.childRoles.length > 0));
  return [...(self ? [{ childId: null, childName: null }] : []), ...(type.whoParents && team.parentsEnabled ? team.childRoles : [])];
}

/**
 * Mannschaften mit Helferplan (oder mit kommenden Sonderterminen mit Diensten), bei denen
 * die Person helfen oder die sie verwalten kann.
 */
export async function helperTeams(db: D1Database, actor: Actor, types?: Map<number, DutyType>): Promise<HelperTeam[]> {
  const [teams, typeMap, member, organized] = await Promise.all([
    all<{ id: number; name: string; parents_enabled: number }>(
      db,
      // Unterabfrage ohne Bezug auf t: einmal ausgewertet, über events (kind, starts_at)
      `SELECT t.id, t.name, t.parents_enabled FROM teams t
        WHERE t.helper_plan = 1
           OR t.id IN (SELECT et.team_id FROM events e JOIN event_teams et ON et.event_id = e.id
                        WHERE e.kind = 'special' AND e.starts_at >= date('now', '-1 day')
                          AND EXISTS (SELECT 1 FROM event_duties ed WHERE ed.event_id = e.id))
        ORDER BY t.name`,
    ),
    types ? Promise.resolve(types) : loadDutyTypes(db),
    isClubMember(db, actor.personId),
    // Mannschaften kommender Sondertermine mit Zeitblöcken, die man erstellt hat oder mitorganisiert
    all<{ team_id: number }>(
      db,
      `SELECT DISTINCT et.team_id FROM events e JOIN event_teams et ON et.event_id = e.id
        WHERE e.kind = 'special' AND e.starts_at >= date('now', '-1 day')
          AND EXISTS (SELECT 1 FROM event_duties ed WHERE ed.event_id = e.id)
          AND (e.created_by = ?1 OR EXISTS (SELECT 1 FROM event_organizers o WHERE o.event_id = e.id AND o.person_id = ?1))`,
      actor.personId,
    ),
  ]);
  const organizedTeams = new Set(organized.map((r) => r.team_id));
  const anyPlayers = [...typeMap.values()].some((t) => t.whoPlayers && !t.archived);
  const anyMembers = member && [...typeMap.values()].some((t) => t.whoMembers && !t.archived);
  const out: HelperTeam[] = [];
  for (const t of teams) {
    const canManage = isCoachOf(actor, t.id);
    const own = actor.memberships.find((m) => m.teamId === t.id);
    const isPlayer = !!own && own.role !== "coach";
    const isCoach = !!own && own.role === "coach";
    const childRoles: HelperRole[] = [];
    if (t.parents_enabled === 1) {
      for (const child of actor.children) {
        const ms = actor.childMemberships.get(child.id) ?? [];
        if (ms.some((m) => m.teamId === t.id && m.role !== "coach")) childRoles.push({ childId: child.id, childName: child.firstName });
      }
    }
    const selfRole = canManage || isCoach || (isPlayer && (t.parents_enabled === 0 || anyPlayers)) || (anyMembers && (isPlayer || childRoles.length > 0));
    const roles = [...(selfRole ? [{ childId: null, childName: null }] : []), ...childRoles];
    if (!roles.length && !organizedTeams.has(t.id)) continue;
    out.push({
      teamId: t.id,
      teamName: t.name,
      canManage,
      roles,
      own: !!own || childRoles.length > 0 || organizedTeams.has(t.id),
      parentsEnabled: t.parents_enabled === 1,
      isPlayer,
      isCoach,
      isMember: member,
      childRoles,
    });
  }
  // Eigene Mannschaften zuerst (für Admins, die alle sehen)
  return [...out.filter((t) => t.own), ...out.filter((t) => !t.own)];
}

/**
 * Spieler und Trainer einer Mannschaft (nicht Gruppe) werden ordentliche Mitglieder. Admins können das Merkmal
 * danach wieder abschalten; eine neue Zuordnung setzt es erneut.
 */
export function clubMemberStmt(db: D1Database, personIds: number[], teamId: number | null): D1PreparedStatement {
  return stmt(
    db,
    `INSERT OR IGNORE INTO club_members (person_id)
     SELECT value FROM json_each(?1) WHERE ?2 IS NULL OR EXISTS (SELECT 1 FROM teams WHERE id = ?2 AND kind = 'team')`,
    JSON.stringify(personIds),
    teamId,
  );
}

export async function isClubMember(db: D1Database, personId: number): Promise<boolean> {
  return !!(await first(db, "SELECT 1 AS ok FROM club_members WHERE person_id = ?", personId));
}

/** Ersteller und Organisatoren je Sondertermin (verwalten die Helferdienste). */
export async function dutyManagers(db: D1Database, eventIds: number[]): Promise<Map<number, Set<number>>> {
  const out = new Map<number, Set<number>>();
  if (!eventIds.length) return out;
  const ids = JSON.stringify(eventIds);
  const rows = await all<{ event_id: number; person_id: number }>(
    db,
    `SELECT id AS event_id, created_by AS person_id FROM events WHERE id IN (SELECT value FROM json_each(?1)) AND created_by IS NOT NULL
     UNION SELECT event_id, person_id FROM event_organizers WHERE event_id IN (SELECT value FROM json_each(?1))`,
    ids,
  );
  for (const r of rows) out.set(r.event_id, (out.get(r.event_id) ?? new Set()).add(r.person_id));
  return out;
}

/** Helferdienste eines Termins verwalten: Trainer einer beteiligten Mannschaft, Admins, Ersteller, Organisatoren. */
export function mayManageDuties(actor: Actor, teamIds: number[], managers: Set<number> | undefined): boolean {
  return isCoachOfAny(actor, teamIds) || !!managers?.has(actor.personId);
}

/** Für die Antwort an den Client ohne interne Felder. */
export function publicHelperTeam(t: HelperTeam) {
  return { teamId: t.teamId, teamName: t.teamName, canManage: t.canManage, roles: t.roles, own: t.own };
}

/**
 * Für wen kann der Actor KiHaSL/JuHaSL-Dienste übernehmen? Man selbst und/oder
 * Kinder mit der Rolle. In der Admin-Sicht „referee“ zählt man selbst immer.
 */
export async function refereeRoles(db: D1Database, actor: Actor): Promise<HelperRole[]> {
  const ids = [actor.personId, ...actor.children.map((c) => c.id)];
  const rows = await all<{ person_id: number }>(db, "SELECT person_id FROM referees WHERE person_id IN (SELECT value FROM json_each(?))", JSON.stringify(ids));
  const set = new Set(rows.map((r) => r.person_id));
  if (actor.refereeOverride) set.add(actor.personId);
  const roles: HelperRole[] = [];
  if (set.has(actor.personId)) roles.push({ childId: null, childName: null });
  for (const ch of actor.children) if (set.has(ch.id)) roles.push({ childId: ch.id, childName: ch.firstName });
  return roles;
}

/** Gegner aus Sicht des Vereins, für Texte. */
export function opponentOf(e: { is_home: number | null; home_team: string | null; guest_team: string | null; title: string | null }): string {
  if (e.is_home === 1) return `gegen ${e.guest_team ?? "Gegner"}`;
  if (e.is_home === 0) return `bei ${e.home_team ?? "Gegner"}`;
  return e.title ?? `${e.home_team ?? "?"} – ${e.guest_team ?? "?"}`;
}

/** "Vorname N." wie im Chat. */
export const SHORT_NAME_SQL = (alias: string) => `${alias}.first_name || CASE WHEN ${alias}.last_name IS NOT NULL AND ${alias}.last_name <> '' THEN ' ' || substr(${alias}.last_name, 1, 1) || '.' ELSE '' END`;

/** Dienstarten mit Vorkenntnissen, die das Konto im Profil freigegeben hat („Das kann ich“). */
export async function skillConsents(db: D1Database, accountId: number): Promise<Set<number>> {
  const rows = await all<{ duty_type_id: number }>(db, "SELECT duty_type_id FROM skill_consents WHERE account_id = ?", accountId);
  return new Set(rows.map((r) => r.duty_type_id));
}

export function mayTake(type: DutyType, consents: Set<number>): boolean {
  return !type.needsSkill || consents.has(type.id);
}

// Zeitblöcke ---------------------------------------------------------------------

export interface TemplateItem {
  dutyTypeId: number;
  slots: number;
  beforeMin: number;
  afterMin: number;
  taskWhen: "before" | "after";
}

/** Block aus einer Vorlagenzeile für einen Termin von start bis end. */
export function blockFromItem(item: TemplateItem, mode: DutyType["mode"], start: string, end: string): { startsAt: string; endsAt: string } {
  if (mode === "task") {
    const at = item.taskWhen === "before" ? start : end;
    return { startsAt: at, endsAt: at };
  }
  return { startsAt: addMinutesLocal(start, -item.beforeMin), endsAt: addMinutesLocal(end, item.afterMin) };
}

export async function templateItems(db: D1Database, templateId: number): Promise<TemplateItem[]> {
  const rows = await all<{ duty_type_id: number; slots: number; before_min: number; after_min: number; task_when: "before" | "after" }>(
    db,
    "SELECT duty_type_id, slots, before_min, after_min, task_when FROM duty_template_items WHERE template_id = ? ORDER BY sort, id",
    templateId,
  );
  return rows.map((r) => ({ dutyTypeId: r.duty_type_id, slots: r.slots, beforeMin: r.before_min, afterMin: r.after_min, taskWhen: r.task_when }));
}

/** Ende eines Spiels: Anpfiff plus Spieldauer der Altersklasse. */
export function gameEnd(startsAt: string, ageClassCode: string): string {
  return addMinutesLocal(startsAt, gameLiveMinutes([ageClassCode]));
}

function minutesBetween(from: string, to: string): number {
  return Math.round((localToInstant(to) - localToInstant(from)) / 60_000);
}

/**
 * Zeitblöcke der Spiele aktuell halten (lazy, bei jedem Lesen):
 * - Spiele von Mannschaften mit Helferplan bekommen einmal die Blöcke ihrer Vorlage,
 * - Jugend-Heimspiele F–C einmal den KiHaSL/JuHaSL-Block,
 * - hat sich die Anpfiffzeit geändert, ziehen alle Blöcke um dieselbe Zeit mit.
 * Ohne eventIds: alle Spiele ab heute minus 90 Tage.
 */
export async function ensureEventDuties(db: D1Database, eventIds: number[] | null, from: string): Promise<void> {
  if (eventIds && !eventIds.length) return;
  const games = await all<{
    id: number;
    starts_at: string;
    is_home: number | null;
    duties_anchor: string | null;
    duties_generated: number;
    helper_plan: number;
    age_class_code: string;
    home_template_id: number | null;
    away_template_id: number | null;
  }>(
    db,
    // Zwei Varianten statt „?2 IS NULL OR …“: Nur so sucht SQLite gezielt nach den IDs
    `SELECT e.id, e.starts_at, e.is_home, e.duties_anchor, e.duties_generated, t.helper_plan, t.age_class_code, t.home_template_id, t.away_template_id
       FROM events e
       JOIN teams t ON t.id = (SELECT et.team_id FROM event_teams et WHERE et.event_id = e.id ORDER BY et.team_id LIMIT 1)
      WHERE e.kind = 'game' AND e.starts_at >= ?1
        ${eventIds ? "AND e.id IN (SELECT value FROM json_each(?2))" : ""}
        AND (
          (e.duties_anchor IS NOT NULL AND e.duties_anchor <> e.starts_at)
          OR (t.helper_plan = 1 AND (e.duties_generated & 1) = 0)
          OR (e.is_home = 1 AND ${REFEREE_TEAM_SQL("t")} AND (e.duties_generated & 2) = 0)
        )`,
    from,
    ...(eventIds ? [JSON.stringify(eventIds)] : []),
  );
  if (!games.length) return;
  const [types, defaults] = await Promise.all([
    loadDutyTypes(db),
    all<{ id: number; default_for: "home" | "away" }>(db, "SELECT id, default_for FROM duty_templates WHERE default_for IS NOT NULL"),
  ]);
  const referee = [...types.values()].find((t) => t.code === REFEREE_CODE);
  const itemsCache = new Map<number, TemplateItem[]>();
  const items = async (templateId: number) => {
    if (!itemsCache.has(templateId)) itemsCache.set(templateId, await templateItems(db, templateId));
    return itemsCache.get(templateId)!;
  };
  const statements: D1PreparedStatement[] = [];
  for (const g of games) {
    // Verschobenes Spiel: Blöcke mitziehen
    if (g.duties_anchor && g.duties_anchor !== g.starts_at) {
      const delta = minutesBetween(g.duties_anchor, g.starts_at);
      const blocks = await all<{ id: number; starts_at: string; ends_at: string }>(db, "SELECT id, starts_at, ends_at FROM event_duties WHERE event_id = ?", g.id);
      for (const b of blocks) {
        statements.push(stmt(db, "UPDATE event_duties SET starts_at = ?, ends_at = ? WHERE id = ?", addMinutesLocal(b.starts_at, delta), addMinutesLocal(b.ends_at, delta), b.id));
      }
    }
    let generated = g.duties_generated;
    const end = gameEnd(g.starts_at, g.age_class_code);
    if (g.helper_plan === 1 && (generated & 1) === 0) {
      const home = g.is_home !== 0;
      const templateId = (home ? g.home_template_id : g.away_template_id) ?? defaults.find((d) => d.default_for === (home ? "home" : "away"))?.id;
      for (const [i, item] of (templateId ? await items(templateId) : []).entries()) {
        const type = types.get(item.dutyTypeId);
        if (!type || type.archived || type.whoReferees) continue;
        const b = blockFromItem(item, type.mode, g.starts_at, end);
        statements.push(
          stmt(db, "INSERT INTO event_duties (event_id, duty_type_id, starts_at, ends_at, slots, sort) VALUES (?, ?, ?, ?, ?, ?)", g.id, type.id, b.startsAt, b.endsAt, item.slots, i + 1),
        );
      }
      generated |= 1;
    }
    if (g.is_home === 1 && isRefereeAgeClass(g.age_class_code) && (generated & 2) === 0 && referee) {
      statements.push(
        stmt(
          db,
          "INSERT INTO event_duties (event_id, duty_type_id, starts_at, ends_at, slots, sort) VALUES (?, ?, ?, ?, 1, 99)",
          g.id,
          referee.id,
          addMinutesLocal(g.starts_at, -REFEREE_BEFORE_MIN),
          end,
        ),
      );
      generated |= 2;
    }
    statements.push(stmt(db, "UPDATE events SET duties_anchor = starts_at, duties_generated = ? WHERE id = ?", generated, g.id));
  }
  // In Portionen, D1 begrenzt die Größe eines Batches
  for (let i = 0; i < statements.length; i += 50) await db.batch(statements.slice(i, i + 50));
}

/**
 * Neue Vorlage einer Mannschaft: kommende Spiele ohne Einträge bekommen ihre Blöcke neu.
 * Blöcke mit Einträgen und der KiHaSL/JuHaSL-Block bleiben.
 */
export async function resetTeamDuties(db: D1Database, teamId: number, now: string): Promise<void> {
  const games = await all<{ id: number }>(
    db,
    `SELECT e.id FROM events e JOIN event_teams et ON et.event_id = e.id AND et.team_id = ?
      WHERE e.kind = 'game' AND e.starts_at > ? AND NOT EXISTS (SELECT 1 FROM duties d WHERE d.event_id = e.id AND d.duty_type_id IN (SELECT id FROM duty_types WHERE who_referees = 0))`,
    teamId,
    now,
  );
  if (!games.length) return;
  const ids = JSON.stringify(games.map((g) => g.id));
  await db.batch([
    stmt(db, "DELETE FROM event_duties WHERE event_id IN (SELECT value FROM json_each(?)) AND duty_type_id IN (SELECT id FROM duty_types WHERE who_referees = 0)", ids),
    stmt(db, "UPDATE events SET duties_generated = duties_generated & 2 WHERE id IN (SELECT value FROM json_each(?))", ids),
  ]);
}

// Terminübersicht ----------------------------------------------------------------

/**
 * Eigene Dienste und die für die eigenen Kinder je Termin, für die Terminübersicht.
 * Nur Termine mit Helferplan (Spiele) bzw. Sondertermine, keine ausgeblendeten oder abgesagten.
 */
export async function loadMyDuties(db: D1Database, actor: Actor, eventIds: number[]): Promise<Map<number, MyDuty[]>> {
  const out = new Map<number, MyDuty[]>();
  if (!eventIds.length) return out;
  const rows = await all<{ event_id: number; type_id: number; name: string; who_referees: number; person_id: number | null; child_name: string | null }>(
    db,
    `SELECT d.event_id, dt.id AS type_id, dt.name, dt.who_referees, d.person_id, ch.first_name AS child_name
       FROM duties d JOIN events e ON e.id = d.event_id JOIN duty_types dt ON dt.id = d.duty_type_id
       LEFT JOIN persons ch ON ch.id = d.child_id
      WHERE (d.person_id = ? OR d.child_id IN (SELECT value FROM json_each(?)))
        -- „+“: über die eigenen Dienste suchen, nicht über alle Dienste der gelisteten Termine
        AND +d.event_id IN (SELECT value FROM json_each(?))
        AND e.cancelled_at IS NULL
        AND (dt.who_referees = 1 OR e.kind = 'special'
             OR (e.duty_hidden = 0 AND EXISTS (SELECT 1 FROM event_teams et JOIN teams t ON t.id = et.team_id WHERE et.event_id = e.id AND t.helper_plan = 1)))
      ORDER BY d.event_id, d.id`,
    actor.personId,
    JSON.stringify(actor.children.map((c) => c.id)),
    JSON.stringify(eventIds),
  );
  for (const r of rows) {
    const mine = r.person_id === actor.personId;
    const list = out.get(r.event_id) ?? [];
    // Derselbe Dienst nur einmal (z. B. eigener Eintrag und einer des anderen Elternteils)
    if (!list.some((x) => x.dutyTypeId === r.type_id && x.mine === mine)) {
      list.push({ dutyTypeId: r.type_id, referee: r.who_referees === 1, label: r.name, child: mine ? null : r.child_name, mine });
    }
    out.set(r.event_id, list);
  }
  return out;
}

/**
 * Freie Plätze je Termin, die der Actor als helfendes Elternteil (bzw. als Spieler)
 * übernehmen könnte. Gleiche Regeln wie „Helfer gesucht“ in worker/domain/duty-notify.ts:
 * Wer hilft je Dienstart, Vorkenntnisse nur mit Freigabe. Trainer und Admins zählen nur
 * über eigene Kinder oder als Spieler.
 */
export async function loadHelpersNeeded(db: D1Database, actor: Actor, eventIds: number[], now: string): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  if (!eventIds.length) return out;
  const types = await loadDutyTypes(db, eventIds);
  const teams = (await helperTeams(db, actor, types)).filter((t) => t.childRoles.length > 0 || t.isPlayer || (t.isCoach && !t.canManage));
  if (!teams.length) return out;
  await ensureEventDuties(db, eventIds, now.slice(0, 10));
  const [blocks, consents] = await Promise.all([
    all<{ id: number; event_id: number; duty_type_id: number; slots: number; taken: number; team_id: number }>(
      db,
      `SELECT ed.id, ed.event_id, ed.duty_type_id, ed.slots, (SELECT count(*) FROM duties d WHERE d.event_duty_id = ed.id) AS taken,
              (SELECT et.team_id FROM event_teams et WHERE et.event_id = e.id AND et.team_id IN (SELECT value FROM json_each(?3)) ORDER BY et.team_id LIMIT 1) AS team_id
         FROM event_duties ed JOIN events e ON e.id = ed.event_id
        WHERE ed.event_id IN (SELECT value FROM json_each(?1)) AND e.starts_at > ?2
          AND e.cancelled_at IS NULL AND (e.kind = 'special' OR e.duty_hidden = 0)
          AND EXISTS (SELECT 1 FROM event_teams et WHERE et.event_id = e.id AND et.team_id IN (SELECT value FROM json_each(?3)))
          AND NOT EXISTS (SELECT 1 FROM duties d WHERE d.event_id = e.id AND d.person_id = ?4)`,
      JSON.stringify(eventIds),
      now,
      JSON.stringify(teams.map((t) => t.teamId)),
      actor.personId,
    ),
    skillConsents(db, actor.accountId),
  ]);
  for (const b of blocks) {
    const type = types.get(b.duty_type_id);
    const team = teams.find((t) => t.teamId === b.team_id);
    if (!type || !team || !mayTake(type, consents)) continue;
    // Trainer/Admin zählen nur mit eigenen Rollen (Kind, Spieler), nicht als Verwalter
    const roles = rolesFor({ ...team, canManage: false }, type);
    if (!roles.length) continue;
    const free = Math.max(0, b.slots - b.taken);
    if (free > 0) out.set(b.event_id, (out.get(b.event_id) ?? 0) + free);
  }
  return out;
}

/** Block mit Termin und Mannschaft, für Eintragen und Verwalten. */
export interface BlockRow {
  id: number;
  event_id: number;
  duty_type_id: number;
  starts_at: string;
  ends_at: string;
  slots: number;
  event_starts_at: string;
  event_kind: "game" | "special" | "training";
  cancelled_at: string | null;
  duty_hidden: number;
  team_ids: string;
}

export async function loadBlock(db: D1Database, id: number): Promise<(BlockRow & { teamIds: number[] }) | null> {
  const row = await first<BlockRow>(
    db,
    `SELECT ed.id, ed.event_id, ed.duty_type_id, ed.starts_at, ed.ends_at, ed.slots, e.starts_at AS event_starts_at, e.kind AS event_kind,
            e.cancelled_at, e.duty_hidden, (SELECT json_group_array(team_id) FROM (SELECT et.team_id FROM event_teams et WHERE et.event_id = e.id ORDER BY et.team_id)) AS team_ids
       FROM event_duties ed JOIN events e ON e.id = ed.event_id WHERE ed.id = ?`,
    id,
  );
  return row ? { ...row, teamIds: JSON.parse(row.team_ids) as number[] } : null;
}
