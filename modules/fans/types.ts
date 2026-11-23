// API shapes of the fans module, shared by worker and app.
import type { GameRef, LocationRef, TeamRef } from "../../shared/types";

/** A team of the club on the page "Fan of …": own teams are fixed, the others can be followed. */
export interface FollowTeam extends TeamRef {
  /** One's own team (any role) or a child's team with parents involved: its events are shown anyway. */
  own: boolean;
  following: boolean;
}

export interface FollowView {
  teams: FollowTeam[];
  /** Only the home games of the followed teams (list, push, calendar). */
  homeOnly: boolean;
  /** "Games as a fan" in the personal calendar. */
  calendar: boolean;
}

/**
 * A game of a team one follows, or of any team of the club in the view of all its games. Only data that is public
 * anyway: kick-off, venue, opponent, result, whether it takes place. No squad, responses, names, meeting point,
 * reason of a cancellation, carpools or chat.
 */
export interface FanGame extends GameRef {
  kind: "game";
  title: string;
  /** Title without the team ("SVM 2 – Opponent"); the team is in the ball. */
  shortTitle: string;
  endsAt: string | null;
  teams: TeamRef[];
  isHome: boolean | null;
  location: Pick<LocationRef, "name" | "address" | "mapUrl"> | null;
  /** Not taking place (without the reason and who cancelled). */
  cancelled: { at: string } | null;
  result: { home: number; guest: number } | null;
  /** One follows a team of this game. */
  following: boolean;
}

/** The module's data for a page of the event list on home (worker hook eventPage, `page.modules.fans`). */
export interface FansPage {
  /** Teams one follows, without one's own: the star button shows while there is one. */
  teams: TeamRef[];
  /** Games in the window of the page, when asked for (`fans.games=1` or `fans.club=1`). */
  games: FanGame[];
  /** More games than sent: the start of the last one sent (the list stops at its day until "More events"). */
  more: string | null;
}
