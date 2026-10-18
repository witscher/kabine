import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useState } from "preact/hooks";
import type { TeamRef } from "../../shared/types";
import { api, errorMessage } from "../api";
import { ago } from "../format";
import { invalidate, useQuery } from "../store";
import { Button, toast } from "../ui";

interface Source {
  configured: boolean;
  fetchUrl: string | null;
  importedAt: string | null;
  error: string | null;
}

interface ImportSummary {
  created: number;
  updated: number;
  moved: number;
  cancelled: number;
  skipped: number;
  foreign?: number;
}

/**
 * Sync the game schedule, only when a coach or admin presses the button (Team →
 * Settings), never automatically: handball4all only allows individual requests.
 * The fetch happens in the browser, never on the server. The server hands out a
 * reservation first so that several devices never query at the same time.
 */
export async function syncGames(teamId: number): Promise<ImportSummary | null> {
  const claim = await api.post<{ claimed: boolean; reason?: string; fetchUrl?: string; retryAt?: string }>(`/teams/${teamId}/games/claim`, { manual: true });
  if (!claim.claimed) {
    if (claim.reason === "recent") throw new Error(t`The game schedule was only just synced. Please try again in a few minutes.`);
    if (claim.reason === "busy") throw new Error(t`Another device is syncing the game schedule right now.`);
    return null;
  }
  let data: unknown;
  try {
    const res = await fetch(claim.fetchUrl!, { credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer" });
    const status = res.status;
    if (!res.ok) throw new Error(t`handball4all responded with status ${status}`);
    data = await res.json();
  } catch (err) {
    const detail = errorMessage(err);
    const message = t`handball4all cannot be reached right now (${detail}).`;
    await api.post(`/teams/${teamId}/games/release`, { error: errorMessage(err).slice(0, 250) }).catch(() => {});
    throw new Error(message);
  }
  const summary = await api.post<ImportSummary>(`/teams/${teamId}/games/import`, { data });
  invalidate("/events", `/teams/${teamId}/games`);
  return summary;
}

/** State of the game schedule with a button to sync it (Team → Settings). */
export function SourceBar({ team }: { team: TeamRef }) {
  const source = useQuery<Source>(`/teams/${team.id}/games/source`);
  const [syncing, setSyncing] = useState(false);
  if (!source.data?.configured) return null;
  const when = source.data.importedAt ? ago(source.data.importedAt) : "";
  return (
    <div class="row-gap" style={{ justifyContent: "space-between" }}>
      <div class="small muted">{syncing ? t`Syncing …` : source.data.importedAt ? t`Synced ${when}` : t`Not synced yet`}</div>
      <Button
        size="sm"
        icon="refresh"
        disabled={syncing}
        onClick={async () => {
          setSyncing(true);
          try {
            const r = await syncGames(team.id);
            if (r) {
              const { created, moved, cancelled, foreign } = r;
              toast(`${t`${created} new, ${moved} moved, ${cancelled} cancelled.`}${foreign ? ` ${t`${foreign} games already belong to another team and were skipped.`}` : ""}`);
            }
          } catch (err) {
            toast(errorMessage(err), "error");
          } finally {
            setSyncing(false);
            void source.reload();
          }
        }}
      >
        <Trans>Sync now</Trans>
      </Button>
    </div>
  );
}
