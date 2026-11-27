// The home game day in the event list on home (hook homeList): a large card in time order with the next event, and
// later days the person is involved in as small tiles at the kick-off of the first home game.
import { plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { dayOfMonth, longDate, monthShort, nowLocal, relativeDay, time, weekdayShort } from "../../../src/format";
import { Icon } from "../../../src/icons";
import type { HomeListContext, HomeListPart } from "../../../src/module-api";
import type { GamedayCard, GamedayMine, GamedayPage } from "../types";

export const mascotUrl = (version: number | null) => (version ? `/api/gameday/mascot?v=${version}` : null);

/** Kicked off and not over yet (duration of the age class): such a game keeps its row with the live link in the list. */
function running(m: GamedayMine, nowL: string): boolean {
  const since = (Date.parse(`${nowL}:00Z`) - Date.parse(`${m.startsAt}:00Z`)) / 60_000;
  return since >= 0 && since < m.liveMinutes;
}

export function gamedayHomeList(ctx: HomeListContext): HomeListPart | null {
  if (ctx.when !== "upcoming") return null;
  const page = ctx.data as GamedayPage | null | undefined;
  if (!page) return null;
  const nowL = nowLocal();
  const mascot = mascotUrl(page.mascotVersion);
  return {
    card: page.card
      ? {
          key: `gameday-${page.card.date}`,
          day: page.card.date,
          node: <GamedayCardView card={page.card} mascot={mascot} />,
          // Games one follows stand on the card, not again in the list, except while they run (live link)
          covers: page.card.mine.filter((m) => m.fan && !running(m, nowL)).map((m) => m.eventId),
        }
      : undefined,
    rows: page.later.map((d) => ({ key: `gameday-${d.date}`, startsAt: d.startsAt, id: 0, node: <GamedayRow key={`gameday-${d.date}`} date={d.date} mascot={mascot} /> })),
  };
}

/** The large card: the day's time span, one line per own or followed game, the mascot if the club has one. */
function GamedayCardView({ card, mascot }: { card: GamedayCard; mascot: string | null }) {
  const day = relativeDay(`${card.date}T00:00`);
  const date = longDate(`${card.date}T00:00`);
  const count = card.teams;
  const hall = card.hall;
  const first = time(card.first);
  const last = time(card.last);
  return (
    <a class={`card card-pad stack-sm gameday-card ${mascot ? "has-mascot" : ""}`} href={`/heimspieltag/${card.date}`} aria-label={t`Home game day ${date}`}>
      <div class="row-between gameday-head">
        <div class="kicker">
          <Trans>Home game day · {day}</Trans>
        </div>
        <span class="gameday-count">{plural(count, { one: "# team", other: "# teams" })}</span>
      </div>
      <strong class="gameday-claim">{hall ? t`Home games all day at ${hall}!` : t`Home games all day!`}</strong>
      <div class="gameday-time">
        <Icon name="clock" size={17} />
        <Trans>
          {first} to {last}
        </Trans>
      </div>
      {card.mine.length ? (
        <ul class="gameday-games">
          {card.mine.map((m) => (
            <li key={`${m.eventId}-${m.team}`}>
              <strong>{time(m.startsAt)}</strong>
              <span>{m.team}</span>
              {m.fan ? (
                <span class="gameday-fan">
                  <Icon name="star" size={13} />
                  <Trans>Fan</Trans>
                </span>
              ) : (
                <span class="muted">
                  <Trans>your team</Trans>
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      <span class="btn btn-primary btn-sm gameday-button">
        <Trans>See all games</Trans>
      </span>
      <div class="gameday-cheer">
        <Trans>Come along and cheer!</Trans>
      </div>
      {mascot ? <img class="gameday-mascot" src={mascot} alt="" width={118} height={132} decoding="async" /> : null}
    </a>
  );
}

/** A later home game day: a small white tile, the mascot if any, no further details. */
function GamedayRow({ date, mascot }: { date: string; mascot: string | null }) {
  const at = `${date}T00:00`;
  return (
    <a href={`/heimspieltag/${date}`} class="event-row gameday-row">
      <div class="date-block">
        <div class="wd">{weekdayShort(at)}</div>
        <div class="d">{dayOfMonth(at)}</div>
        <div class="mo">{monthShort(at)}</div>
      </div>
      <div class="main">
        <div class="title">
          <Trans>Home game day</Trans>
        </div>
      </div>
      {mascot ? <img class="gameday-row-head" src={mascot} alt="" width={64} height={64} decoding="async" /> : null}
    </a>
  );
}
