// Statistics of the helper plan: helper duties per family on the team's statistics page (coaches) and the family's
// duties on "My statistics" (players, parents). Hooks teamStats and myStats in src/module-api.ts.
import { plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useState } from "preact/hooks";
import type { StatsRange } from "../../../shared/types";
import { api, errorMessage } from "../../../src/api";
import { joinNames, shortDate, shortName } from "../../../src/format";
import { rangeNote, Tiles } from "../../../src/pages/stats";
import { useQuery } from "../../../src/store";
import { Button, confirmDialog, ErrorBox, InfoButton, Spinner, SwitchRow, toast } from "../../../src/ui";
import type { HelperFamily, MyHelperStats, TeamHelperStats } from "../types";
import { statsHelpersHelp } from "./help";

const familyTitle = (f: HelperFamily) => joinNames(f.children.map(shortName));

function familyWho(f: HelperFamily): string {
  if (!f.guardians.length) return "";
  const names = joinNames(f.guardians.map(shortName));
  return f.guardians.some((g) => g.hasAccount) ? t`with ${names}` : t`with ${names} · without the app`;
}

const MEDALS = ["🥇", "🥈", "🥉"];

/** Statistics → Helpers: duties per family, medals for the top 3, reminder to the families without a duty. */
export function HelperStatsView({ teamId, range }: { teamId: number; range: StatsRange }) {
  const { data: h, error, loading, reload } = useQuery<TeamHelperStats>(`/duties/teams/${teamId}/stats?range=${range}`);
  const season = useQuery<{ from: string; dataSince: string | null; range: StatsRange }>(`/teams/${teamId}/stats?range=${range}`);
  const [withHelpers, setWithHelpers] = useState(false);
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!h) return loading ? <Spinner /> : null;
  const families = h.families.filter((f) => withHelpers || !f.helper);
  const hidden = h.families.filter((f) => !withHelpers && f.helper).reduce((s, f) => s + f.done + f.planned, 0);
  const total = (f: HelperFamily) => f.done + f.planned;
  const active = families.filter((f) => total(f) > 0).sort((a, b) => total(b) - total(a) || familyTitle(a).localeCompare(familyTitle(b)));
  const without = families.filter((f) => total(f) === 0);
  const rank = (f: HelperFamily) => 1 + active.filter((o) => total(o) > total(f)).length;
  const others = h.others + hidden;
  const helped = active.length;
  const all = families.length;
  const done = h.done;
  const planned = h.planned;

  const remind = async () => {
    const n = without.length;
    const ok = await confirmDialog({
      title: t`Remind families?`,
      message: (
        <>
          <p>{plural(n, { one: "One family without a duty gets a notification:", other: "# families without a duty get a notification:" })}</p>
          <p class="small">
            „
            <Trans>
              {helped} of {all} families have helped already. If the others can do it, so can you! Give yourselves a nudge and sign up for a duty.
            </Trans>
            “
          </p>
          <p class="small muted">
            <Trans>Without names, with a link to the helper plan. Possible once a day.</Trans>
          </p>
        </>
      ),
      confirmLabel: t`Remind`,
    });
    if (!ok) return;
    try {
      const res = await api.post<{ message: string }>(`/duties/teams/${teamId}/stats/remind`, { range, includeHelpers: withHelpers });
      toast(res.message);
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      void reload();
    }
  };

  return (
    <>
      <section class="card card-body stack-sm" aria-label={t`Helpers`}>
        <h2 class="section-title" style={{ margin: 0 }}>
          <Trans>Helpers</Trans> <InfoButton topic={statsHelpersHelp()} />
        </h2>
        <Tiles
          items={[
            { n: h.done + h.planned, l: t`Duties` },
            { n: `${active.length}/${families.length}`, l: t`Families involved` },
            { n: h.openSlots, l: t`Places open` },
          ]}
        />
        <p class="small muted" style={{ margin: 0 }}>
          {t`${done} done, ${planned} signed up for upcoming events`}
          {season.data ? ` · ${rangeNote(season.data)}` : ""}
        </p>
        <SwitchRow label={t`Include stand-ins`} sub={t`Families of stand-ins from other teams`} checked={withHelpers} onChange={setWithHelpers} />
      </section>

      {active.length ? (
        <ul class="list" aria-label={t`Families with duties`}>
          {active.map((f) => {
            const place = rank(f);
            const plannedCount = f.planned;
            return (
              <li class="list-row">
                <span class="main">
                  <span class="title">
                    {place <= 3 ? <span aria-label={t`Place ${place}`}>{MEDALS[place - 1]} </span> : null}
                    {familyTitle(f)}
                    {f.helper ? (
                      <span class="badge">
                        {" "}
                        <Trans>Stand-in</Trans>
                      </span>
                    ) : null}
                  </span>
                  {familyWho(f) ? <span class="sub">{familyWho(f)}</span> : null}
                </span>
                <span class="stat-pct">
                  {total(f)}
                  <small>{f.planned ? t`${plannedCount} planned` : t`all done`}</small>
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p class="small muted">
          <Trans>No family has taken a duty in this time span yet.</Trans>
        </p>
      )}

      {without.length ? (
        <section class="stack-sm" aria-label={t`No duty yet`}>
          <h2 class="section-title" style={{ margin: 0 }}>
            <Trans>No duty yet</Trans>
          </h2>
          <ul class="list">
            {without.map((f) => (
              <li class="list-row">
                <span class="main">
                  <span class="title">
                    {familyTitle(f)}
                    {f.helper ? (
                      <span class="badge">
                        {" "}
                        <Trans>Stand-in</Trans>
                      </span>
                    ) : null}
                  </span>
                  <span class="sub">{familyWho(f) || t`No parents linked`}</span>
                </span>
              </li>
            ))}
          </ul>
          <Button variant="coach" block disabled={h.remindedToday || h.openSlots === 0} onClick={remind}>
            {h.remindedToday ? t`Already reminded today` : t`Remind these families`}
          </Button>
          <p class="small muted" style={{ margin: 0 }}>
            {h.openSlots === 0
              ? t`No places are free at the moment. Reminding works again once duties are open.`
              : t`Sends a notification with an incentive and a link to the helper plan, without the names of the others.`}
          </p>
        </section>
      ) : null}

      {others ? (
        <p class="small muted" style={{ margin: 0 }}>
          {hidden
            ? plural(others, {
                one: "Also # duty of coaches, club members, stand-ins and helpers entered by hand.",
                other: "Also # duties of coaches, club members, stand-ins and helpers entered by hand.",
              })
            : plural(others, {
                one: "Also # duty of coaches, club members and helpers entered by hand.",
                other: "Also # duties of coaches, club members and helpers entered by hand.",
              })}
        </p>
      ) : null}
    </>
  );
}

/** My statistics: the family's helper duties this season in a team with a helper plan. */
export function MyHelperCard({ personId, teamId }: { personId: number; self: boolean; teamId: number }) {
  const { data } = useQuery<MyHelperStats>("/duties/stats/me");
  const h = data?.persons.find((p) => p.personId === personId)?.teams.find((tm) => tm.teamId === teamId);
  if (!h) return null;
  const next = h.next;
  return (
    <section class="card card-body" aria-label={t`Helper duties`}>
      <h2 class="section-title" style={{ margin: "0 0 6px" }}>
        <Trans>Helper duties of your family</Trans>
      </h2>
      <div class="kv">
        <span>
          <Trans>Done this season</Trans>
        </span>
        <b>{h.done}</b>
      </div>
      <div class="kv">
        <span>
          <Trans>Signed up</Trans>
        </span>
        <b>{h.planned}</b>
      </div>
      {next ? (
        <p class="small muted" style={{ margin: "8px 0 0" }}>
          {(() => {
            const date = shortDate(next.startsAt);
            const label = next.label;
            const name = next.name;
            return t`Next: ${date} · ${label} (${name})`;
          })()}
        </p>
      ) : null}
      <a class="btn btn-block" style={{ marginTop: "10px" }} href={`/helfer?mannschaft=${teamId}`}>
        <Trans>To the helper plan</Trans>
      </a>
    </section>
  );
}
