// Attendance after an event: coaches record per participant "present", "excused" or "unexcused". Without an
// entry the response decides (defaultMark); an entry equal to that default is not stored. The player's own
// yes/no stays as it was, the coach's entry wins.
import type { ParticipationStatus } from "./types";

export const ATTENDANCE_MARKS = ["present", "excused", "unexcused"] as const;
export type AttendanceMark = (typeof ATTENDANCE_MARKS)[number];

/**
 * Without an entry: accepted counts as present; declined, away long-term and inactive as excused. No answer
 * stays open (null) until the coach records it; for optional participants it means not there (excused).
 */
export function defaultMark(status: ParticipationStatus, optional: boolean): AttendanceMark | null {
  if (status === "yes") return "present";
  if (status === "open") return optional ? "excused" : null;
  return "excused";
}

/** "Unexcused" only for someone who did not decline, never for an optional participant. */
export function unexcusedAllowed(status: ParticipationStatus, optional: boolean): boolean {
  return !optional && (status === "yes" || status === "open");
}
