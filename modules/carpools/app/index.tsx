// App part of the carpools module: the card on the event page of away games and a line on event cards.
import { plural, t } from "@lingui/core/macro";
import { Icon } from "../../../src/icons";
import { defineAppModule } from "../../../src/module-api";
import manifest from "../module";
import type { CarpoolCount, CarpoolInfo } from "../types";
import { CarpoolCard } from "./card";
import "./carpool.css";

/** "Carpools (2/5) · 1 is still looking". */
function carpoolLine(c: CarpoolCount): string {
  const { taken, seats, waiting } = c;
  const head = t`Carpools (${taken}/${seats})`;
  return waiting ? `${head} · ${plural(waiting, { one: "# is still looking", other: "# are still looking" })}` : head;
}

export default defineAppModule({
  manifest,
  eventCardLine: ({ event, data }) => (
    <a class="carpool-line" href={`/termine/${event.id}`}>
      <Icon name="car" size={16} />
      {carpoolLine(data as CarpoolCount)}
    </a>
  ),
  eventSection: ({ event, data, reload }) => <CarpoolCard event={event} carpool={data as CarpoolInfo} onChanged={reload} />,
});
