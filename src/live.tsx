// Games in progress and just played: the "In progress" card on the start page and the time windows in which
// fixture modules offer their links (live ticker, game report; modules/<id>/app, hook gameLinks).
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import type { EventSummary } from "../shared/types";
import { nowLocal, time } from "./format";
import { Ball } from "./icons";
import { useActiveModules } from "./modules";

/** For this long after kick-off games count as "just played" (game report). */
const REPORT_DAYS = 7;

/** Minutes since kick-off (both times local time; read as UTC the difference is right except across a DST change). */
function minutesSince(e: EventSummary, nowLocalTime: string): number {
  return (Date.parse(`${nowLocalTime}:00Z`) - Date.parse(`${e.startsAt}:00Z`)) / 60_000;
}

/** Is the game in progress (kicked off, duration by age group) and linked to a game schedule? */
export function isLiveWindow(e: EventSummary, nowLocalTime = nowLocal()): boolean {
  if (e.kind !== "game" || e.cancelled || !(e.game?.source || e.game?.table)) return false;
  const since = minutesSince(e, nowLocalTime);
  return since >= 0 && since < e.game.liveMinutes;
}

/** After an imported game (up to 7 days), e.g. for the game report. */
export function isReportWindow(e: EventSummary, nowLocalTime = nowLocal()): boolean {
  if (e.kind !== "game" || e.cancelled || !e.game?.source) return false;
  const since = minutesSince(e, nowLocalTime);
  return since >= e.game.liveMinutes && since < REPORT_DAYS * 24 * 60;
}

/** Links of the active fixture modules for this game in this phase. */
export function GameLinks({ event, phase }: { event: EventSummary; phase: "live" | "after" }) {
  const modules = useActiveModules();
  return (
    <>
      {modules.map((m) => {
        const Links = m.gameLinks;
        return Links ? <Links key={m.manifest.id} event={event} phase={phase} /> : null;
      })}
    </>
  );
}

/** Large card for a game in progress. */
export function LiveCard({ event }: { event: EventSummary }) {
  const g = event.game!;
  const home = g.homeTeam ?? t({ message: "Home", context: "home team" });
  const guest = g.guestTeam ?? t({ message: "Away", context: "away team" });
  const kickoff = time(event.startsAt);
  return (
    <section class="card live-card" aria-label={t`Game in progress`}>
      <div class="card-head">
        <span class="label">
          <Trans>In progress · Game</Trans>
        </span>
        <span class="live-badge on">
          <Trans>Live</Trans>
        </span>
      </div>
      <div class="card-body has-ball stack-sm">
        <Ball class="next-ball" />
        <a href={`/termine/${event.id}`} style={{ textDecoration: "none" }}>
          <div style={{ fontWeight: 700, fontSize: "18px" }}>
            {home} – {guest}
          </div>
          <div class="small muted">
            <Trans>Kick-off {kickoff}</Trans>
          </div>
        </a>
        <GameLinks event={event} phase="live" />
      </div>
    </section>
  );
}
