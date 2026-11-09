// Shared types of the helper duties module (worker and app): the statistics of the helper plan.
import type { PersonRef } from "../../shared/types";

export interface HelperFamily {
  children: PersonRef[];
  guardians: (PersonRef & { hasAccount: boolean })[];
  done: number;
  planned: number;
  /** Family of a permanent stand-in from another team */
  helper: boolean;
}

export interface TeamHelperStats {
  done: number;
  planned: number;
  /** Duties of no family (coaches, members, entered by hand) */
  others: number;
  openSlots: number;
  families: HelperFamily[];
  /** A reminder went out today already */
  remindedToday: boolean;
}

/** The family's helper duties per person and team this season (players and parents). */
export interface MyHelperStats {
  persons: { personId: number; teams: { teamId: number; done: number; planned: number; next: { startsAt: string; label: string; name: string } | null }[] }[];
}
