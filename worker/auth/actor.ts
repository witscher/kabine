import type { ChildPermission, ChildPermissions, PersonRef, Role } from "../../shared/types";
import { forbidden } from "../lib/http";
import { utcIso } from "../lib/time";
import type { SessionRow } from "./session";

export interface Membership {
  teamId: number;
  role: Role;
  helperTrainings: boolean;
  /** In dieser Mannschaft sind Eltern eingebunden (Einstellung des Admins). */
  parentsEnabled: boolean;
}

/** Wer handelt in dieser Anfrage, und was darf er? */
export interface Actor {
  session: SessionRow;
  accountId: number;
  personId: number;
  firstName: string;
  lastName: string | null;
  isAdmin: boolean;
  /** Verknüpfte Kinder. Für welche Mannschaften die Eltern zuständig sind, steht in childMemberships. */
  children: PersonRef[];
  /** Diese Person ist ein Kind mit mindestens einem verknüpften Elternteil. */
  hasGuardians: boolean;
  /** Freigaben der Eltern. Sie gelten nur in Mannschaften, in denen Eltern eingebunden sind. */
  permissions: ChildPermissions;
  memberships: Membership[];
  /** Mannschaften der verknüpften Kinder. */
  childMemberships: Map<number, Membership[]>;
  coachTeamIds: number[];
  /** Nur für Admins: App aus einer anderen Sicht ansehen (siehe worker/auth/view-as.ts). */
  viewAs?: ViewMode;
  /** In dieser Sicht darf nichts geändert werden (fremde Person). */
  readOnly?: boolean;
  /** Admin-Sicht „referee“: zählt als KiHaSL/JuHaSL, ohne Eintrag in referees. */
  refereeOverride?: boolean;
  /** Admin arbeitet als Trainer (accounts.coach_mode): Admin-Rechte ruhen, Schalter im Profil. */
  adminSuspended?: boolean;
  /** Language chosen on the account (null: app or club default). */
  locale?: string | null;
}

export type ViewMode = "player" | "parent" | "trainer" | "referee";

export const ALL_PERMISSIONS: ChildPermissions = {
  may_accept: true,
  may_decline: true,
  may_read_chat: true,
  may_write_chat: true,
  may_answer_help: true,
};

export interface ActorRow {
  account_id: number;
  person_id: number;
  first_name: string;
  last_name: string | null;
  is_admin: number;
}

interface PermRow {
  guardians: number;
  may_accept: number | null;
  may_decline: number | null;
  may_read_chat: number | null;
  may_write_chat: number | null;
  may_answer_help: number | null;
}

export async function loadActor(db: D1Database, session: SessionRow): Promise<Actor | null> {
  const row = await db
    .prepare(
      `SELECT a.id AS account_id, p.id AS person_id, p.first_name, p.last_name, p.is_admin, a.coach_mode, a.locale
         FROM accounts a JOIN persons p ON p.id = a.person_id
        WHERE a.id = ? AND a.disabled_at IS NULL AND p.is_former = 0`,
    )
    .bind(session.account_id)
    .first<ActorRow & { coach_mode: number; locale: string | null }>();
  if (!row) return null;
  // Admin im Trainer-Modus: Rechte wie ein Trainer, auch auf dem Server
  if (row.is_admin === 1 && row.coach_mode === 1) return { ...(await buildActor(db, session, { ...row, is_admin: 0 })), adminSuspended: true, locale: row.locale };
  return { ...(await buildActor(db, session, row)), locale: row.locale };
}

/** Actor für eine Person; die Ansichten für Admins nutzen das mit einer anderen Person. */
export async function buildActor(db: D1Database, session: SessionRow, row: ActorRow): Promise<Actor> {
  const [children, perms, memberships] = await db.batch([
    db
      .prepare(
        `SELECT p.id, p.first_name, p.last_name FROM guardianships g JOIN persons p ON p.id = g.child_id
          WHERE g.guardian_id = ? AND p.is_former = 0 ORDER BY p.first_name, p.id`,
      )
      .bind(row.person_id),
    db
      .prepare(
        `SELECT (SELECT count(*) FROM guardianships WHERE child_id = ?1) AS guardians,
                cp.may_accept, cp.may_decline, cp.may_read_chat, cp.may_write_chat, cp.may_answer_help
           FROM (SELECT 1) LEFT JOIN child_permissions cp ON cp.child_id = ?1`,
      )
      .bind(row.person_id),
    db
      .prepare(
        `SELECT tm.person_id, tm.team_id, tm.role, tm.helper_trainings, t.parents_enabled
           FROM team_memberships tm JOIN teams t ON t.id = tm.team_id
          WHERE tm.person_id = ?1
             OR tm.person_id IN (SELECT g.child_id FROM guardianships g JOIN persons p ON p.id = g.child_id
                                  WHERE g.guardian_id = ?1 AND p.is_former = 0)`,
      )
      .bind(row.person_id),
  ]);

  const p = (perms!.results[0] as PermRow | undefined) ?? null;
  const hasGuardians = (p?.guardians ?? 0) > 0;
  const permissions: ChildPermissions = hasGuardians
    ? {
        may_accept: (p?.may_accept ?? 1) === 1,
        may_decline: (p?.may_decline ?? 1) === 1,
        may_read_chat: (p?.may_read_chat ?? 1) === 1,
        may_write_chat: (p?.may_write_chat ?? 1) === 1,
        may_answer_help: (p?.may_answer_help ?? 1) === 1,
      }
    : { ...ALL_PERMISSIONS };

  const ms: Membership[] = [];
  const childMemberships = new Map<number, Membership[]>();
  for (const m of memberships!.results as { person_id: number; team_id: number; role: Role; helper_trainings: number; parents_enabled: number }[]) {
    const membership = { teamId: m.team_id, role: m.role, helperTrainings: m.helper_trainings === 1, parentsEnabled: m.parents_enabled === 1 };
    if (m.person_id === row.person_id) ms.push(membership);
    else childMemberships.set(m.person_id, [...(childMemberships.get(m.person_id) ?? []), membership]);
  }

  return {
    session,
    accountId: row.account_id,
    personId: row.person_id,
    firstName: row.first_name,
    lastName: row.last_name,
    isAdmin: row.is_admin === 1,
    children: (children!.results as { id: number; first_name: string; last_name: string | null }[]).map((c) => ({
      id: c.id,
      firstName: c.first_name,
      lastName: c.last_name,
    })),
    hasGuardians,
    permissions,
    memberships: ms,
    childMemberships,
    coachTeamIds: ms.filter((m) => m.role === "coach").map((m) => m.teamId),
  };
}

/** Eigene Person und alle Kinder. */
export function scopePersonIds(actor: Actor): number[] {
  return [actor.personId, ...actor.children.map((c) => c.id)];
}

/** Mannschaften der eigenen Person oder eines verknüpften Kindes. */
export function membershipsOf(actor: Actor, personId: number): Membership[] {
  return personId === actor.personId ? actor.memberships : (actor.childMemberships.get(personId) ?? []);
}

/**
 * Sind Eltern für diese Person zuständig? Bei einem Termin zählen die
 * Mannschaften des Termins, in denen die Person Mitglied ist. Ist sie dort
 * nicht Mitglied (Aushilfe) oder fehlt der Mannschaftsbezug, zählen alle
 * ihre Mannschaften: Eine Mannschaft mit Eltern reicht.
 */
export function parentsInCharge(actor: Actor, personId: number, teamIds?: readonly number[]): boolean {
  const own = membershipsOf(actor, personId);
  const relevant = teamIds ? own.filter((m) => teamIds.includes(m.teamId)) : [];
  return (relevant.length ? relevant : own).some((m) => m.parentsEnabled);
}

/**
 * Dieselbe Regel als SQL-Ausdruck. person ist ein Ausdruck für die Personen-ID,
 * teamSet eine Unterabfrage mit den Mannschaften des Kontexts (leer: alle
 * Mannschaften der Person zählen).
 */
export function parentsInChargeSql(person: string, teamSet: string): string {
  return `(CASE
    WHEN EXISTS (SELECT 1 FROM team_memberships pic_m WHERE pic_m.person_id = ${person} AND pic_m.team_id IN (${teamSet}))
    THEN EXISTS (SELECT 1 FROM team_memberships pic_m JOIN teams pic_t ON pic_t.id = pic_m.team_id
                  WHERE pic_m.person_id = ${person} AND pic_m.team_id IN (${teamSet}) AND pic_t.parents_enabled = 1)
    ELSE EXISTS (SELECT 1 FROM team_memberships pic_m JOIN teams pic_t ON pic_t.id = pic_m.team_id
                  WHERE pic_m.person_id = ${person} AND pic_t.parents_enabled = 1)
  END)`;
}

/** Handelt der Account für diese Person (selbst oder als zuständiges Elternteil)? */
export function actsFor(actor: Actor, personId: number, teamIds?: readonly number[]): boolean {
  if (personId === actor.personId) return true;
  return actor.children.some((c) => c.id === personId) && parentsInCharge(actor, personId, teamIds);
}

export function isCoachOf(actor: Actor, teamId: number): boolean {
  return actor.isAdmin || actor.coachTeamIds.includes(teamId);
}

export function isCoachOfAny(actor: Actor, teamIds: readonly number[]): boolean {
  return actor.isAdmin || teamIds.some((t) => actor.coachTeamIds.includes(t));
}

export function requireCoach(actor: Actor, teamId: number): void {
  if (!isCoachOf(actor, teamId)) throw forbidden("Das dürfen nur Trainer dieser Mannschaft.");
}

export function requireAdmin(actor: Actor): void {
  if (!actor.isAdmin) throw forbidden("Das dürfen nur Admins.");
}

export const PARENTS_HANDLE_IT = "Deine Eltern kümmern sich darum.";

export const PARENTS_NOT_INVOLVED = "In dieser Mannschaft sind keine Eltern eingebunden.";

/** Gelten für die eigene Person gerade die Freigaben der Eltern? */
function restrictedBy(actor: Actor, permission: ChildPermission | undefined, teamIds?: readonly number[]): boolean {
  return !!permission && actor.hasGuardians && !actor.permissions[permission] && parentsInCharge(actor, actor.personId, teamIds);
}

/**
 * Darf der Account für diese Person handeln? Eltern nur in Mannschaften, in
 * denen Eltern eingebunden sind. Handelt ein Kind für sich selbst, gelten dort
 * zusätzlich die elterlichen Freigaben.
 */
export function mayActFor(actor: Actor, personId: number, permission?: ChildPermission, teamIds?: readonly number[]): boolean {
  if (!actsFor(actor, personId, teamIds)) return false;
  return !(personId === actor.personId && restrictedBy(actor, permission, teamIds));
}

export function requireActFor(actor: Actor, personId: number, permission?: ChildPermission, teamIds?: readonly number[]): void {
  if (personId !== actor.personId && actor.children.some((c) => c.id === personId) && !parentsInCharge(actor, personId, teamIds)) {
    throw forbidden(PARENTS_NOT_INVOLVED);
  }
  if (!actsFor(actor, personId, teamIds)) throw forbidden("Du kannst nur für dich oder deine Kinder handeln.");
  if (personId === actor.personId && restrictedBy(actor, permission, teamIds)) throw forbidden(PARENTS_HANDLE_IT);
}

export function nowIso(): string {
  return utcIso();
}
