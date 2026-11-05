// Administration → game schedule (named after the source, e.g. "handball4all", when only one is switched on):
// when coaches are reminded to sync, and the state of every team with "Sync now" and a way to its link.
import { plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useState } from "preact/hooks";
import type { ModuleManifest } from "../../shared/module-api";
import { type ScheduleReminderDays, SCHEDULE_REMINDER_CHOICES } from "../../shared/club";
import { MODULES, type ModuleId, moduleOn } from "../../shared/modules";
import { api, errorMessage } from "../api";
import { useClub } from "../club";
import { ago } from "../format";
import { invalidate, useQuery } from "../store";
import { Button, ErrorBox, Segmented, Spinner, toast, TopBar, useDocumentTitle } from "../ui";
import { AdminOnly } from "./admin";
import { syncGames } from "./games";

interface SyncOverview {
  reminderDays: ScheduleReminderDays;
  connectors: { id: string; name: string }[];
  teams: {
    id: number;
    name: string;
    source: { id: string; name: string } | null;
    paused: { id: string; name: string } | null;
    syncedAt: string | null;
    error: string | null;
    upcomingGames: number;
    seasonPlayed: boolean;
    reminded: boolean;
  }[];
}

/** Switched-on game schedule sources; the admin menu shows the page only with at least one. */
export function useFixtureSources(): ModuleManifest[] {
  const club = useClub();
  return (MODULES as readonly ModuleManifest[]).filter((m) => m.kind === "fixtures" && moduleOn(club, m.id as ModuleId));
}

/** Title of the page and its menu entry: the source's name when only one is on. */
export function fixtureSyncTitle(sources: ModuleManifest[]): string {
  const only = sources.length === 1 ? sources[0] : undefined;
  return only && "vendor" in only && only.vendor ? String(only.vendor) : t`Game schedules`;
}

export function AdminFixtureSyncPage() {
  const title = fixtureSyncTitle(useFixtureSources());
  useDocumentTitle(title);
  const { data, error, reload } = useQuery<SyncOverview>("/admin/fixture-sync");
  const [syncing, setSyncing] = useState<number | null>(null);
  const options = SCHEDULE_REMINDER_CHOICES.map((d) => ({ value: String(d), label: d ? plural(d, { one: "# day", other: "# days" }) : t`Off` }));

  const setDays = async (value: string) => {
    const days = Number(value);
    try {
      await api.put("/admin/club", { scheduleReminderDays: days });
      toast(days ? t`Coaches are reminded after ${days} days without a sync.` : t`Reminder switched off.`);
      invalidate("/admin/fixture-sync", "/coach-hints", "/club");
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  };

  const sync = async (team: SyncOverview["teams"][number]) => {
    if (!team.source) return;
    setSyncing(team.id);
    try {
      const r = await syncGames(team.id, team.source.name);
      if (r) {
        const { created, moved, cancelled } = r;
        const name = team.name;
        toast(t`${name}: ${created} new, ${moved} moved, ${cancelled} cancelled.`);
      }
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setSyncing(null);
      invalidate("/admin/fixture-sync", "/coach-hints");
    }
  };

  const status = (team: SyncOverview["teams"][number]) => {
    if (team.paused) {
      const name = team.paused.name;
      return t`Sync paused: ${name} is switched off`;
    }
    if (!team.source) return t`No game schedule linked`;
    const when = team.syncedAt ? ago(team.syncedAt) : "";
    const synced = team.syncedAt ? t`Synced ${when}` : t`Not synced yet`;
    const games = team.seasonPlayed ? t`season played` : plural(team.upcomingGames, { one: "# upcoming game", other: "# upcoming games" });
    return `${team.source.name} · ${synced} · ${games}`;
  };

  return (
    <AdminOnly>
      <main class="page">
        <TopBar title={title} kicker={t`Administration`} back="/verwaltung" />
        <div class="content">
          {error ? <ErrorBox error={error} onRetry={reload} /> : null}
          {!data && !error ? <Spinner /> : null}
          {data ? (
            <section class="card card-pad stack-sm" aria-label={t`Reminder to sync`}>
              <h2 class="section-title" style={{ margin: 0 }}>
                <Trans>Reminder to sync</Trans>
              </h2>
              <p class="small muted">
                <Trans>
                  When a team's last sync is this long ago, its coaches see a hint with "Sync now" at the top of their events list. The hint disappears after the
                  sync. A coach or admin always syncs by hand.
                </Trans>
              </p>
              <Segmented label={t`Remind coaches after`} value={String(data.reminderDays)} options={options} onChange={(v) => void setDays(v)} />
            </section>
          ) : null}
          {data ? (
            <section class="stack-sm" aria-label={t`Teams`}>
              <h2 class="section-title">
                <Trans>Teams</Trans>
              </h2>
              <ul class="list">
                {data.teams.map((team) => (
                  <li key={team.id}>
                    <div class="list-row">
                      <span class="team-badge" style={{ minWidth: "48px", textAlign: "center" }}>
                        {team.name}
                      </span>
                      <span class="main">
                        <span class="sub">{status(team)}</span>
                        {team.error ? (
                          <span class="sub" style={{ color: "var(--warn)" }}>
                            <Trans>Last sync failed: {team.error}</Trans>
                          </span>
                        ) : null}
                        {team.reminded ? (
                          <span class="sub" style={{ color: "var(--warn)" }}>
                            <Trans>Coaches are being reminded</Trans>
                          </span>
                        ) : null}
                      </span>
                    </div>
                    <div class="btn-row" style={{ padding: "0 14px 12px" }}>
                      {team.source ? (
                        <Button size="sm" icon="refresh" disabled={syncing != null} onClick={() => void sync(team)}>
                          {syncing === team.id ? t`Syncing …` : t`Sync now`}
                        </Button>
                      ) : null}
                      <a class="btn btn-sm btn-ghost" href={`/team/${team.id}`} onClick={() => sessionStorage.setItem(`team-tab-${team.id}`, "einstellungen")}>
                        {team.source || team.paused ? <Trans>Change link</Trans> : <Trans>Add link</Trans>}
                      </a>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      </main>
    </AdminOnly>
  );
}
