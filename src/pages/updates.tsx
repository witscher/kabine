// Administration → Updates and maintenance: installed version, the last update with its restore point and the
// maintenance switch. Updates themselves arrive as pull requests in the club's GitHub copy (docs/operation.md).
import { plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { api } from "../api";
import { useClub } from "../club";
import { currentLocale } from "../i18n";
import { checkMaintenance } from "../maintenance";
import { useQuery } from "../store";
import { Icon } from "../icons";
import { copyText, ErrorBox, Notice, Spinner, SwitchRow, toast, TopBar, useDocumentTitle } from "../ui";
import { AdminOnly } from "./admin";

interface UpdatesView {
  version: string;
  lastUpdate: { at: string; version: string; migrations: string[]; bookmark: string | null } | null;
  maintenance: { since: string } | null;
  updating: { since: string } | null;
  /** Uses of `npm run admin:link`, newest first */
  breakGlass: { at: string; email: string; owner: boolean; revoked: string[] }[];
}

export function AdminUpdatesPage() {
  useDocumentTitle(t`Updates and maintenance`);
  const club = useClub();
  const { data, error, reload } = useQuery<UpdatesView>("/admin/updates");
  const when = (iso: string) => new Date(iso).toLocaleString(currentLocale(), { dateStyle: "medium", timeStyle: "short", timeZone: club.timeZone });
  const last = data?.lastUpdate ?? null;
  const restore = last?.bookmark ? `npx wrangler d1 time-travel restore DB --bookmark=${last.bookmark}` : null;
  const lastAt = last ? when(last.at) : "";
  const lastVersion = last?.version ?? "";
  const migrationCount = last?.migrations.length ?? 0;
  const since = data?.maintenance ? when(data.maintenance.since) : "";
  return (
    <AdminOnly>
      <main class="page">
        <TopBar title={t`Updates and maintenance`} kicker={t`Administration`} back="/verwaltung" />
        <div class="content">
          {error ? <ErrorBox error={error} onRetry={reload} /> : null}
          {!data && !error ? <Spinner /> : null}
          {data ? (
            <>
              <section class="card card-pad stack-sm" aria-label={t`Version`}>
                <h2 class="section-title" style={{ margin: 0 }}>
                  <Trans>Installed version</Trans>
                </h2>
                <p>
                  <strong>Kabine {data.version}</strong>
                </p>
                <p class="small muted">
                  <Trans>
                    New versions arrive as a pull request in your club's copy on GitHub. Merging it installs the update; you choose when. Updates that change
                    the database put the app into maintenance mode for about a minute, so merge those at a quiet time.
                  </Trans>
                </p>
              </section>

              <section class="card card-pad stack-sm" aria-label={t`Last update`}>
                <h2 class="section-title" style={{ margin: 0 }}>
                  <Trans>Last update</Trans>
                </h2>
                {last ? (
                  <>
                    <p>
                      <Trans>
                        {lastAt}, version {lastVersion}
                      </Trans>
                      {` · ${migrationCount ? plural(migrationCount, { one: "# database change", other: "# database changes" }) : t`no database changes`}`}
                    </p>
                    {restore ? (
                      <div class="stack-sm">
                        <p class="small muted">
                          <Trans>
                            Restore point from just before the database changes. If something is wrong after the update: roll back the Worker in the Cloudflare
                            dashboard (Workers & Pages → this Worker → Deployments), then restore the database with this command in your copy:
                          </Trans>
                        </p>
                        <div class="url-box">{restore}</div>
                        <button type="button" class="link-btn" style={{ alignSelf: "flex-start" }} onClick={() => void copyText(restore)}>
                          <Trans>Copy command</Trans>
                        </button>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <p class="small muted">
                    <Trans>No update recorded yet. The next deploy records it here.</Trans>
                  </p>
                )}
              </section>

              <section class="card card-pad stack-sm" aria-label={t`Maintenance mode`}>
                <h2 class="section-title" style={{ margin: 0 }}>
                  <Trans>Maintenance mode</Trans>
                </h2>
                {data.updating ? (
                  <Notice kind="warn">
                    <Trans>An update is being installed right now. The app is back in about a minute.</Trans>
                  </Notice>
                ) : null}
                <SwitchRow
                  label={t`Maintenance mode`}
                  sub={
                    data.maintenance
                      ? t`On since ${since}. Only admins can use the app; reminders and other automatic messages pause.`
                      : t`Only admins can use the app; reminders and other automatic messages pause. For work on the data, or before an update you want to check first.`
                  }
                  checked={!!data.maintenance}
                  onChange={async (on) => {
                    await api.put("/admin/maintenance", { on });
                    toast(on ? t`Maintenance mode on. It takes effect within a minute.` : t`Maintenance mode off. It takes effect within a minute.`);
                    await reload();
                    void checkMaintenance();
                  }}
                />
              </section>

              {data.breakGlass.length ? (
                <section class="card card-pad stack-sm" aria-label={t`Emergency admin access`}>
                  <h2 class="section-title" style={{ margin: 0 }}>
                    <Trans>Emergency admin access</Trans>
                  </h2>
                  <p class="small muted">
                    <Trans>
                      Admin links created with npm run admin:link by someone with access to the club's Cloudflare account. If you do not know why, check the
                      admins and that account.
                    </Trans>
                  </p>
                  <ul class="list">
                    {data.breakGlass.map((b) => {
                      const at = when(b.at);
                      const email = b.email;
                      const count = b.revoked.length;
                      const names = b.revoked.join(", ");
                      return (
                        <li class="list-row">
                          <Icon name="alert" size={20} />
                          <span class="main">
                            <span class="title">
                              <Trans>
                                {at}: admin link for {email}
                              </Trans>
                            </span>
                            <span class="sub">
                              {[
                                b.owner ? t`made owner` : null,
                                count ? plural(count, { one: `admin role taken from ${names}`, other: `admin role taken from # admins: ${names}` }) : null,
                              ]
                                .filter(Boolean)
                                .join(" · ") || t`no other changes`}
                            </span>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ) : null}
            </>
          ) : null}
        </div>
      </main>
    </AdminOnly>
  );
}
