import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useState } from "preact/hooks";
import type { TeamRef } from "../../shared/types";
import { api, errorMessage } from "../api";
import { ago, fullDate, isoToLocalDate } from "../format";
import { invalidate, useQuery } from "../store";
import { Button, Field, toast } from "../ui";

export interface Source {
  configured: boolean;
  connector: { id: string; name: string; fetchFrom: "device" | "worker" } | null;
  description: string | null;
  fetchUrl: string | null;
  importedAt: string | null;
  error: string | null;
  /** Sources a coach can link (switched-on fixture modules). */
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
 * Team → Settings: link the team's page at a game schedule source and sync it. The link the coach pastes
 * picks the source (the first switched-on fixture module that recognises it).
 */
export function ScheduleSection({ team, onChanged }: { team: TeamRef; onChanged: () => void }) {
  const source = useQuery<Source>(`/teams/${team.id}/games/source`);
  const [link, setLink] = useState("");
  const data = source.data;
  if (!data || !data.connectors.length) return null;
  const linked = data.configured ? data.connector : null;
  const field = data.connectors.find((c) => c.id === linked?.id)?.link ?? data.connectors[0]!.link;
  const names = data.connectors.map((c) => c.name).join(", ");
  const name = linked?.name ?? names;
  const description = data.description ?? "";
  const importedDate = data.importedAt ? fullDate(isoToLocalDate(data.importedAt)) : "";
  const reload = () => {
    void source.reload();
    onChanged();
  };
  return (
    <section class="card card-body" aria-label={t`Game schedule`}>
      <h2 class="section-title" style={{ margin: 0 }}>
        <Trans>Game schedule ({name})</Trans>
      </h2>
      {linked ? (
        <p>
          <Trans>Linked: {description}.</Trans>
          {data.importedAt ? " " + t`Last synced on ${importedDate}.` : " " + t`Not synced yet.`}
        </p>
      ) : (
        <p class="muted">
          <Trans>Not linked yet.</Trans>
        </p>
      )}
      {data.error ? <p class="small warn-text">{data.error}</p> : null}
      <Field label={field.label} hint={field.hint}>
        {(id) => (
          <input id={id} class="input" type="url" value={link} placeholder={field.placeholder} onInput={(e) => setLink((e.target as HTMLInputElement).value)} />
        )}
      </Field>
      <div class="btn-row">
        <Button
          variant="primary"
          disabled={!link.trim()}
          onClick={async () => {
            await api.put(`/teams/${team.id}/games/source`, { link: link.trim() });
            setLink("");
            toast(t`Linked. Use "Sync now" to fetch the game schedule.`);
            invalidate(`/teams/${team.id}`);
            reload();
          }}
        >
          <Trans>Link schedule</Trans>
        </Button>
        {linked ? (
          <Button
            variant="ghost"
            onClick={async () => {
              await api.put(`/teams/${team.id}/games/source`, { link: null });
              reload();
            }}
          >
            <Trans>Unlink schedule</Trans>
          </Button>
        ) : null}
      </div>
      {linked ? <SourceBar team={team} /> : null}
      <p class="small muted">
        <Trans>Syncing only happens at the press of a button, on a coach's or admin's device or by the app's server, never automatically.</Trans>
      </p>
    </section>
  );
}
