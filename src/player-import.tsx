// Player list for coaches: paste from a spreadsheet (first name, last name, birth year), check the
// preview, create all at once. Names already in the team are skipped.
import { plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useState } from "preact/hooks";
import { parsePlayerList, type ListProblem } from "../shared/player-list";
import { api, errorMessage } from "./api";
import { todayLocal } from "./format";
import { Button, Field, Notice, toast } from "./ui";

interface PreviewRow {
  firstName: string;
  lastName: string | null;
  birthYear: number | null;
  status: "new" | "in_team" | "other_team";
  teams: string | null;
}

function problemText(p: ListProblem): string {
  const line = p.line;
  const value = p.value;
  return p.field === "name" ? t`Line ${line}: no first name` : t`Line ${line}: “${value}” is not a birth year`;
}

export function PlayerListImport({ teamId, onDone }: { teamId: number; onDone: () => void }) {
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<{ rows: PreviewRow[]; problems: ListProblem[] } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const send = async (commit: boolean) => {
    setProblem(null);
    const { players, problems } = parsePlayerList(text, Number(todayLocal().slice(0, 4)));
    if (!players.length) {
      setPreview({ rows: [], problems });
      return;
    }
    setBusy(true);
    try {
      const res = await api.post<{ rows: PreviewRow[]; created: number }>(`/teams/${teamId}/players/import`, {
        players: players.map(({ firstName, lastName, birthYear }) => ({ firstName, lastName, birthYear })),
        commit,
      });
      if (commit) {
        const created = res.created;
        toast(plural(created, { one: "# player added", other: "# players added" }));
        setText("");
        setPreview(null);
        onDone();
      } else setPreview({ rows: res.rows, problems });
    } catch (err) {
      setProblem(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const fresh = preview?.rows.filter((r) => r.status === "new").length ?? 0;
  return (
    <div class="stack-sm">
      <Field
        label={t`Player list`}
        hint={t`One player per line: first name, last name, birth year. Copy the columns from a spreadsheet or separate them with a semicolon.`}
      >
        {(id) => (
          <textarea
            id={id}
            class="textarea"
            rows={7}
            value={text}
            placeholder={"Kim;Muster;2014\nAlex;Beispiel;2015"}
            onInput={(e) => {
              setText((e.target as HTMLTextAreaElement).value);
              setPreview(null);
            }}
          />
        )}
      </Field>
      <p class="small muted">
        <Trans>Only first name, last name and birth year. The app stores no further data about players.</Trans>
      </p>
      {problem ? <Notice kind="warn">{problem}</Notice> : null}
      {preview ? (
        <>
          {preview.problems.length ? (
            <Notice kind="warn">
              <Trans>These lines are skipped:</Trans>
              <ul class="small" style={{ margin: "4px 0 0", paddingLeft: "18px" }}>
                {preview.problems.map((p) => (
                  <li>{problemText(p)}</li>
                ))}
              </ul>
            </Notice>
          ) : null}
          <ul class="list" aria-label={t`Preview`}>
            {preview.rows.map((r) => {
              const teams = r.teams ?? "";
              return (
                <li class="list-row">
                  <span class="main">
                    <span class="title">
                      {r.firstName} {r.lastName ?? ""}
                      {r.birthYear ? ` · ${r.birthYear}` : ""}
                    </span>
                    <span class="sub">
                      {r.status === "new"
                        ? t`will be added`
                        : r.status === "in_team"
                          ? t`already in the team, skipped`
                          : t`plays in ${teams}: add under “From another team”, skipped here`}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
          <Button variant="primary" block disabled={busy || !fresh} onClick={() => void send(true)}>
            {plural(fresh, { one: "Add # player", other: "Add # players" })}
          </Button>
        </>
      ) : (
        <Button block disabled={busy || !text.trim()} onClick={() => void send(false)}>
          <Trans>Preview</Trans>
        </Button>
      )}
    </div>
  );
}
