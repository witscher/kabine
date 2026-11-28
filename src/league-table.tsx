// League table of a game's team as of its last sync (docs/dev/connectors.md, worker/domain/league-table.ts), on the
// game page and the fan game page: collapsed with the own position and points, expanded the whole table. Nothing is
// fetched for it; the sync stores it from the schedule it fetches anyway.
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import type { LeagueTable, LeagueTableRow } from "../shared/types";
import { stamp } from "./format";
import { Icon } from "./icons";

const points = (r: LeagueTableRow) => (r.pointsMinus == null ? String(r.pointsPlus) : `${r.pointsPlus}:${r.pointsMinus}`);

export function LeagueTableCard({ table }: { table: LeagueTable }) {
  const own = table.rows.find((r) => r.own) ?? null;
  const pos = own?.pos ?? 0;
  const count = table.rows.length;
  const pts = own ? points(own) : "";
  const when = stamp(table.fetchedAt);
  const source = table.source;
  return (
    <details class="card howto-fold league-table">
      <summary>
        <span class="league-summary">
          <span>
            <Trans>Table</Trans>
          </span>
          <span class="small muted">{own && pos ? t`Place ${pos} of ${count} · ${pts} points` : (table.leagueName ?? t`League`)}</span>
        </span>
        <Icon name="chevron" size={18} />
      </summary>
      <div class="card-body">
        <table>
          <thead>
            <tr>
              <th aria-label={t`Position`}>{t({ message: "Pos.", context: "league table" })}</th>
              <th class="team">{t({ message: "Team", context: "league table" })}</th>
              <th aria-label={t`Games`}>{t({ message: "Gms.", context: "league table" })}</th>
              <th aria-label={t`Goal difference`}>{t({ message: "Diff.", context: "league table" })}</th>
              <th aria-label={t`Points`}>{t({ message: "Pts.", context: "league table" })}</th>
            </tr>
          </thead>
          <tbody>
            {table.rows.map((r) => {
              const diff = r.goalsFor - r.goalsAgainst;
              return (
                <tr class={r.own ? "own" : undefined}>
                  <td>{r.pos ?? ""}</td>
                  <td class="team">{r.team}</td>
                  <td>{r.games}</td>
                  <td>{diff > 0 ? `+${diff}` : diff}</td>
                  <td>{points(r)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p class="small muted">
          {table.leagueName ? `${table.leagueName} · ` : ""}
          {t`As of ${when} (${source})`}
          {table.comment ? `. ${table.comment}` : ""}
        </p>
      </div>
    </details>
  );
}
