// What coaches still have to do in their own teams, at the top of the events list (GET /api/coach-hints):
// a game schedule not synced for a while, a game in the next days without a meeting point. A hint goes
// away once the job is done and cannot be dismissed. The same response names the schedules that sync by
// themselves and are due (weekly, or after a game without a result); this device syncs them once in the
// background (worker/domain/fixtures.ts, "Sync by itself").
import { plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useEffect, useState } from "preact/hooks";
import type { CoachHint, ScheduleAutoSync } from "../shared/types";
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
  const { data } = useQuery<{ hints: CoachHint[]; autoSync?: ScheduleAutoSync[] }>(coach ? "/coach-hints" : null);
  useEffect(() => {
    if (data?.autoSync?.length) void autoSync(data.autoSync);
  }, [data]);
  if (!data?.hints.length) return null;
  return (
    <section class="card card-body motd stack-sm" aria-label={t`To do for your teams`}>
      {data.hints.map((h) => (h.kind === "schedule" ? <ScheduleHint hint={h} /> : <MeetingHint hint={h} />))}
    </section>
  );
}

/** Teams this app load already tried: at most one sync by itself per team until the app is opened again. */
const autoTried = new Set<number>();

/**
 * Sync the due schedules one after the other, quietly: a toast only when games changed. A failure stays the
 * team's sync error (Team → Settings, Administration → game schedule) and is tried again at the next app start.
 */
async function autoSync(due: ScheduleAutoSync[]) {
  const todo = due.filter((s) => !autoTried.has(s.teamId));
  if (!todo.length) return;
  for (const s of todo) autoTried.add(s.teamId);
  for (const s of todo) {
    try {
      const r = await syncGames(s.teamId, s.source, { auto: true });
      if (r && (r.created || r.moved || r.cancelled)) {
        const { team } = s;
        const { created, moved, cancelled } = r;
        toast(`${t`Game schedule of ${team} synced.`} ${t`${created} new, ${moved} moved, ${cancelled} cancelled.`}`);
      }
    } catch {
      // The server keeps the error on the team
    }
  }
  invalidate("/coach-hints");
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
