import { t } from "@lingui/core/macro";
// Protected owner: even a compromised admin account cannot take away the access of the person
// who set up the installation (admin rights, account, person, leaving, personal link). What the
// owner does to themselves stays allowed. The owner is recorded at setup; only the owner can hand
// the role to another admin (PUT /api/admin/club/owner).
import { loadClub } from "../domain/club";
import { first } from "../lib/db";
import { ApiError } from "../lib/http";
import type { Actor } from "./actor";

const message = () => t`This access is protected and can only be changed by its owner.`;

/** IDs among personIds that belong to the owner. */
export async function protectedAmong(db: D1Database, personIds: number[]): Promise<number[]> {
  if (!personIds.length) return [];
  const { ownerPersonId } = await loadClub(db);
  return ownerPersonId !== null && personIds.includes(ownerPersonId) ? [ownerPersonId] : [];
}

export async function isProtectedPerson(db: D1Database, personId: number): Promise<boolean> {
  return (await protectedAmong(db, [personId])).length > 0;
}

/** Throws 403 when someone other than the owner tries to touch the owner's access. */
export async function assertNotProtected(db: D1Database, actor: Actor, personIds: number | number[]): Promise<void> {
  const ids = (Array.isArray(personIds) ? personIds : [personIds]).filter((id) => id !== actor.personId);
  if ((await protectedAmong(db, ids)).length) throw new ApiError(403, "owner_protected", message());
}

/** Personal link for the owner: valid only if the owner created it. */
export async function assertInviteAllowed(db: D1Database, inviteId: number, personId: number): Promise<void> {
  if (!(await isProtectedPerson(db, personId))) return;
  const invite = await first<{ created_by: number | null }>(db, "SELECT created_by FROM invites WHERE id = ?", inviteId);
  if (invite?.created_by !== personId) throw new ApiError(403, "owner_protected", message());
}

/**
 * Access of coaches and admins (leaving, removing the account, personal link) is managed by admins only. Otherwise a
 * coach could remove a parent of their team who coaches another team, and with it that coaching role.
 */
export async function assertNotStaffUnlessAdmin(db: D1Database, actor: Actor, personId: number): Promise<void> {
  if (actor.isAdmin) return;
  const target = await first<{ staff: number }>(
    db,
    "SELECT is_admin = 1 OR EXISTS (SELECT 1 FROM team_memberships WHERE person_id = persons.id AND role = 'coach') AS staff FROM persons WHERE id = ?",
    personId,
  );
  if (target?.staff) throw new ApiError(403, "forbidden", t`Access of coaches and admins is managed by an admin.`);
}
