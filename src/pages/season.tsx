import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useEffect, useState } from "preact/hooks";
import type { PersonRef, TeamRef } from "../../shared/types";
import { api } from "../api";
import { fullDate, personName, todayLocal } from "../format";
import { downloadExport } from "../export";
import { Icon } from "../icons";
import { useMe, useSession } from "../session";
import { clearCache, useQuery } from "../store";
import { Button, confirmDialog, ErrorBox, Notice, Sheet, Spinner, TextField, toast, TopBar, useDocumentTitle } from "../ui";

interface Season {
  id: number;
  name: string;
  startsOn: string;
  endsOn: string;
  isCurrent: boolean;
}

type Category = "auto" | "choose" | "no_team" | "outgrown" | "missing_birth_year" | "adult" | "ambiguous";

interface PreviewPlayer {
  person: PersonRef;
  birthYear: number | null;
  currentTeams: TeamRef[];
  newAgeClass: { code: string; name: string } | null;
  category: Category;
  options: TeamRef[];
  suggestedTeamIds: number[];
}

interface Preview {
  current: { id: number; name: string } | null;
  next: { id: number; name: string; startsOn: string; endsOn: string };
  ageClassesDefined: boolean;
  players: PreviewPlayer[];
  formerPersons: PersonRef[];
  coaches: { person: PersonRef; team: string }[];
  /** School holidays (BW) of the new season, they replace all holiday periods at the change */
  holidays: { name: string; startsOn: string; endsOn: string }[];
  holidaysError: string | null;
  holidaySource: string;
}

const categories = (): Record<Category, { title: string; text: string }> => ({
  outgrown: { title: t`No longer youth`, text: t`Outgrown the A youth. Assign to the adults or mark as former.` },
  ambiguous: { title: t`Please decide`, text: t`From a mixed team. Please choose the right team.` },
  choose: {
    title: t`Several teams`,
    text: t`There are several teams in the new age class. Suggestion: 1st team. A 2nd team will be formed again after the change if needed.`,
  },
  no_team: { title: t`No matching team`, text: t`There is no team for the new age class. Please assign or leave without a team for now.` },
  missing_birth_year: { title: t`Birth year missing`, text: t`No automatic assignment without year of birth. Suggestion: previous team.` },
  adult: { title: t`Adults`, text: t`Stay in their team unless something else is chosen.` },
  auto: { title: t`Assigned automatically`, text: t`Unambiguous by year of birth.` },
});

const stepLabel = (step: number) => t`Step ${step}`;

const ORDER: Category[] = ["outgrown", "ambiguous", "choose", "no_team", "missing_birth_year", "adult", "auto"];

type Choice = { teamIds: number[]; former: boolean };

export function SeasonChangePage() {
  useDocumentTitle(t`Season change`);
  const me = useMe();
  const { refresh } = useSession();
  const seasons = useQuery<{ seasons: Season[] }>("/seasons");
  const current = seasons.data?.seasons.find((s) => s.isCurrent) ?? null;
  const upcoming = seasons.data?.seasons.find((s) => !s.isCurrent && (!current || s.startsOn > current.startsOn)) ?? null;
  const upcomingName = upcoming?.name ?? "";
  const preview = useQuery<Preview>(upcoming ? `/season-change/preview?seasonId=${upcoming.id}` : null);
  const nextName = preview.data?.next.name ?? "";
  const [choices, setChoices] = useState<Record<number, Choice>>({});
  const [exported, setExported] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [finalOpen, setFinalOpen] = useState(false);
  const [done, setDone] = useState<{ assigned: number; deletedPersons: number; deletedParents: number } | null>(null);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!preview.data) return;
    const next: Record<number, Choice> = {};
    for (const p of preview.data.players) next[p.person.id] = { teamIds: p.suggestedTeamIds, former: false };
    setChoices(next);
  }, [preview.data]);

  if (!me.isAdmin)
    return (
      <Notice kind="warn">
        <Trans>Admins only.</Trans>
      </Notice>
    );

  if (done) {
    const { assigned, deletedPersons, deletedParents } = done;
    return (
      <main class="page">
        <TopBar title={t`Season change`} kicker={t`Completed`} back="/verwaltung" />
        <div class="content">
          <div class="card card-pad stack">
            <h2 style={{ fontSize: "26px" }}>
              <Trans>New season started</Trans>
            </h2>
            <p>
              <Trans>
                {assigned} players assigned, {deletedPersons} former persons and {deletedParents} parent accesses without a child deleted.
              </Trans>
            </p>
          </div>
          <Notice kind="yellow">
            <Trans>
              <strong>Next steps:</strong> Under teams, assign the coaches again; then the coaches create their training plans and link their team's new
              handball4all link.
            </Trans>
          </Notice>
          <a class="btn btn-primary" href="/verwaltung/mannschaften">
            <Trans>Assign coaches</Trans>
          </a>
        </div>
      </main>
    );
  }

  const cats = categories();
  const coachList = preview.data?.coaches.map((c) => `${personName(c.person)} (${c.team})`).join(", ") ?? "";
  const formerList = preview.data?.formerPersons.map((p) => personName(p)).join(", ") ?? "";
  const holidaySource = preview.data?.holidaySource ?? "";
  const today = todayLocal();
  return (
    <main class="page">
      <TopBar title={t`Season change`} kicker={t`Administration`} back="/verwaltung" />
      <div class="content">
        <Notice kind="warn">
          <Trans>
            The season change resets team memberships, training plans, events, responses, nominations, core squads and chat histories. Persons, accesses,
            parent links, teams and training locations remain.
          </Trans>
        </Notice>
        {seasons.error ? <ErrorBox error={seasons.error} /> : null}
        {!seasons.data ? <Spinner /> : null}

        <section class="card card-body" aria-label={stepLabel(1)}>
          <h2 class="section-title" style={{ margin: 0 }}>
            <Trans>1 · New season</Trans>
          </h2>
          <p>{currentSeasonLabel(current)}</p>
          {upcoming && editing ? (
            <NewSeasonForm
              current={current}
              season={upcoming}
              onCreated={async () => {
                setEditing(false);
                await seasons.reload();
                await preview.reload();
              }}
              onCancel={() => setEditing(false)}
            />
          ) : upcoming ? (
            <>
              <UpcomingSeason season={upcoming} />
              <div class="btn-row">
                <Button icon="edit" onClick={() => setEditing(true)}>
                  <Trans context="verb">Correct</Trans>
                </Button>
                <Button
                  variant="danger"
                  icon="trash"
                  onClick={async () => {
                    const ok = await confirmDialog({
                      title: t`Discard season change?`,
                      message: t`The upcoming season ${upcomingName} and its age classes will be deleted. Nothing changes in the current season, teams, persons and events.`,
                      confirmLabel: t`Discard`,
                      danger: true,
                    });
                    if (!ok) return;
                    await api.del(`/seasons/${upcoming.id}`);
                    toast(t`Season change discarded.`);
                    await seasons.reload();
                  }}
                >
                  <Trans>Discard</Trans>
                </Button>
              </div>
            </>
          ) : seasons.data ? (
            <NewSeasonForm key={current?.id ?? 0} current={current} onCreated={() => seasons.reload()} />
          ) : null}
        </section>

        {upcoming ? (
          <section class="card card-body" aria-label={stepLabel(2)}>
            <h2 class="section-title" style={{ margin: 0 }}>
              <Trans>2 · Age classes {upcomingName}</Trans>
            </h2>
            <p class="muted">
              <Trans>Taken over from the previous season and shifted by one year. Please check against the association's implementing regulations.</Trans>
            </p>
            <a class="btn" href={`/verwaltung/altersklassen?season=${upcoming.id}`}>
              <Trans>Check age classes</Trans>
            </a>
          </section>
        ) : null}

        {upcoming && preview.error ? <ErrorBox error={preview.error} onRetry={preview.reload} /> : null}
        {upcoming && preview.loading ? <Spinner /> : null}
        {preview.data ? (
          <section class="stack" aria-label={stepLabel(3)}>
            <h2 class="section-title">
              <Trans>3 · Check assignment</Trans>
            </h2>
            {!preview.data.ageClassesDefined ? (
              <Notice kind="warn">
                <Trans>No age classes are defined for the new season.</Trans>
              </Notice>
            ) : null}
            {ORDER.map((cat) => {
              const items = preview.data!.players.filter((p) => p.category === cat);
              if (!items.length) return null;
              return (
                <div class="card card-body">
                  <div>
                    <strong>
                      {cats[cat].title} · {items.length}
                    </strong>
                    <p class="small muted">{cats[cat].text}</p>
                  </div>
                  {items.map((p) => {
                    const choice = choices[p.person.id] ?? { teamIds: p.suggestedTeamIds, former: false };
                    const set = (c: Choice) => setChoices({ ...choices, [p.person.id]: c });
                    const allTeams = p.options;
                    const name = personName(p.person);
                    const year = p.birthYear;
                    const teams = p.currentTeams.map((team) => team.name).join(", ");
                    const yearLabel = year ? t`Born ${year}` : t`no year of birth`;
                    return (
                      <div class="stack-sm" style={{ borderTop: "1px solid var(--line)", paddingTop: "10px" }}>
                        <div class="row-gap" style={{ justifyContent: "space-between" }}>
                          <span>
                            <strong>{personName(p.person)}</strong>{" "}
                            <span class="small muted">
                              {yearLabel} · {t`previously ${teams}`}
                              {p.newAgeClass ? ` → ${p.newAgeClass.code}` : ""}
                            </span>
                          </span>
                        </div>
                        <select
                          class="select"
                          aria-label={t`New team for ${name}`}
                          value={choice.former ? "former" : (choice.teamIds[0] ?? "")}
                          onChange={(e) => {
                            const v = (e.target as HTMLSelectElement).value;
                            if (v === "former") set({ teamIds: [], former: true });
                            else set({ teamIds: v ? [Number(v), ...choice.teamIds.slice(1).filter((id) => id !== Number(v))] : [], former: false });
                          }}
                        >
                          <option value="">{t`Without a team`}</option>
                          {allTeams.map((team) => (
                            <option value={team.id}>{team.name}</option>
                          ))}
                          <option value="former">{t`Former (will be deleted)`}</option>
                        </select>
                        {/* Players in two teams (e.g. wC1 and wC2) */}
                        {!choice.former
                          ? choice.teamIds.slice(1).map((teamId, i) => (
                              <div class="row-gap">
                                <select
                                  class="select"
                                  style={{ flex: 1 }}
                                  aria-label={t`Additional team for ${name}`}
                                  value={teamId}
                                  onChange={(e) => {
                                    const v = Number((e.target as HTMLSelectElement).value);
                                    const ids = [...choice.teamIds];
                                    ids[i + 1] = v;
                                    set({ teamIds: [...new Set(ids)], former: false });
                                  }}
                                >
                                  {allTeams
                                    .filter((team) => team.id === teamId || !choice.teamIds.includes(team.id))
                                    .map((team) => (
                                      <option value={team.id}>{team.name}</option>
                                    ))}
                                </select>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  aria-label={t`Remove additional team`}
                                  onClick={() => set({ teamIds: choice.teamIds.filter((_, j) => j !== i + 1), former: false })}
                                >
                                  <Icon name="trash" size={18} />
                                </Button>
                              </div>
                            ))
                          : null}
                        {!choice.former && choice.teamIds.length > 0 && choice.teamIds.length < 3 && allTeams.some((team) => !choice.teamIds.includes(team.id)) ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            icon="plus"
                            onClick={() => set({ teamIds: [...choice.teamIds, allTeams.find((team) => !choice.teamIds.includes(team.id))!.id], former: false })}
                          >
                            <Trans>Additional team</Trans>
                          </Button>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              );
            })}
            {preview.data.coaches.length ? (
              <Notice>
                <Trans>Coach assignments are removed and must be set again afterwards: {coachList}.</Trans>
              </Notice>
            ) : null}
            {preview.data.formerPersons.length ? (
              <Notice kind="warn">
                <Trans>Already left and will be deleted: {formerList}.</Trans>
              </Notice>
            ) : null}
          </section>
        ) : null}

        {preview.data ? (
          <section class="card card-body" aria-label={t`Holidays of the new season`}>
            <h2 class="section-title" style={{ margin: 0 }}>
              <Trans>4 · Holidays of the new season</Trans>
            </h2>
            <p class="muted">
              <Trans>
                The school holidays of Baden-Württemberg replace all previous holiday periods at the change. Afterwards they can be changed, deleted or
                supplemented under Administration → Holidays (e.g. carnival holidays). Source: {holidaySource}.
              </Trans>
            </p>
            {preview.data.holidaysError ? <Notice kind="warn">{preview.data.holidaysError}</Notice> : null}
            {preview.data.holidays.length ? (
              <ul class="list">
                {preview.data.holidays.map((h) => (
                  <li class="list-row">
                    <Icon name="sun" size={20} />
                    <span class="main">
                      <span class="title">{h.name}</span>
                      <span class="sub">
                        {fullDate(h.startsOn)} – {fullDate(h.endsOn)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        ) : null}

        {preview.data ? (
          <section class="card card-body" aria-label={stepLabel(5)}>
            <h2 class="section-title" style={{ margin: 0 }}>
              <Trans>5 · Backup</Trans>
            </h2>
            <p class="muted">
              <Trans>
                Download a complete export before resetting. In addition, the database can be reset up to 30 days back via D1 Time Travel.
              </Trans>
            </p>
            <Button icon="download" onClick={async () => { if (await downloadExport()) setExported(true); }}>
              <Trans>Download export</Trans>
            </Button>
            {exported ? (
              <p class="small muted">
                <Trans>Export started ({today}). Please check that the file was saved.</Trans>
              </p>
            ) : null}
          </section>
        ) : null}

        {preview.data ? (
          <Button
            variant="danger-solid"
            size="lg"
            disabled={!exported}
            onClick={async () => {
              const formers = Object.values(choices).filter((c) => c.former).length;
              const reassigned = preview.data!.players.length - formers;
              const deleted = formers + preview.data!.formerPersons.length;
              const periods = preview.data!.holidays.length;
              const ok = await confirmDialog({
                title: t`Start season ${nextName}?`,
                message: periods
                  ? t`${reassigned} players will be reassigned, ${deleted} persons deleted. Events, plans, responses and chats will be reset, the holidays replaced by ${periods} new periods.`
                  : t`${reassigned} players will be reassigned, ${deleted} persons deleted. Events, plans, responses and chats will be reset, the holidays remain unchanged.`,
                confirmLabel: t`Continue`,
                danger: true,
              });
              if (ok) setFinalOpen(true);
            }}
          >
            <Trans>Carry out season change</Trans>
          </Button>
        ) : null}
        {preview.data && !exported ? (
          <p class="small muted">
            <Trans>Only possible after the export.</Trans>
          </p>
        ) : null}
      </div>

      {finalOpen && preview.data ? (
        <Sheet open onClose={() => setFinalOpen(false)} title={t`Final confirmation`}>
          <p>
            <Trans>
              To confirm, please enter <strong>{nextName}</strong>.
            </Trans>
          </p>
          <TextField label={t`New season`} value={confirmText} onInput={setConfirmText} />
          <Button
            variant="danger-solid"
            size="lg"
            block
            disabled={confirmText.trim() !== preview.data.next.name}
            onClick={async () => {
              const res = await api.post<{ assigned: number; deletedPersons: number; deletedParents: number }>("/season-change/execute", {
                seasonId: preview.data!.next.id,
                confirmName: confirmText.trim(),
                assignments: preview.data!.players.map((p) => ({ personId: p.person.id, ...(choices[p.person.id] ?? { teamIds: p.suggestedTeamIds, former: false }) })),
                holidays: preview.data!.holidays,
              });
              clearCache();
              await refresh();
              setFinalOpen(false);
              setDone(res);
              toast(t`Season change completed.`);
            }}
          >
            <Trans>Carry out permanently</Trans>
          </Button>
        </Sheet>
      ) : null}
    </main>
  );
}

function currentSeasonLabel(current: Season | null): string {
  if (!current) return t`Current season: none`;
  const name = current.name;
  const from = fullDate(current.startsOn);
  const to = fullDate(current.endsOn);
  return t`Current season: ${name} (${from} – ${to})`;
}

function UpcomingSeason({ season }: { season: Season }) {
  const name = season.name;
  const from = fullDate(season.startsOn);
  const to = fullDate(season.endsOn);
  return (
    <p>
      <Trans>
        Upcoming season: <strong>{name}</strong> ({from} – {to})
      </Trans>
    </p>
  );
}

/** Create the upcoming season or (with season) correct it. */
function NewSeasonForm({ current, season, onCreated, onCancel }: { current: Season | null; season?: Season; onCreated: () => void; onCancel?: () => void }) {
  const startYear = current ? Number(current.startsOn.slice(0, 4)) + 1 : Number(todayLocal().slice(0, 4));
  const [name, setName] = useState(season?.name ?? `${startYear}/${String(startYear + 1).slice(2)}`);
  const [from, setFrom] = useState(season?.startsOn ?? `${startYear}-07-01`);
  const [to, setTo] = useState(season?.endsOn ?? `${startYear + 1}-06-30`);
  return (
    <div class="stack">
      <TextField label={t`Name`} value={name} onInput={setName} hint={t`Format 2027/28`} />
      <div class="grid-2">
        <TextField label={t({ message: "Start", context: "date" })} type="date" value={from} onInput={setFrom} />
        <TextField label={t({ message: "End", context: "date" })} type="date" value={to} onInput={setTo} />
      </div>
      <div class="btn-row">
        <Button
          variant="primary"
          onClick={async () => {
            if (season) {
              await api.patch(`/seasons/${season.id}`, { name: name.trim(), startsOn: from, endsOn: to });
              toast(t`Saved.`);
            } else {
              await api.post("/seasons", { name: name.trim(), startsOn: from, endsOn: to });
              toast(t`Season created, age classes taken over.`);
            }
            onCreated();
          }}
        >
          {season ? t`Save` : t`Create upcoming season`}
        </Button>
        {onCancel ? (
          <Button onClick={onCancel}>
            <Trans>Cancel</Trans>
          </Button>
        ) : null}
      </div>
    </div>
  );
}
