// Picking players from other teams (add a player, permanent stand-in, stand-in for a game):
// filter by team, core squad players of their own team marked and listed first.
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { intlTag } from "../shared/dates";
import type { PersonRef } from "../shared/types";
import { personName } from "./format";
import { currentLocale } from "./i18n";

export interface CandidateTeam {
  id: number;
  name: string;
  /** In the core squad of this team */
  core: boolean;
}

interface Candidate {
  person: PersonRef;
  teams: CandidateTeam[];
}

/** Teams the suggestions come from, sorted by name (wC3 before wD1). */
export function candidateTeams(candidates: Candidate[]): string[] {
  const collator = new Intl.Collator(intlTag(currentLocale()), { numeric: true });
  return [...new Set(candidates.flatMap((c) => c.teams.map((x) => x.name)))].sort(collator.compare);
}

export function CandidateList<C extends Candidate>(props: { candidates: C[]; action: (c: C) => ComponentChildren; note?: (c: C) => ComponentChildren }) {
  const [filter, setFilter] = useState<string | null>(null);
  const teams = candidateTeams(props.candidates);
  const collator = new Intl.Collator(intlTag(currentLocale()));
  const shown = props.candidates
    .filter((c) => !filter || c.teams.some((x) => x.name === filter))
    .map((c) => ({ c, core: c.teams.some((x) => x.core && (!filter || x.name === filter)) }))
    // Core squad players first, then by name
    .sort((a, b) => Number(b.core) - Number(a.core) || collator.compare(personName(a.c.person), personName(b.c.person)));
  return (
    <div class="stack-sm">
      {teams.length > 1 ? (
        <div class="chips" role="group" aria-label={t`Filter by team`}>
          {[null, ...teams].map((name) => (
            <button type="button" class={`chip ${filter === name ? "selected" : ""}`} aria-pressed={filter === name ? "true" : "false"} onClick={() => setFilter(name)}>
              {name ?? t`All`}
            </button>
          ))}
        </div>
      ) : null}
      <ul class="list" aria-label={t`Suggestions`}>
        {shown.map(({ c, core }) => (
          <li class="list-row">
            <span class="main">
              <span class="title">
                {personName(c.person)}
                {core ? (
                  <span class="badge outline" style={{ marginLeft: "6px" }}>
                    <Trans>Core squad</Trans>
                  </span>
                ) : null}
              </span>
              <span class="sub">
                {c.teams
                  .map((x) => {
                    const name = x.name;
                    return x.core ? t`${name} (core squad)` : name;
                  })
                  .join(" · ")}
              </span>
              {props.note?.(c)}
            </span>
            {props.action(c)}
          </li>
        ))}
      </ul>
    </div>
  );
}
