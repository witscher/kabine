// Admins only, not linked anywhere in the app: view the app from another perspective
// (cookie kabine_view, set via ?playerview=1, ?parentview=1, ?trainerview=1; see docs/dev/design.md, Admin views).
// - player: first own child
// - parent: oneself, without admin and coach rights
// - referee: oneself as KiHaSL/JuHaSL, without admin and coach rights
// - trainer: first coach of the first own team (coaching, else the first child's)
// Views of other persons (player, trainer) are read-only; the account stays one's own,
// so the other person's read markers, push and settings stay untouched.
import { first } from "../lib/db";
import { type Actor, type ActorRow, buildActor, type ViewMode } from "./actor";

export const VIEW_COOKIE = "kabine_view";
const MODES: ViewMode[] = ["player", "parent", "trainer", "referee"];

export function readViewMode(request: Request): ViewMode | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [name, value] = part.trim().split("=");
    if (name === VIEW_COOKIE) return MODES.includes(value as ViewMode) ? (value as ViewMode) : null;
  }
  return null;
}

async function personRow(db: D1Database, accountId: number, personId: number): Promise<ActorRow | null> {
  const p = await first<{ id: number; first_name: string; last_name: string | null }>(
    db,
    "SELECT id, first_name, last_name FROM persons WHERE id = ? AND is_former = 0",
    personId,
  );
  return p ? { account_id: accountId, person_id: p.id, first_name: p.first_name, last_name: p.last_name, is_admin: 0 } : null;
}

/** View for an admin; null if the view does not exist (e.g. no child). */
export async function viewAsActor(db: D1Database, admin: Actor, mode: ViewMode): Promise<Actor | null> {
  if (!admin.isAdmin) return null;
  if (mode === "parent" || mode === "referee") {
    const self = await buildActor(db, admin.session, { account_id: admin.accountId, person_id: admin.personId, first_name: admin.firstName, last_name: admin.lastName, is_admin: 0 });
    const memberships = self.memberships.filter((m) => m.role !== "coach");
    // referee: oneself as KiHaSL/JuHaSL, without admin and coach rights
    return { ...self, memberships, coachTeamIds: [], viewAs: mode, refereeOverride: mode === "referee", locale: admin.locale };
  }
  let personId: number | null = null;
  if (mode === "player") {
    personId = admin.children[0]?.id ?? null;
  } else {
    const teamId = admin.coachTeamIds[0] ?? (admin.children[0] ? admin.childMemberships.get(admin.children[0].id)?.[0]?.teamId : undefined);
    if (teamId != null) {
      const coach = await first<{ person_id: number }>(
        db,
        `SELECT tm.person_id FROM team_memberships tm JOIN persons p ON p.id = tm.person_id
          WHERE tm.team_id = ? AND tm.role = 'coach' AND p.is_former = 0 ORDER BY tm.person_id = ? DESC, tm.person_id LIMIT 1`,
        teamId,
        admin.personId,
      );
      personId = coach?.person_id ?? null;
    }
  }
  if (personId == null) return null;
  const row = await personRow(db, admin.accountId, personId);
  if (!row) return null;
  return { ...(await buildActor(db, admin.session, row)), viewAs: mode, readOnly: personId !== admin.personId, locale: admin.locale };
}
