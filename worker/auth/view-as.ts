// Nur für Admins, in der App nirgends verlinkt: die App aus einer anderen Sicht ansehen
// (Cookie kabine_view, gesetzt über ?playerview=1, ?parentview=1, ?trainerview=1; siehe docs/entscheidungen.md).
// - player: erstes eigenes Kind
// - parent: man selbst, ohne Admin- und Trainerrechte
// - referee: man selbst als KiHaSL/JuHaSL, ohne Admin- und Trainerrechte
// - trainer: erster Trainer der ersten eigenen Mannschaft (Trainer, sonst die des ersten Kindes)
// Fremde Sichten (player, trainer) sind schreibgeschützt; das Konto bleibt das eigene,
// damit Lesestände, Push und Einstellungen der anderen Person unberührt bleiben.
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

/** Sicht für einen Admin; null, wenn es die Sicht nicht gibt (z. B. kein Kind). */
export async function viewAsActor(db: D1Database, admin: Actor, mode: ViewMode): Promise<Actor | null> {
  if (!admin.isAdmin) return null;
  if (mode === "parent" || mode === "referee") {
    const self = await buildActor(db, admin.session, { account_id: admin.accountId, person_id: admin.personId, first_name: admin.firstName, last_name: admin.lastName, is_admin: 0 });
    const memberships = self.memberships.filter((m) => m.role !== "coach");
    // referee: man selbst als KiHaSL/JuHaSL, ohne Admin- und Trainerrechte
    return { ...self, memberships, coachTeamIds: [], viewAs: mode, refereeOverride: mode === "referee" };
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
  return { ...(await buildActor(db, admin.session, row)), viewAs: mode, readOnly: personId !== admin.personId };
}
