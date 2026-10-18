// Game schedule from a table (CSV): paste or choose a file, check the preview, create the games.
import { plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useState } from "preact/hooks";
import { api, errorMessage } from "./api";
import { fullDate } from "./format";
import { invalidate } from "./store";
import { Button, Field, Notice, toast } from "./ui";

interface PreviewGame {
  line: number;
  date: string;
  time: string;
  opponent: string;
  isHome: boolean;
  venue: string | null;
  past: boolean;
  duplicate: boolean;
}

interface ImportResult {
  games: PreviewGame[];
  problems: { line: number; field: string; value: string }[];
  created: number;
}

export function GameImport({ teamId }: { teamId: number }) {
  const [csv, setCsv] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (commit: boolean) => {
    setError(null);
    try {
      const res = await api.post<ImportResult>(`/teams/${teamId}/game-import`, { csv, commit });
      if (commit) {
        const created = res.created;
        toast(plural(created, { one: "# game created.", other: "# games created." }));
        invalidate("/events", `/teams/${teamId}`);
        setCsv("");
        setResult(null);
      } else setResult(res);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const fresh = result?.games.filter((g) => !g.past && !g.duplicate).length ?? 0;
  return (
    <div class="stack-sm">
      <p class="small muted">
        <Trans>
          Without a connection to the association: paste a table (for example from a spreadsheet) with the columns date, time, opponent, home or away and
          venue, or choose a CSV file.
        </Trans>
      </p>
      <Field label={t`Game schedule as a table`}>
        {(id) => (
          <textarea
            id={id}
            class="textarea"
            rows={5}
            value={csv}
            placeholder={t`Date;Time;Opponent;Home;Venue`}
            onInput={(e) => {
              setCsv((e.target as HTMLTextAreaElement).value);
              setResult(null);
            }}
          />
        )}
      </Field>
      <div class="btn-row">
        <label class="btn btn-sm btn-dashed">
          <Trans>Choose file</Trans>
          <input
            type="file"
            accept=".csv,text/csv,text/plain"
            class="sr-only"
            onChange={async (e) => {
              const file = (e.target as HTMLInputElement).files?.[0];
              if (file) {
                setCsv(await file.text());
                setResult(null);
              }
            }}
          />
        </label>
        <Button size="sm" disabled={!csv.trim()} onClick={() => run(false)}>
          <Trans>Preview</Trans>
        </Button>
      </div>
      {error ? <Notice kind="warn">{error}</Notice> : null}
      {result ? (
        <div class="stack-sm">
          <ul class="list">
            {result.games.map((g) => {
              const opponent = g.opponent;
              return (
                <li class="list-row">
                  <span class="main">
                    <span class="title">{g.isHome ? t`Home game vs ${opponent}` : t`Away game at ${opponent}`}</span>
                    <span class="sub">
                      {fullDate(g.date)} · {g.time}
                      {g.venue ? ` · ${g.venue}` : ""}
                    </span>
                  </span>
                  {g.past ? <span class="badge">{t`past`}</span> : g.duplicate ? <span class="badge">{t`already there`}</span> : null}
                </li>
              );
            })}
          </ul>
          {result.problems.length ? (
            <Notice kind="warn">
              {result.problems
                .map((p) => {
                  const line = p.line;
                  return t`Line ${line} skipped`;
                })
                .join(" · ")}
            </Notice>
          ) : null}
          <Button variant="primary" block disabled={!fresh} onClick={() => run(true)}>
            {plural(fresh, { one: "Create # game", other: "Create # games" })}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
