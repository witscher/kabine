// Restore from Kabine's own export (Administration → Export) on the Import page and in the setup wizard. The file is
// read in this browser; the ticked parts go to the server table by table, in small chunks, with the ids it handed
// out so far (worker/routes/restore.ts). Existing data stays, nothing is deleted.
import { plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useState } from "preact/hooks";
import {
  checkExport,
  type KabineExport,
  RESTORE_CATEGORIES,
  RESTORE_TABLES,
  type RestoreCategory,
  type RestoreTally,
  rowCount,
  runRestore,
  withNeeds,
} from "../shared/restore";
import { api, errorMessage } from "./api";
import { fullDate, isoToLocalDate } from "./format";
import { Button, Field, Notice, toast } from "./ui";

function categoryLabel(c: RestoreCategory): string {
  switch (c) {
    case "club":
      return t`Club settings (name, colours, logo, region, functions)`;
    case "season":
      return t`Season, age groups and holidays`;
    case "teams":
      return t`Teams and groups`;
    case "people":
      return t`People, parent links, e-mail addresses, profile pictures`;
    case "memberships":
      return t`Team assignments and core squads`;
    case "plans":
      return t`Training venues and training plans`;
    case "events":
      return t`Events with responses, squads, attendance, helper duties and carpools`;
    case "chats":
      return t`Team chats`;
  }
}

function count(file: KabineExport, c: RestoreCategory): number {
  if (c === "club") return file.data.app_meta?.some((m) => m.key === "club") ? 1 : 0;
  if (c === "chats") return Object.values(file.data.chats ?? {}).filter((x) => x?.messages.length).length;
  // The main table of the category: seasons, teams, persons, events, …
  return rowCount(file, RESTORE_TABLES[c][0]!);
}

export function RestoreFromExport({ onDone, onCancel, cancelLabel }: { onDone: () => void; onCancel: () => void; cancelLabel: string }) {
  const [file, setFile] = useState<KabineExport | null>(null);
  const [chosen, setChosen] = useState<Set<RestoreCategory>>(new Set(RESTORE_CATEGORIES));
  const [problem, setProblem] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [tally, setTally] = useState<RestoreTally | null>(null);

  const read = async (f: File) => {
    setProblem(null);
    try {
      const checked = checkExport(JSON.parse(await f.text()));
      if (typeof checked === "string") setProblem(t`This file is not an export of Kabine.`);
      else setFile(checked);
    } catch {
      setProblem(t`This file is not an export of Kabine.`);
    }
  };

  const toggle = (c: RestoreCategory, on: boolean) => {
    const next = new Set(chosen);
    if (on) for (const x of withNeeds([c])) next.add(x);
    else {
      next.delete(c);
      // Whatever needs it goes too
      for (const x of RESTORE_CATEGORIES) if (withNeeds([x]).has(c)) next.delete(x);
    }
    setChosen(next);
  };

  const run = async () => {
    if (!file) return;
    setProblem(null);
    try {
      const result = await runRestore(file, chosen, (path, body) => api.post(path, body), (p) => {
        if ("chat" in p) {
          const name = p.chat;
          setProgress(t`Team chats: ${name}`);
        } else {
          const label = categoryLabel(p.category);
          const done = p.done;
          const total = p.total;
          setProgress(t`${label}: ${done} of ${total}`);
        }
      });
      setTally(result);
      toast(t`Restore finished`);
    } catch (err) {
      setProblem(errorMessage(err));
    } finally {
      setProgress(null);
    }
  };

  if (tally) {
    return (
      <>
        <section class="card card-pad stack-sm" aria-label={t`Result`}>
          <h2 class="section-title" style={{ margin: 0 }}>
            <Trans>Restore finished</Trans>
          </h2>
          <ul class="list">
            {RESTORE_CATEGORIES.filter((c) => chosen.has(c)).map((c) => {
              const { added, existing, skipped } = tally[c];
              return (
                <li class="list-row">
                  <span class="main">
                    <span class="title">{categoryLabel(c)}</span>
                    <span class="sub">
                      {[
                        plural(added, { one: "# new", other: "# new" }),
                        existing ? plural(existing, { one: "# existed already", other: "# existed already" }) : null,
                        skipped ? plural(skipped, { one: "# could not be restored", other: "# could not be restored" }) : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
          <p class="small muted">
            <Trans>
              Passkeys and sign-ins are not part of an export. Everyone signs in again: with an e-mail code if their address was restored, otherwise with a
              personal link from Administration → People.
            </Trans>
          </p>
        </section>
        <Button variant="primary" block onClick={onDone}>
          <Trans>Done</Trans>
        </Button>
      </>
    );
  }

  const exportedOn = file ? fullDate(isoToLocalDate(file.exportedAt)) : "";
  const version = file?.version ?? "";
  return (
    <>
      <p class="muted">
        <Trans>
          Take over data from an export of Kabine (Administration → Export), for example when moving to a new installation. Tick what to take over.
          Ticking everything on a new installation restores it in full.
        </Trans>
      </p>
      <Notice>
        <Trans>
          Nothing is deleted or overwritten: what exists here already stays and is skipped. Passkeys, sign-ins and invitation links are not part of an
          export; everyone signs in again afterwards. To be safe, <a href="/api/admin/export">export the current data</a> first.
        </Trans>
      </Notice>
      <section class="card card-pad stack" aria-label={t`Export file`}>
        <Field label={t`Export file (.json)`}>
          {(id) => (
            <input
              id={id}
              type="file"
              class="input"
              accept=".json,application/json"
              onChange={(e) => {
                const f = (e.target as HTMLInputElement).files?.[0];
                if (f) void read(f);
              }}
            />
          )}
        </Field>
        {file ? (
          <p class="small muted">{version ? t`Exported on ${exportedOn}, Kabine ${version}` : t`Exported on ${exportedOn}`}</p>
        ) : null}
        {problem ? <Notice kind="warn">{problem}</Notice> : null}
      </section>
      {file ? (
        <section class="card card-pad stack-sm" aria-label={t`What to take over`}>
          <h2 class="section-title" style={{ margin: 0 }}>
            <Trans>What to take over</Trans>
          </h2>
          <p class="small muted">
            <Trans>Admin roles are only taken over when everything is restored.</Trans>
          </p>
          {RESTORE_CATEGORIES.map((c) => {
            const n = count(file, c);
            const neededBy = RESTORE_CATEGORIES.filter((x) => chosen.has(x) && x !== c && withNeeds([x]).has(c));
            return (
              <label class="row-gap" style={{ alignItems: "flex-start", opacity: n ? 1 : 0.5 }}>
                <input type="checkbox" checked={chosen.has(c)} disabled={!!neededBy.length || !!progress} onChange={(e) => toggle(c, (e.target as HTMLInputElement).checked)} />
                <span class="main">
                  <span>{categoryLabel(c)}</span>
                  <span class="small muted" style={{ display: "block" }}>
                    {c === "club" ? (n ? t`in the file` : t`not in the file`) : c === "chats" ? plural(n, { one: "# chat", other: "# chats" }) : plural(n, { one: "# entry", other: "# entries" })}
                    {neededBy.length ? ` · ${t`needed by other ticked parts`}` : ""}
                  </span>
                </span>
              </label>
            );
          })}
        </section>
      ) : null}
      {progress ? <Notice>{progress}</Notice> : null}
      {file ? (
        <Button variant="primary" block disabled={!chosen.size || !!progress} onClick={run}>
          {chosen.size === RESTORE_CATEGORIES.length ? <Trans>Restore everything</Trans> : <Trans>Take over what is ticked</Trans>}
        </Button>
      ) : null}
      <Button variant="ghost" block disabled={!!progress} onClick={onCancel}>
        {cancelLabel}
      </Button>
    </>
  );
}
