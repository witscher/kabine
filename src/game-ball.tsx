// Game rows of the event list: the team inside a ball on the right, with a small mark for one's own status, and the
// yellow "Home" tag before the title (docs/dev/design.md, Event rows). Shared so a module can draw its game rows
// (e.g. games of teams one follows, outlined) the same way.
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useClub } from "./club";
import { Ball } from "./icons";
import type { EventSummary, MyParticipation } from "../shared/types";
import { teamShortFor } from "../shared/sports";

/** Mark on the ball: accepted or nominated, declined, open, inactive (or not playing); null: none. */
export type BallMark = "yes" | "no" | "open" | "off" | null;

export interface BallState {
  cancelled: boolean;
  mark: BallMark;
  /** Read out with the team, e.g. "Accepted" */
  label: string | null;
  /** Instead of a symbol: "2/3" (several children, or the counts for coaches) */
  count?: string;
}

// Symbols as SVG paths instead of characters: exactly centred and bold, whatever the font
const MARK_PATHS: Partial<Record<NonNullable<BallMark>, string>> = {
  yes: "M5 12.5l4.5 4.5L19 7.5",
  no: "M6.5 6.5l11 11M17.5 6.5l-11 11",
  off: "M6 12h12",
  open: "M9 9a3 3 0 1 1 4.2 2.75c-.75.33-1.2 1-1.2 1.8v.45M12 18v.01",
};

/**
 * Ball on the right of a game row. The fill shows whose team it is (own team filled yellow, other teams outlined),
 * the small mark what oneself (or the child) has to do. A cancelled game is grey with the team struck through.
 */
export function GameBall({ teams, own, state }: { teams: string[]; own: boolean; state: BallState }) {
  const club = useClub();
  const short = teams.map((n) => teamShortFor(n, club.sport)).join("+");
  const path = state.mark ? MARK_PATHS[state.mark] : undefined;
  const name = teams.join(" + ");
  return (
    <span
      class={`game-ball ${state.cancelled ? "is-cancelled" : own ? "is-own" : "is-other"} ${short.length > 4 ? "long" : ""}`}
      role="img"
      aria-label={[name, state.label].filter(Boolean).join(", ")}
    >
      <Ball class="game-ball-svg" />
      <span class="game-ball-team" aria-hidden="true">
        {short}
      </span>
      {state.cancelled ? null : state.count ? (
        <span class={`game-ball-mark count mark-${state.mark ?? "none"}`} aria-hidden="true">
          {state.count}
        </span>
      ) : path ? (
        <span class={`game-ball-mark mark-${state.mark}`} aria-hidden="true">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round">
            <path d={path} />
          </svg>
        </span>
      ) : null}
    </span>
  );
}

/** State of the ball from the same rules as the former pills of the row. */
export function gameBallState(event: EventSummary, single: MyParticipation | null, mine: MyParticipation[]): BallState {
  const st = (mark: BallMark, label: string | null, count?: string): BallState => ({ cancelled: false, mark, label, count });
  if (event.cancelled) return { cancelled: true, mark: null, label: t`Not taking place` };
  if (single) {
    if (single.helpRequest?.status === "open") return st("open", t({ message: "Request", context: "help request" }));
    if (single.nominated && single.status === "yes") return st("yes", t`Nominated`);
    // Whole team at games: whoever does not play sees "Not nominated" (before the squad "Squad follows")
    if (event.game?.allPlayers && single.participant && single.status !== "no" && single.status !== "inactive") {
      return event.game.squadPublished ? st("off", t`Not nominated`) : st("open", t`Squad follows`);
    }
    if (single.status === "yes") return st("yes", t`Accepted`);
    if (single.status === "no") return st("no", single.isLate ? t`Declined at short notice` : t`Declined`);
    if (single.status === "standing") return st("off", t`Away long-term`);
    if (single.status === "inactive") return st("off", t`Inactive`);
    if (single.status === "open") return st("open", t({ message: "Open", context: "participation" }));
    return st(null, null);
  }
  if (mine.length > 1) {
    const yes = mine.filter((m) => m.status === "yes").length;
    const total = mine.filter((m) => m.participant).length;
    return st(yes === total ? "yes" : yes ? "open" : "no", t`${yes} of ${total} accepted`, `${yes}/${total}`);
  }
  if (event.canManage && event.counts) {
    const c = event.counts;
    const total = c.yes + c.no + c.open + c.standing + c.inactive;
    const present = c.present;
    if (present != null) return st(null, t`${present} of ${total} were there`, `${present}/${total}`);
    const yes = c.yes;
    return st(null, t`${yes} of ${total} accepted`, `${yes}/${total}`);
  }
  return st(null, null);
}

/** Home game: yellow tag before the title, the same on light and dark rows. */
export function HomeTag() {
  return (
    <span class="home-tag">
      <Trans context="home game">Home</Trans>
    </span>
  );
}
