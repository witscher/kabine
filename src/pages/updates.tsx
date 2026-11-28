// Administration → Updates and maintenance: installed version, the last update with its restore point and the
// maintenance switch, the newest release from kabine.dev with the update steps, and the switch for that daily check.
// Updates themselves arrive as pull requests in the club's GitHub copy (docs/operation.md, "Installing an update").
import { plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { api } from "../api";
import { useClub } from "../club";
import { currentLocale } from "../i18n";
import { checkMaintenance } from "../maintenance";
import { useQuery } from "../store";
import { Icon } from "../icons";
import { copyText, DocsLink, ErrorBox, Notice, Spinner, SwitchRow, toast, TopBar, useDocumentTitle } from "../ui";
import { AdminOnly } from "./admin";
import { type AvailableUpdate, updateGuideUrl } from "../../shared/releases";
import { useSession } from "../session";

interface UpdatesView {
  version: string;
  lastUpdate: { at: string; version: string; migrations: string[]; bookmark: string | null } | null;
  maintenance: { since: string } | null;
  updating: { since: string } | null;
  /** Newer release from kabine.dev; null: up to date, check off or nothing fetched yet */
  available: AvailableUpdate | null;
  check: { on: boolean; fetchedAt: string | null; latest: string | null };
  /** The club's copy on GitHub ("owner/name"), if known */
  repo: string | null;
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
  const day = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString(currentLocale(), { dateStyle: "medium", timeZone: "UTC" });
  const guide = updateGuideUrl(currentLocale());
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

              <NewVersionCard data={data} day={day} when={when} guide={guide} reload={reload} />

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

function NewVersionCard(props: { data: UpdatesView; day: (date: string) => string; when: (iso: string) => string; guide: string; reload: () => Promise<unknown> }) {
  const { data, day, when, guide } = props;
  const { refresh } = useSession();
  const next = data.available;
  const version = next?.version ?? "";
  const date = next ? day(next.date) : "";
  const checked = data.check.fetchedAt ? when(data.check.fetchedAt) : "";
  return (
    <section class="card card-pad stack-sm" aria-label={t`New versions`}>
      <h2 class="section-title" style={{ margin: 0 }}>
        <Trans>New versions</Trans>
      </h2>
      {!data.check.on ? (
        <p class="small muted">
          <Trans>The check for new versions is off. Update pull requests still arrive in your club's copy on GitHub.</Trans>
        </p>
      ) : next ? (
        <>
          <p>
            <strong>
              <Trans>
                Kabine {version} is available ({date}).
              </Trans>
            </strong>
          </p>
          {next.security ? (
            <div role="alert">
              <Notice kind="warn">
                <Trans>
                  <strong>Security update.</strong> It fixes a security problem; please install it soon.
                </Trans>
              </Notice>
            </div>
          ) : null}
          <div class="row-gap" style={{ flexWrap: "wrap" }}>
            <a class="btn btn-primary" href={next.installUrl} target="_blank" rel="noopener noreferrer">
              <Icon name="refresh" size={18} />
              <Trans>Install update</Trans>
            </a>
            <DocsLink href={next.notes}>
              <Trans>Release notes (kabine.dev)</Trans>
            </DocsLink>
          </div>
          <ol class="small stack-sm" style={{ margin: 0, paddingLeft: "20px" }}>
            {next.pullRequest ? (
              <li>
                <Trans>"Install update" opens the pull request "Update Kabine to v{version}" in your club's copy on GitHub.</Trans>
              </li>
            ) : (
              <li>
                <Trans>Open your club's copy on GitHub. Under Pull requests you find "Update Kabine to v{version}".</Trans>
              </li>
            )}
            <li>
              <Trans>Read what it says: whether the database changes, and whether wrangler.jsonc or workflow files need a change by hand.</Trans>
            </li>
            <li>
              <Trans>Merge it at a quiet time. With database changes the app pauses for about a minute.</Trans>
            </li>
            <li>
              <Trans>A few minutes later this page shows the new version as installed.</Trans>
            </li>
          </ol>
        </>
      ) : data.check.fetchedAt ? (
        <p class="small muted">
          <Trans>This is the newest version. Last checked {checked}.</Trans>
        </p>
      ) : (
        <p class="small muted">
          <Trans>Not checked yet. The app asks kabine.dev once a day, from 10 o'clock.</Trans>
        </p>
      )}
      <DocsLink href={guide}>
        <Trans>Update guide: no pull request, skipping versions, going back (kabine.dev)</Trans>
      </DocsLink>
      <SwitchRow
        label={t`Look for new versions`}
        sub={t`Once a day the app asks kabine.dev for the newest version number and tells the admins by a hint and a push. Nothing about your club or its people is sent.`}
        checked={data.check.on}
        onChange={async (on) => {
          await api.put("/admin/update-check", { on });
          toast(on ? t`The app looks for new versions again.` : t`The app no longer looks for new versions.`);
          await props.reload();
          // The hint at the top of the administration comes from the session
          void refresh();
        }}
      />
    </section>
  );
}
