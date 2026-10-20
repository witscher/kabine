// Which events someone sees in the event overview (and in the personal calendar).
import type { EventSummary } from "./types";

export function isRelevantEvent(e: Pick<EventSummary, "kind" | "mine" | "canManage" | "myDuties"> & { organizing?: boolean; staff?: boolean }): boolean {
  // Games of one's own team even without nomination: to watch and cheer
  if (e.kind === "game" && e.mine.length > 0) return true;
  // Also games of other teams where one (or the child) has a duty, e.g. youth referee
  return e.mine.some((m) => m.participant || m.helpRequest) || e.canManage || e.myDuties.length > 0 || !!e.organizing || !!e.staff;
}
