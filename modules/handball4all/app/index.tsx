// App part of the handball4all module: live ticker and game report for games from handball4all.
import { Trans } from "@lingui/react/macro";
import { defineAppModule } from "../../../src/module-api";
import manifest from "../module";
import { GameReportLink, LiveTickerLink } from "./live";

export default defineAppModule({
  manifest,
  gameLinks: ({ event, phase }) => {
    const g = event.game;
    // Games of this source, or games of a team linked to it (the ticker falls back to the team's page)
    if (g?.source?.connector !== manifest.id && g?.table?.connector !== manifest.id) return null;
    if (phase === "after") return g.source ? <GameReportLink event={event} /> : null;
    return (
      <>
        <LiveTickerLink event={event} />
        <p class="small muted">
          <Trans>The live ticker opens in a new window on handball4all.</Trans>
        </p>
      </>
    );
  },
});
