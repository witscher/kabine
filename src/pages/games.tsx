import { plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useState } from "preact/hooks";
import type { TeamRef } from "../../shared/types";
import { api, errorMessage } from "../api";
import { ago, fullDate, isoToLocalDate } from "../format";
import { invalidate, useQuery } from "../store";
import { Button, confirmDialog, Field, toast } from "../ui";

export interface Source {
  configured: boolean;
  connector: { id: string; name: string; fetchFrom: "device" | "worker" } | null;
  description: string | null;
  fetchUrl: string | null;
  importedAt: string | null;
  error: string | null;
  /** The team's source while its module is switched off (sync paused). */
  paused: { id: string; name: string } | null;
  /** Upcoming games from the team's source; they stay, unsynced, when the source changes. */
  linkedGames: number;
  /** Sources a coach can choose (switched-on fixture modules); a team has one or none. */
  connectors: { id: string; name: string; link: { label: string; hint: string; placeholder: string } }[];
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
 * Sync the game schedule, only when a coach or admin presses the button (Team → Settings), never
 * automatically. The server hands out a reservation first so that several devices never query at the same
 * time. Sources that block servers are fetched here in the browser, the others by the server.
 */
export async function syncGames(teamId: number, name: string): Promise<ImportSummary | null> {
  const claim = await api.post<{ claimed: boolean; reason?: string; fetchUrl?: string; retryAt?: string; summary?: ImportSummary }>(`/teams/${teamId}/games/claim`, {
    manual: true,
  });
  if (!claim.claimed) {
    if (claim.reason === "recent") throw new Error(t`The game schedule was only just synced. Please try again in a few minutes.`);
    if (claim.reason === "busy") throw new Error(t`Another device is syncing the game schedule right now.`);
    return null;
  }
  if (claim.summary) {
    invalidate("/events", `/teams/${teamId}/games`);
    return claim.summary;
  }
  let data: unknown;
  try {
    const res = await fetch(claim.fetchUrl!, { credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer" });
    const status = res.status;
    if (!res.ok) throw new Error(t`${name} responded with status ${status}`);
    data = await res.json();
  } catch (err) {
    const detail = errorMessage(err);
    const message = t`${name} cannot be reached right now (${detail}).`;
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
            const r = await syncGames(team.id, source.data!.connector?.name ?? "");
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

/**
 * Team → Settings: the team's game schedule source (one or none) and the link to its page there. With
 * several sources switched on, the coach picks one; changing it leaves the games of the old source as
 * they are, only no longer synced.
 */
export function ScheduleSection({ team, onChanged }: { team: TeamRef; onChanged: () => void }) {
  const source = useQuery<Source>(`/teams/${team.id}/games/source`);
  const [link, setLink] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const data = source.data;
  if (!data || !data.connectors.length) return null;
  const linked = data.configured ? data.connector : null;
  // The choice: what the coach picked, else the linked source, else the only one there is
  const choice = picked ?? linked?.id ?? (data.connectors.length === 1 ? data.connectors[0]!.id : "");
  const chosen = data.connectors.find((c) => c.id === choice) ?? null;
  const description = data.description ?? "";
  const importedDate = data.importedAt ? fullDate(isoToLocalDate(data.importedAt)) : "";
  const reload = () => {
    void source.reload();
    onChanged();
  };
  /** Games of the current source stay but are no longer synced: ask first. */
  const confirmLeave = async (next: string | null) => {
    if (!linked || linked.id === next || !data.linkedGames) return true;
    const count = data.linkedGames;
    const old = linked.name;
    return confirmDialog({
      title: t`Change the game schedule source?`,
      message: plural(count, {
        one: `# upcoming game from ${old} stays in the app, but it is no longer synced.`,
        other: `# upcoming games from ${old} stay in the app, but they are no longer synced.`,
      }),
      confirmLabel: t`Change source`,
    });
  };
  const linkedName = linked?.name ?? "";
  const pausedName = data.paused?.name ?? "";
  return (
    <section class="card card-body" aria-label={t`Game schedule`}>
      <h2 class="section-title" style={{ margin: 0 }}>
        <Trans>Game schedule</Trans>
      </h2>
      {linked ? (
        <p>
          <Trans>
            Linked with {linkedName}: {description}.
          </Trans>
          {data.importedAt ? " " + t`Last synced on ${importedDate}.` : " " + t`Not synced yet.`}
        </p>
      ) : data.paused ? (
        <p class="small warn-text">
          <Trans>The source {pausedName} is switched off for the club. The games stay, but they are not synced.</Trans>
        </p>
      ) : (
        <p class="muted">
          <Trans>Not linked yet.</Trans>
        </p>
      )}
      {data.error && linked ? <p class="small warn-text">{data.error}</p> : null}
      {data.connectors.length > 1 ? (
        <Field label={t({ message: "Source", context: "game schedule" })} hint={t`Each team takes its games from one source.`}>
          {(id) => (
            <select id={id} class="select" value={choice} onChange={(e) => setPicked((e.target as HTMLSelectElement).value)}>
              {data.connectors.map((c) => (
                <option value={c.id}>{c.name}</option>
              ))}
              <option value="">{t`None (games from a table or by hand)`}</option>
            </select>
          )}
        </Field>
      ) : null}
      {chosen ? (
        <Field label={chosen.link.label} hint={chosen.link.hint}>
          {(id) => (
            <input id={id} class="input" type="url" value={link} placeholder={chosen.link.placeholder} onInput={(e) => setLink((e.target as HTMLInputElement).value)} />
          )}
        </Field>
      ) : null}
      <div class="btn-row">
        {chosen ? (
          <Button
            variant="primary"
            disabled={!link.trim()}
            onClick={async () => {
              if (!(await confirmLeave(chosen.id))) return;
              await api.put(`/teams/${team.id}/games/source`, { connector: chosen.id, link: link.trim() });
              setLink("");
              setPicked(null);
              toast(t`Linked. Use "Sync now" to fetch the game schedule.`);
              invalidate(`/teams/${team.id}`);
              reload();
            }}
          >
            <Trans>Link schedule</Trans>
          </Button>
        ) : null}
        {linked || data.paused ? (
          <Button
            variant="ghost"
            onClick={async () => {
              if (!(await confirmLeave(null))) return;
              await api.put(`/teams/${team.id}/games/source`, { link: null });
              setPicked(null);
              reload();
            }}
          >
            <Trans>Unlink schedule</Trans>
          </Button>
        ) : null}
      </div>
      {linked && choice === linked.id ? <SourceBar team={team} /> : null}
      <p class="small muted">
        <Trans>Syncing only happens at the press of a button, on a coach's or admin's device or by the app's server, never automatically.</Trans>
      </p>
    </section>
  );
}
