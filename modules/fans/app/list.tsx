// The fans module in the event list on home (hook homeList): a star button for the games of the teams one follows, an
// optional button with the club's abbreviation for all games of the club, and the games as rows of their own.
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { clubShort } from "../../../src/club";
import { dayOfMonth, monthShort, nowLocal, time, weekdayShort } from "../../../src/format";
import { GameBall, HomeTag } from "../../../src/game-ball";
import { Icon } from "../../../src/icons";
import { GameLinks, isLiveWindow } from "../../../src/live";
import type { HomeListContext, HomeListPart } from "../../../src/module-api";
import type { FanGame, FansPage } from "../types";

/**
 * The module's part of the selection on this device (kept by the core in `kabine-home-list`): the star, and the view of
 * all games of the club. That view leaves the star and the team buttons as they were, so turning it off brings the
 * selection back.
 */
interface FansPick {
  games?: boolean;
  club?: boolean;
}

/** The button for all games of the club only shows when the person turned it on (page "Fan of …"), per device. */
const CLUB_BUTTON = "kabine-fans-club-button";

export function clubButtonEnabled(): boolean {
  try {
    return localStorage.getItem(CLUB_BUTTON) === "1";
  } catch {
    return false;
  }
}

export function setClubButtonEnabled(on: boolean) {
  try {
    if (on) localStorage.setItem(CLUB_BUTTON, "1");
    else localStorage.removeItem(CLUB_BUTTON);
  } catch {
    // Private mode: the switch lasts until the page is reloaded
  }
}

/** Followed teams of the last loaded page, so the star is there at once when home opens again (null: not known yet). */
let knownTeams: FansPage["teams"] | null = null;

/** Games without an end count as over two hours after kick-off. */
function endOf(g: FanGame): string {
  return g.endsAt ?? new Date(Date.parse(`${g.startsAt}:00Z`) + 120 * 60_000).toISOString().slice(0, 16);
}

export function fansHomeList(ctx: HomeListContext): HomeListPart | null {
  const page = ctx.data as FansPage | null | undefined;
  if (page !== undefined) knownTeams = page?.teams ?? [];
  const teams = page === undefined ? knownTeams : (page?.teams ?? []);
  const pick = (ctx.pick ?? {}) as FansPick;
  const clubButton = clubButtonEnabled();
  const club = !!pick.club && clubButton;
  const hasTeams = !!teams?.length;
  // While the teams are not known yet, the stored star counts, so the list does not flicker to "Nothing selected"
  const starOn = !club && !!pick.games && (teams === null || hasTeams);
  if (!hasTeams && !clubButton && !starOn) return null;

  const names = (teams ?? []).map((tm) => tm.name).join(", ");
  const short = clubShort();
  const buttons: HomeListPart["buttons"] = [];
  if (hasTeams) {
    buttons.push({
      key: "fans-star",
      label: <Icon name="star" size={16} />,
      ariaLabel: t`Games as a fan: ${names}`,
      class: "fan-badge",
      on: starOn,
      // Tapping the star in the view of all games ends that view, with the star on
      toggle: () => ctx.setPick({ ...pick, club: false, games: club ? true : !pick.games }),
    });
  }
  if (clubButton) {
    buttons.push({
      key: "fans-club",
      label: short,
      ariaLabel: t`${short}: all games of the club`,
      class: "club-badge",
      on: club,
      toggle: () => ctx.setPick({ ...pick, club: !club }),
    });
  }

  const nowL = nowLocal();
  const games = (page?.games ?? []).filter((g) => (ctx.when === "past" ? endOf(g) <= nowL : endOf(g) > nowL));
  return {
    buttons,
    active: club || starOn,
    query: club ? { club: "1" } : starOn ? { games: "1" } : {},
    takeover: club ? { show: "game", release: () => ctx.setPick({ ...pick, club: false }), sub: t`All games of the club` } : undefined,
    rows: games.map((g) => ({ key: `fan-${g.id}`, startsAt: g.startsAt, id: g.id, node: <FanRow key={`fan-${g.id}`} game={g} /> })),
    more: page?.more ?? undefined,
    sub: starOn && hasTeams ? t`Games as a fan` : undefined,
  };
}

/** A game one follows: game data only, the team in the outlined ball. While it runs, a taller tile with the live link. */
function FanRow({ game }: { game: FanGame }) {
  if (!isLiveWindow(game)) return <FanRowLink game={game} />;
  // A button may not sit inside the link, so the live link goes below it
  return (
    <div class="live-row" aria-label={t`Game in progress`}>
      <FanRowLink game={game} />
      <div class="live-row-foot">
        <span class="live-label">
          <span class="today-dot" aria-hidden="true" />
          <Trans>Game in progress</Trans>
        </span>
        <GameLinks event={game} phase="live" />
      </div>
    </div>
  );
}

function FanRowLink({ game }: { game: FanGame }) {
  const cancelled = !!game.cancelled;
  return (
    <a href={`/spiel/${game.id}`} class={`event-row ${cancelled ? "cancelled" : "dark"}`}>
      <div class="date-block">
        <div class="wd">{weekdayShort(game.startsAt)}</div>
        <div class="d">{dayOfMonth(game.startsAt)}</div>
        <div class="mo">{monthShort(game.startsAt)}</div>
      </div>
      <div class="main">
        <div class="title">
          {game.isHome ? <HomeTag /> : null}
          {game.shortTitle}
        </div>
        <div class="sub">
          {cancelled ? (
            <span class="cancel-tag">
              <Trans>Not taking place</Trans>
            </span>
          ) : (
            `${time(game.startsAt)} · ${game.location?.name ?? t`Location to follow`}`
          )}
          {game.result ? ` · ${game.result.home}:${game.result.guest}` : ""}
        </div>
      </div>
      <GameBall
        teams={game.teams.map((tm) => tm.name)}
        own={false}
        state={{ cancelled, mark: null, label: cancelled ? t`Not taking place` : game.following ? t`You follow this team` : null }}
      />
    </a>
  );
}
