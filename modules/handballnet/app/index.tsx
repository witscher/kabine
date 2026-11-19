// App part of the handball.net module: the game's page on handball.net (live ticker, report, result).
// A plain link, nothing is fetched or stored.
import { Trans } from "@lingui/react/macro";
import { defineAppModule } from "../../../src/module-api";
import { Icon } from "../../../src/icons";
import manifest from "../module";

/** The game's page; the calendar names it in URL (…/match/<id>), the id is the one in UID. */
const matchUrl = (id: string) => `https://www.handball.net/match/${id}`;

export default defineAppModule({
  manifest,
  gameLinks: ({ event }) => {
    const id = event.game?.source?.connector === manifest.id ? event.game.source.externalId : null;
    if (!id || !/^\d{1,12}$/.test(id)) return null;
    return (
      <a class="btn" href={matchUrl(id)} target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">
        <Icon name="link" size={18} />
        <Trans>Game on handball.net</Trans>
      </a>
    );
  },
});
