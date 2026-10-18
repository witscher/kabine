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
 * Spielplan abgleichen, nur auf Knopfdruck eines Trainers oder Admins (Team →
 * Einstellungen), nie automatisch: handball4all erlaubt nur Einzelzugriffe.
 * Der Abruf passiert im Browser, nie auf dem Server. Der Server vergibt vorher
 * eine Reservierung, damit nie mehrere Geräte gleichzeitig abfragen.
 */
export async function syncGames(teamId: number): Promise<ImportSummary | null> {
  const claim = await api.post<{ claimed: boolean; reason?: string; fetchUrl?: string; retryAt?: string }>(`/teams/${teamId}/games/claim`, { manual: true });
  if (!claim.claimed) {
    if (claim.reason === "recent") throw new Error("Der Spielplan wurde gerade erst abgeglichen. Bitte in ein paar Minuten noch einmal.");
    if (claim.reason === "busy") throw new Error("Ein anderes Gerät gleicht den Spielplan gerade ab.");
    return null;
  }
  let data: unknown;
  try {
    const res = await fetch(claim.fetchUrl!, { credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer" });
    if (!res.ok) throw new Error(`handball4all antwortet mit Status ${res.status}`);
    data = await res.json();
  } catch (err) {
    const message = `handball4all ist gerade nicht erreichbar (${errorMessage(err)}).`;
    await api.post(`/teams/${teamId}/games/release`, { error: errorMessage(err).slice(0, 250) }).catch(() => {});
    throw new Error(message);
  }
  const summary = await api.post<ImportSummary>(`/teams/${teamId}/games/import`, { data });
  invalidate("/events", `/teams/${teamId}/games`);
  return summary;
}

/** Stand des Spielplans mit Knopf zum Abgleichen (Team → Einstellungen). */
export function SourceBar({ team }: { team: TeamRef }) {
  const source = useQuery<Source>(`/teams/${team.id}/games/source`);
  const [syncing, setSyncing] = useState(false);
  if (!source.data?.configured) return null;
  return (
    <div class="row-gap" style={{ justifyContent: "space-between" }}>
      <div class="small muted">{syncing ? "Wird abgeglichen …" : source.data.importedAt ? `Abgeglichen ${ago(source.data.importedAt)}` : "Noch nicht abgeglichen"}</div>
      <Button
        size="sm"
        icon="refresh"
        disabled={syncing}
        onClick={async () => {
          setSyncing(true);
          try {
            const r = await syncGames(team.id);
            if (r) toast(`${r.created} neu, ${r.moved} verlegt, ${r.cancelled} entfallen.${r.foreign ? ` ${r.foreign} Spiele gehören schon einer anderen Mannschaft und wurden übersprungen.` : ""}`);
          } catch (err) {
            toast(errorMessage(err), "error");
          } finally {
            setSyncing(false);
            void source.reload();
          }
        }}
      >
        Jetzt abgleichen
      </Button>
    </div>
  );
}
