// API shapes of the home game day module, shared by worker and app.
import type { GameRef, TeamRef } from "../../shared/types";

/** Hours of the day before at which the push may go out (club time). */
export const GAMEDAY_HOURS = [12, 18, 20] as const;
export type GamedayHour = (typeof GAMEDAY_HOURS)[number];

/** Settings of the club (app_meta key "gameday"). */
export interface GamedaySettings {
  /** The push the day before; the card and the page come with the module switch. */
  enabled: boolean;
  /** A day counts from this many teams with a home game. */
  minTeams: number;
  hour: GamedayHour;
  /** Version of the mascot picture (KV), null: none uploaded. */
  mascotVersion: number | null;
}

/** An own or followed game on the card, with what the app needs to tell whether it is running. */
export interface GamedayMine {
  eventId: number;
  startsAt: string;
  team: string;
  fan: boolean;
  /** Minutes the game counts as in progress (age class), for leaving running games in the list. */
  liveMinutes: number;
}

/** The card on home: a home game day the person is involved in, in the next days. */
export interface GamedayCard {
  date: string;
  /** Teams with a home game that day. */
  teams: number;
  /** The venue with the most games of the day. */
  hall: string | null;
  /** First and last kick-off, local time. */
  first: string;
  last: string;
  mine: GamedayMine[];
}

/** The module's data for a page of the event list on home (worker hook eventPage, `page.modules.gameday`). */
export interface GamedayPage {
  card: GamedayCard | null;
  /** Later days the person is involved in, as small tiles at the kick-off of the first home game. */
  later: { date: string; startsAt: string }[];
  mascotVersion: number | null;
}

/** A game on the page of the day: game data that is public anyway, no squad, responses or names. */
export interface GamedayGame extends GameRef {
  kind: "game";
  title: string;
  teams: TeamRef[];
  location: string | null;
  /** One of the person's own teams (or a child's). */
  own: boolean;
  /** A team the person follows. */
  fan: boolean;
  /** Where the row leads: the event page for own games, the game page of the fans module, or nowhere. */
  href: string | null;
}

export interface GamedayDetail extends Omit<GamedayCard, "mine"> {
  games: GamedayGame[];
  /** Open helper slots of the day the person could take (null: helper duties off). */
  helpersNeeded: number | null;
  mascotVersion: number | null;
}

/** Administration → Home game days. */
export interface GamedaySettingsView extends GamedaySettings {
  /** The next home game day in the next 90 days, when the push goes out and to how many accounts. */
  next: { date: string; teams: number; sendAt: string; recipients: number } | null;
}
