// "Elsewhere" for coaches (docs/dev/decisions.md, Players elsewhere): events of other teams and groups where the own
// players take part. No link, because the coach often may not open that event.
import { t } from "@lingui/core/macro";
import type { ElsewhereEntry } from "../shared/types";
import { personName, shortDate, timeRange } from "./format";
import { StatusPill } from "./ui";

type Span = { startsAt: string; endsAt: string | null };

// Without an end an event counts for 2 hours, as for "running" (docs/dev/decisions.md)
const endOf = (x: Span) => x.endsAt ?? new Date(Date.parse(`${x.startsAt}:00Z`) + 120 * 60_000).toISOString().slice(0, 16);
const overlaps = (a: Span, b: Span) => a.startsAt < endOf(b) && b.startsAt < endOf(a);

/** The entries; on the event with names and overlaps marked, on the player page with the date. */
export function ElsewhereList(props: { entries: ElsewhereEntry[]; showPerson: boolean; showDate: boolean; overlapWith?: Span }) {
  return (
    <ul class="list elsewhere">
      {props.entries.map((x) => {
        const clash = props.overlapWith ? overlaps(x.event, props.overlapWith) : false;
        return (
          <li class={`list-row${clash ? " elsewhere-clash" : ""}`}>
            <span class="main">
              <span class="title">
                {props.showPerson ? `${personName(x.person)} · ` : ""}
                {x.event.title}
              </span>
              <span class="sub">
                {props.showDate ? `${shortDate(x.event.startsAt)}, ` : ""}
                {timeRange(x.event.startsAt, x.event.endsAt)}
                {x.event.teams.length ? ` · ${x.event.teams.join(" + ")}` : ""}
                {clash ? ` · ${t`overlaps`}` : ""}
              </span>
            </span>
            <StatusPill status={x.status} />
          </li>
        );
      })}
    </ul>
  );
}
