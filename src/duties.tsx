import type { EventSummary, MyDuty } from "../shared/types";
import { Icon } from "./icons";

/** "Dein Dienst: Kuchen & Theke" bzw. "Dienst für Lina: Trikots waschen", je Person eine Zeile. */
export function dutyLines(duties: MyDuty[]): string[] {
  const groups = new Map<string, string[]>();
  for (const d of duties) {
    const key = d.mine ? "Dein Dienst" : d.child ? `Dienst für ${d.child}` : "Dienst";
    groups.set(key, [...(groups.get(key) ?? []), d.label]);
  }
  return [...groups].map(([who, labels]) => `${who}: ${labels.join(", ")}`);
}

/** "Helfer benötigt · 2 Plätze frei" */
export function neededText(n: number): string {
  return `Helfer benötigt · ${n === 1 ? "1 Platz" : `${n} Plätze`} frei`;
}

/** Marken am Spiel in der Terminübersicht: gelb für eigene Dienste, rot, wenn Helfer fehlen. */
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
