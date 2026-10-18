import { plural, t } from "@lingui/core/macro";
import type { EventSummary, MyDuty } from "../shared/types";
import { Icon } from "./icons";

/** "Your duty: Cake & bar" or "Duty for Lina: wash shirts", one line per person. */
export function dutyLines(duties: MyDuty[]): string[] {
  const groups = new Map<string, string[]>();
  for (const d of duties) {
    const child = d.child;
    const key = d.mine ? t`Your duty` : child ? t`Duty for ${child}` : t`Duty`;
    groups.set(key, [...(groups.get(key) ?? []), d.label]);
  }
  return [...groups].map(([who, labels]) => `${who}: ${labels.join(", ")}`);
}

/** "Helpers needed · 2 spots free" */
export function neededText(n: number): string {
  return plural(n, { one: "Helpers needed · # spot free", other: "Helpers needed · # spots free" });
}

/** Chips on the game in the event overview: yellow for your own duties, red when helpers are missing. */
export function DutyChips({ event }: { event: Pick<EventSummary, "myDuties" | "helpersNeeded"> }) {
  if (!event.myDuties.length && !event.helpersNeeded) return null;
  return (
    <div class="duty-chips">
      {dutyLines(event.myDuties).map((line) => (
        <span class="duty-chip">
          <Icon name="helping" size={13} stroke={2.5} />
          {line}
        </span>
      ))}
      {event.helpersNeeded ? (
        <span class="duty-chip need">
          <Icon name="helping" size={13} stroke={2.5} />
          {neededText(event.helpersNeeded)}
        </span>
      ) : null}
    </div>
  );
}
