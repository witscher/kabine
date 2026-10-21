// Administration → Import: teams, coaches and players from the club's lists, at any time (the setup wizard offers
// the same at its teams step). Reading and checking happen in src/list-import.tsx, in the browser.
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useLocation } from "preact-iso";
import { ListImport } from "../list-import";
import { useSession } from "../session";
import { invalidate, useQuery } from "../store";
import { ErrorBox, Notice, Spinner, TopBar, useDocumentTitle } from "../ui";
import { AdminOnly } from "./admin";

interface AgeClassRow {
  code: string;
  name: string;
  birthYearMin?: number | null;
  birthYearMax?: number | null;
}

export function AdminListImportPage() {
  useDocumentTitle(t`Import`);
  const { route } = useLocation();
  const { refresh } = useSession();
  const teams = useQuery<{ teams: { name: string }[] }>("/teams");
  const ages = useQuery<{ ageClasses: AgeClassRow[] }>("/age-classes");
  const classes = ages.data?.ageClasses ?? [];
  return (
    <AdminOnly>
      <main class="page">
        <TopBar title={t`Import`} kicker={t`Administration`} back="/verwaltung" />
        <div class="content">
          {teams.error ? <ErrorBox error={teams.error} onRetry={teams.reload} /> : null}
          {ages.error ? <ErrorBox error={ages.error} onRetry={ages.reload} /> : null}
          {!teams.data || !ages.data ? (
            !teams.error && !ages.error ? <Spinner /> : null
          ) : !classes.length ? (
            <Notice kind="warn">
              <Trans>
                The season has no age groups yet. Add them under <a href="/verwaltung/altersklassen">age groups</a> first.
              </Trans>
            </Notice>
          ) : (
            <ListImport
              inSetup={false}
              ageClasses={classes.map((a) => ({ code: a.code, name: a.name, birthYearMin: a.birthYearMin ?? null, birthYearMax: a.birthYearMax ?? null }))}
              existingTeams={teams.data.teams.map((x) => x.name)}
              onCancel={() => route("/verwaltung")}
              onDone={async () => {
                invalidate("/teams", "/admin/persons");
                await refresh();
                route("/verwaltung/personen");
              }}
            />
          )}
        </div>
      </main>
    </AdminOnly>
  );
}
