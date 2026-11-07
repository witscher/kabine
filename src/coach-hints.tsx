// What coaches still have to do in their own teams, at the top of the events list (GET /api/coach-hints):
// a game schedule not synced for a while, a game in the next days without a meeting point. A hint goes
// away once the job is done and cannot be dismissed.
import { plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useState } from "preact/hooks";
import type { CoachHint } from "../shared/types";
import { errorMessage } from "./api";
import { shortDate, time } from "./format";
import { Icon } from "./icons";
import { syncGames } from "./pages/games";
import { useSession } from "./session";
import { invalidate, useQuery } from "./store";
import { Button, CoachMark, toast } from "./ui";

export function CoachHints() {
  const { me } = useSession();
  // Only coaches get hints; the request is not made for anyone else
  const coach = !!me?.memberships.some((m) => m.role === "coach");
  const { data } = useQuery<{ hints: CoachHint[] }>(coach ? "/coach-hints" : null);
  if (!data?.hints.length) return null;
  return (
    <section class="card card-body motd stack-sm" aria-label={t`To do for your teams`}>
      {data.hints.map((h) => (h.kind === "schedule" ? <ScheduleHint hint={h} /> : <MeetingHint hint={h} />))}
    </section>
  );
}

function ScheduleHint({ hint }: { hint: Extract<CoachHint, { kind: "schedule" }> }) {
  const [busy, setBusy] = useState(false);
  const team = hint.team;
  const days = hint.days ?? 0;
  return (
    <div class="row-gap coach-hint">
      <Icon name="refresh" size={22} />
      <span class="main">
        {hint.days === null
          ? t`Schedule of ${team} not synced yet`
          : plural(days, { one: `Schedule of ${team} not synced for # day`, other: `Schedule of ${team} not synced for # days` })}
      </span>
      <Button
        size="sm"
        variant="coach"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await syncGames(hint.teamId, hint.source);
            toast(t`Game schedule synced`);
          } catch (err) {
            toast(errorMessage(err));
          } finally {
            setBusy(false);
            invalidate("/coach-hints");
          }
        }}
      >
        {busy ? t`Syncing …` : t`Sync now`}
      </Button>
    </div>
  );
}

function MeetingHint({ hint }: { hint: Extract<CoachHint, { kind: "meeting" }> }) {
  const team = hint.team;
  const date = shortDate(hint.startsAt);
  const at = time(hint.startsAt);
  const opponent = hint.opponent;
  return (
    <div class="row-gap coach-hint">
      <Icon name="pin" size={22} />
      <span class="main">
        <strong>
          <Trans>Meeting point missing · {team}</Trans>
        </strong>
        <span class="small" style={{ display: "block" }}>
          {opponent ? t`Game against ${opponent} on ${date}, ${at}` : t`Game on ${date}, ${at}`}
        </span>
      </span>
      <a class="btn btn-sm btn-coach" href={`/termine/${hint.eventId}?treffpunkt=1`}>
        <CoachMark />
        <Trans>Enter</Trans>
      </a>
    </div>
  );
}
