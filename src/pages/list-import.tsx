// Administration → Import: teams, coaches and players from the club's lists (src/list-import.tsx), or data from an
// export of Kabine (src/restore.tsx). The setup wizard offers both at its teams step.
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useLocation } from "preact-iso";
import { useState } from "preact/hooks";
import { hasListImportDraft, ListImport } from "../list-import";
import { RestoreFromExport } from "../restore";
import { useSession } from "../session";
import { invalidate, useQuery } from "../store";
import { Button, ErrorBox, Notice, Spinner, TopBar, useDocumentTitle } from "../ui";
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
  const [mode, setMode] = useState<"choose" | "lists" | "export">(() => (hasListImportDraft() ? "lists" : "choose"));
  const done = async () => {
    invalidate("/teams", "/admin/persons");
    await refresh();
    route("/verwaltung/personen");
  };
  return (
    <AdminOnly>
      <main class="page">
        <TopBar title={t`Import`} kicker={t`Administration`} back="/verwaltung" />
        <div class="content">
          {teams.error ? <ErrorBox error={teams.error} onRetry={teams.reload} /> : null}
          {ages.error ? <ErrorBox error={ages.error} onRetry={ages.reload} /> : null}
          {mode === "choose" ? (
            <ImportChoice onLists={() => setMode("lists")} onExport={() => setMode("export")} />
          ) : mode === "export" ? (
            <RestoreFromExport cancelLabel={t`Back`} onCancel={() => setMode("choose")} onDone={done} />
          ) : !teams.data || !ages.data ? (
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
              onCancel={() => setMode("choose")}
              onDone={done}
            />
          )}
        </div>
      </main>
    </AdminOnly>
  );
}

/** Lists of the club, or an export of Kabine: the two sources of an import. */
export function ImportChoice({ onLists, onExport }: { onLists: () => void; onExport: () => void }) {
  return (
    <>
      <section class="card card-pad stack-sm" aria-label={t`From lists`}>
        <h2 class="section-title" style={{ margin: 0 }}>
          <Trans>From the club's lists</Trans>
        </h2>
        <p class="small muted">
          <Trans>Excel (.xlsx) or CSV files, also several with overlapping people, or a pasted table. Teams, coaches and players, checked before anything is created.</Trans>
        </p>
        <Button variant="primary" onClick={onLists}>
          <Trans>Import lists</Trans>
        </Button>
      </section>
      <section class="card card-pad stack-sm" aria-label={t`From an export of Kabine`}>
        <h2 class="section-title" style={{ margin: 0 }}>
          <Trans>From an export of Kabine</Trans>
        </h2>
        <p class="small muted">
          <Trans>The JSON file from Administration → Export, for example when moving to a new installation. You choose what to take over.</Trans>
        </p>
        <Button onClick={onExport}>
          <Trans>Choose export file</Trans>
        </Button>
      </section>
    </>
  );
}
