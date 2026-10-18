// Welche Termine jemand in der Terminübersicht (und im persönlichen Kalender) sieht.
import type { EventSummary } from "./types";

export function isRelevantEvent(e: Pick<EventSummary, "kind" | "mine" | "canManage" | "myDuties"> & { organizing?: boolean }): boolean {
  // Spiele der eigenen Mannschaft auch ohne Nominierung: zum Zuschauen und Anfeuern
  if (e.kind === "game" && e.mine.length > 0) return true;
  // Auch Spiele anderer Mannschaften, bei denen man (oder das Kind) einen Dienst hat, z. B. KiHaSL/JuHaSL
  return e.mine.some((m) => m.participant || m.helpRequest) || e.canManage || e.myDuties.length > 0 || !!e.organizing;
}
