import { plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useLocation } from "preact-iso";
import { useEffect, useState } from "preact/hooks";
import type { TeamRef } from "../../shared/types";
import { api } from "../api";
import { fullDate, todayLocal, weekdayShortIso } from "../format";
import { Icon } from "../icons";
import { invalidate, useQuery } from "../store";
import { Button, confirmDialog, ErrorBox, Field, Notice, Segmented, Sheet, Spinner, TextField, toast, TopBar, useDocumentTitle } from "../ui";
import { useLocations } from "./event";

interface RuleView {
  id: number;
  weekday: number;
  startsAt: string;
  endsAt: string;
  location: { id: number; name: string };
  teams: TeamRef[];
}

interface PlanView {
  id: number;
  name: string;
  kind: "regular" | "holiday";
  validFrom: string;
  validTo: string;
  declineHours: number | null;
  /** Holiday plan follows this holiday period */
  holidayPeriodId: number | null;
  isCurrent: boolean;
  rules: RuleView[];
}

interface HolidayPeriod {
  id: number;
  name: string;
  startsOn: string;
  endsOn: string;
}

interface PlansResponse {
  plans: PlanView[];
  sharedRules: (RuleView & { planName: string; ownerTeam: string; validFrom: string; validTo: string })[];
  holidays: HolidayPeriod[];
  allTeams: TeamRef[];
}

function RuleCard({ rule, ownTeamId, onEdit, onDelete }: { rule: RuleView; ownTeamId: number; onEdit?: () => void; onDelete?: () => void }) {
  return (
    <div class="rule-card">
      <div class="rule-day" aria-label={weekdayShortIso(rule.weekday)}>
        {weekdayShortIso(rule.weekday).toUpperCase()}
      </div>
      <div class="rule-main">
        <div class="rule-time">
          {rule.startsAt} – {rule.endsAt}
        </div>
        <div class="meta-line" style={{ fontSize: "14px" }}>
          <span>
            <Icon name="pin" size={15} />
            {rule.location.name}
          </span>
        </div>
        <div class="row-gap" style={{ gap: "6px", marginTop: "4px" }}>
          {rule.teams.map((t) => (
            <span class={`badge team ${t.id === ownTeamId ? "" : "other"}`}>{t.name}</span>
          ))}
          {rule.teams.length > 1 ? (
            <span class="small muted">
              <Trans>joint training</Trans>
            </span>
          ) : null}
        </div>
      </div>
      {onEdit ? (
        <button type="button" class="icon-btn" aria-label={t`Edit training time`} onClick={onEdit} style={{ width: "48px", height: "auto" }}>
          <Icon name="edit" size={20} />
        </button>
      ) : null}
      {onDelete ? (
        <button type="button" class="icon-btn" aria-label={t`Remove training time`} onClick={onDelete} style={{ width: "44px", height: "auto" }}>
          <Icon name="trash" size={18} />
        </button>
      ) : null}
    </div>
  );
}

export function PlansPage({ id }: { id: string }) {
  useDocumentTitle(t`Training plans`);
  const { route } = useLocation();
  const { data, error, loading, reload } = useQuery<PlansResponse>(`/teams/${id}/plans`);
  const today = todayLocal();
  const plans = data?.plans ?? [];
  const regular = plans.filter((p) => p.kind === "regular");
  const holiday = plans.filter((p) => p.kind === "holiday" && p.validTo >= today);
  // All upcoming holidays under Administration → Holidays that have no holiday plan yet
  const upcomingHolidays = (data?.holidays ?? []).filter(
    (h) => h.endsOn >= today && !plans.some((p) => p.kind === "holiday" && (p.holidayPeriodId === h.id || (p.validFrom <= h.startsOn && h.endsOn <= p.validTo))),
  );

  return (
    <main class="page">
      <TopBar title={t`Training plans`} kicker={t`Team`} back={`/team/${id}`} />
      <div class="content">
        {error ? <ErrorBox error={error} onRetry={reload} /> : null}
        {loading ? <Spinner /> : null}
        <Button variant="primary" size="lg" icon="plus" onClick={() => route(`/team/${id}/plaene/neu`)}>
          <Trans>Create training plan</Trans>
        </Button>

        {regular.map((p) => {
          const from = fullDate(p.validFrom);
          const to = fullDate(p.validTo);
          return (
          <section class="stack-sm" aria-label={p.name}>
            <div class="row-gap" style={{ justifyContent: "space-between" }}>
              <div>
                <h2 class="section-title">{p.name}</h2>
                <div class="small muted" style={{ marginLeft: "2px" }}>
                  {p.isCurrent ? t`${from} to ${to} · current` : t`${from} to ${to}`}
                </div>
              </div>
              <a class="btn btn-sm" href={`/team/${id}/plaene/${p.id}`}>
                <Trans>Edit</Trans>
              </a>
            </div>
            {p.rules.map((r) => (
              <RuleCard rule={r} ownTeamId={Number(id)} />
            ))}
            {!p.rules.length ? (
              <p class="small muted">
                <Trans>No training times yet.</Trans>
              </p>
            ) : null}
          </section>
          );
        })}

        {data?.sharedRules.length ? (
          <section class="stack-sm" aria-label={t`Joint trainings from other plans`}>
            <h2 class="section-title">
              <Trans>Together with others</Trans>
            </h2>
            {data.sharedRules.map((r) => {
              const planName = r.planName;
              const ownerTeam = r.ownerTeam;
              return (
              <div class="stack-sm">
                <RuleCard rule={r} ownTeamId={Number(id)} />
                <p class="small muted">
                  <Trans>From the plan “{planName}” of the {ownerTeam}.</Trans>
                </p>
              </div>
              );
            })}
          </section>
        ) : null}

        <section class="stack-sm" aria-label={t`Holidays`}>
          <h2 class="section-title">
            <Trans>Holidays</Trans>
          </h2>
          {holiday.map((p) => {
            const from = fullDate(p.validFrom);
            const to = fullDate(p.validTo);
            const count = p.rules.length;
            return (
            <a class="list-row card" href={`/team/${id}/plaene/${p.id}`}>
              <Icon name="sun" size={22} />
              <span class="main">
                <span class="title">{p.name}</span>
                <span class="sub">
                  {t`${from} to ${to}`} · {count ? plural(count, { one: "# training time", other: "# training times" }) : t`Training break`}
                </span>
              </span>
              <Icon name="chevron" size={18} />
            </a>
            );
          })}
          {upcomingHolidays.map((h) => {
            const from = fullDate(h.startsOn);
            const to = fullDate(h.endsOn);
            const holiday = h.name;
            return (
            <div class="card card-pad stack-sm">
              <div>
                <strong>{h.name}</strong>
                <div class="small muted">
                  <Trans>
                    {from} to {to}: no holiday plan yet, the regular plan continues.
                  </Trans>
                </div>
              </div>
              <div class="btn-row">
                <Button
                  size="sm"
                  onClick={async () => {
                    await api.post(`/teams/${id}/plans`, { name: t`Break ${holiday}`, kind: "holiday", validFrom: h.startsOn, validTo: h.endsOn, holidayPeriodId: h.id, rules: [] });
                    invalidate("/events", `/teams/${id}/plans`);
                    toast(t`There is no training during the ${holiday}.`);
                    await reload();
                  }}
                >
                  <Trans>Training break</Trans>
                </Button>
                <Button size="sm" onClick={() => route(`/team/${id}/plaene/neu?kind=holiday&holiday=${h.id}&from=${h.startsOn}&to=${h.endsOn}&name=${encodeURIComponent(t`Holiday plan ${holiday}`)}`)}>
                  <Trans>Holiday plan</Trans>
                </Button>
              </div>
            </div>
            );
          })}
          {!holiday.length && !upcomingHolidays.length ? (
            <p class="small muted">
              <Trans>No upcoming holidays entered.</Trans>
            </p>
          ) : null}
          <p class="small muted">
            <Trans>A holiday plan only applies in its period and takes precedence over the regular plan there.</Trans>
          </p>
        </section>
      </div>
    </main>
  );
}

/** Preview of the generated events, with a note on holidays that have no holiday plan yet. */
function previewText(preview: { occurrences: number; weeks: number; uncoveredHolidays: { name: string; startsOn: string; endsOn: string }[] }): string {
  const { occurrences, weeks } = preview;
  const head = t`${occurrences} events will be created for the next ${weeks} weeks.`;
  if (!preview.uncoveredHolidays.length) return head;
  const list = preview.uncoveredHolidays
    .map((h) => {
      const holiday = h.name;
      const from = fullDate(h.startsOn).slice(0, 6);
      const to = fullDate(h.endsOn).slice(0, 6);
      return t`During the ${holiday} (${from} to ${to})`;
    })
    .join(", ");
  return `${head} ${t`${list} there is no holiday plan yet.`}`;
}

interface DraftRule {
  id?: number;
  weekday: number;
  startsAt: string;
  endsAt: string;
  locationId: number;
  teamIds: number[];
}

function RuleEditor(props: { initial: DraftRule | null; ownTeamId: number; allTeams: TeamRef[]; onSave: (r: DraftRule) => Promise<void>; onCancel?: () => void; title: string }) {
  const { data: locs, reload: reloadLocs } = useLocations();
  const locations = locs?.locations ?? [];
  const [weekday, setWeekday] = useState(props.initial?.weekday ?? 3);
  const [start, setStart] = useState(props.initial?.startsAt ?? "17:00");
  const [end, setEnd] = useState(props.initial?.endsAt ?? "18:30");
  const [locationId, setLocationId] = useState<number | null>(props.initial?.locationId ?? null);
  const [teams, setTeams] = useState<number[]>(props.initial?.teamIds.filter((t) => t !== props.ownTeamId) ?? []);
  const [newLoc, setNewLoc] = useState(false);
  const [teamPicker, setTeamPicker] = useState(false);

  useEffect(() => {
    if (locationId == null && locations[0]) setLocationId(locations[0].id);
  }, [locations.length]);

  return (
    <div class="card outline card-pad stack" style={{ borderRadius: "14px" }}>
      <div class="kicker" style={{ color: "var(--black)", fontSize: "16px", letterSpacing: "0.05em" }}>
        {props.title}
      </div>
      <div class="weekdays" role="group" aria-label={t`Weekday`}>
        {[1, 2, 3, 4, 5, 6, 7].map((d) => (
          <button type="button" aria-pressed={weekday === d ? "true" : "false"} onClick={() => setWeekday(d)}>
            {weekdayShortIso(d)}
          </button>
        ))}
      </div>
      <div class="grid-2">
        <Field label={t`Start`}>{(fid) => <input id={fid} class="input" type="time" value={start} onInput={(e) => setStart((e.target as HTMLInputElement).value)} />}</Field>
        <Field label={t({ message: "End", context: "time" })}>{(fid) => <input id={fid} class="input" type="time" value={end} onInput={(e) => setEnd((e.target as HTMLInputElement).value)} />}</Field>
      </div>
      <Field label={t`Location`}>
        {(fid) => (
          <select
            id={fid}
            class="select"
            value={locationId ?? ""}
            onChange={(e) => {
              const v = (e.target as HTMLSelectElement).value;
              if (v === "new") setNewLoc(true);
              else setLocationId(Number(v));
            }}
          >
            {locations.map((l) => (
              <option value={l.id}>{l.name}</option>
            ))}
            <option value="new">{t`+ Create new location`}</option>
          </select>
        )}
      </Field>
      <div class="stack-sm">
        <span class="field-label">
          <Trans>Teams</Trans>
        </span>
        <div class="row-gap" style={{ gap: "6px" }}>
          <span class="badge team">{props.allTeams.find((x) => x.id === props.ownTeamId)?.name}</span>
          {teams.map((tid) => {
            const teamName = props.allTeams.find((x) => x.id === tid)?.name ?? "";
            return (
              <button type="button" class="badge team other" style={{ border: 0, minHeight: "32px" }} onClick={() => setTeams(teams.filter((x) => x !== tid))} aria-label={t`Remove ${teamName}`}>
                {props.allTeams.find((x) => x.id === tid)?.name} ✕
              </button>
            );
          })}
          <button type="button" class="btn btn-sm btn-dashed" onClick={() => setTeamPicker(true)}>
            <Trans>+ together with …</Trans>
          </button>
        </div>
      </div>
      <div class="btn-row">
        {props.onCancel ? (
          <Button onClick={props.onCancel}>
            <Trans>Cancel</Trans>
          </Button>
        ) : null}
        <Button
          variant="primary"
          onClick={async () => {
            if (!locationId) {
              toast(t`Please choose a location.`, "error");
              return;
            }
            if (start >= end) {
              toast(t`The end must be after the start.`, "error");
              return;
            }
            await props.onSave({ id: props.initial?.id, weekday, startsAt: start, endsAt: end, locationId, teamIds: teams });
          }}
        >
          {props.initial?.id ? t`Save` : t`Add`}
        </Button>
      </div>
      {newLoc ? (
        <NewLocationSheet
          onClose={() => setNewLoc(false)}
          onCreated={async (newId) => {
            await reloadLocs();
            setLocationId(newId);
            setNewLoc(false);
          }}
        />
      ) : null}
      {teamPicker ? (
        <Sheet open onClose={() => setTeamPicker(false)} title={t`Together with`}>
          <p class="muted">
            <Trans>A joint training time creates an event that appears for all teams. All coaches involved may edit it.</Trans>
          </p>
          <div class="chips">
            {props.allTeams
              .filter((team) => team.id !== props.ownTeamId)
              .map((team) => (
                <button
                  type="button"
                  class={`chip ${teams.includes(team.id) ? "selected" : ""}`}
                  aria-pressed={teams.includes(team.id) ? "true" : "false"}
                  onClick={() => setTeams(teams.includes(team.id) ? teams.filter((x) => x !== team.id) : [...teams, team.id])}
                >
                  {team.name}
                </button>
              ))}
          </div>
          <Button variant="primary" onClick={() => setTeamPicker(false)}>
            <Trans>Done</Trans>
          </Button>
        </Sheet>
      ) : null}
    </div>
  );
}

export function NewLocationSheet({ onClose, onCreated }: { onClose: () => void; onCreated: (id: number) => void }) {
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  return (
    <Sheet open onClose={onClose} title={t`New training location`}>
      <p class="muted">
        <Trans>For example a school gym or a sports ground. The location is then available to all coaches.</Trans>
      </p>
      <TextField label={t`Name`} value={name} onInput={setName} maxLength={80} />
      <TextField label={t`Address (optional)`} value={address} onInput={setAddress} maxLength={200} />
      <Button
        variant="primary"
        size="lg"
        block
        disabled={!name.trim()}
        onClick={async () => {
          const res = await api.post<{ id: number }>("/locations", { name: name.trim(), address: address.trim() || null });
          invalidate("/locations");
          toast(t`Location created.`);
          onCreated(res.id);
        }}
      >
        <Trans>Create</Trans>
      </Button>
    </Sheet>
  );
}

export function PlanEditorPage({ id, planId }: { id: string; planId: string }) {
  const isNew = planId === "neu";
  const { route, query } = useLocation();
  const { data, error, reload } = useQuery<PlansResponse>(`/teams/${id}/plans`);
  const { data: locs } = useLocations();
  const existing = !isNew ? (data?.plans.find((p) => String(p.id) === planId) ?? null) : null;
  useDocumentTitle(isNew ? t`Create training plan` : t`Training plan`);
  const today = todayLocal();
  const [name, setName] = useState(query.name ?? t`Regular plan`);
  const [kind, setKind] = useState<"regular" | "holiday">((query.kind as "holiday") ?? "regular");
  const [from, setFrom] = useState(query.from ?? today);
  const [to, setTo] = useState(query.to ?? `${Number(today.slice(0, 4)) + (Number(today.slice(5, 7)) >= 8 ? 1 : 0)}-07-28`);
  // Holiday plan with a period: the dates follow the holidays under Administration → Holidays
  const [periodId, setPeriodId] = useState<number | null>(query.holiday ? Number(query.holiday) : null);
  const [declineHours, setDeclineHours] = useState("");
  const [rules, setRules] = useState<DraftRule[]>([]);
  const [editing, setEditing] = useState<number | null>(null);
  const [preview, setPreview] = useState<{ occurrences: number; weeks: number; uncoveredHolidays: { name: string; startsOn: string; endsOn: string }[] } | null>(null);
  const allTeams = data?.allTeams ?? [];
  const ownTeamId = Number(id);

  useEffect(() => {
    if (!existing) return;
    setName(existing.name);
    setKind(existing.kind);
    setFrom(existing.validFrom);
    setTo(existing.validTo);
    setPeriodId(existing.holidayPeriodId);
    setDeclineHours(existing.declineHours != null ? String(existing.declineHours) : "");
    setRules(existing.rules.map((r) => ({ id: r.id, weekday: r.weekday, startsAt: r.startsAt, endsAt: r.endsAt, locationId: r.location.id, teamIds: r.teams.map((t) => t.id) })));
  }, [existing?.id, data]);

  useEffect(() => {
    if (!from || !to || from > to) return;
    const t = setTimeout(() => {
      api
        .post<NonNullable<typeof preview>>(`/teams/${id}/plans/preview`, { kind, validFrom: from, validTo: to, planId: existing?.id, rules: rules.map((r) => ({ weekday: r.weekday, startsAt: r.startsAt, endsAt: r.endsAt })) })
        .then(setPreview)
        .catch(() => setPreview(null));
    }, 300);
    return () => clearTimeout(t);
  }, [kind, from, to, JSON.stringify(rules)]);

  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <Spinner />;
  if (!isNew && !existing) return <ErrorBox error={new Error(t`This plan does not exist.`)} />;

  const locName = (lid: number) => locs?.locations.find((l) => l.id === lid)?.name;
  const shared = rules.some((r) => r.teamIds.filter((t) => t !== ownTeamId).length > 0);
  const holidays = data.holidays.filter((h) => h.endsOn >= today);
  const teamName = allTeams.find((x) => x.id === ownTeamId)?.name ?? "";

  const saveRule = async (r: DraftRule) => {
    if (isNew) {
      setRules(editing != null && editing >= 0 ? rules.map((x, i) => (i === editing ? r : x)) : [...rules, r]);
      setEditing(null);
      return;
    }
    const body = { weekday: r.weekday, startsAt: r.startsAt, endsAt: r.endsAt, locationId: r.locationId, teamIds: r.teamIds };
    if (r.id) await api.patch(`/rules/${r.id}`, body);
    else await api.post(`/plans/${existing!.id}/rules`, body);
    invalidate("/events", `/teams/${id}/plans`);
    toast(r.id ? t`Training time changed. Future events have been adjusted.` : t`Training time added.`);
    setEditing(null);
    await reload();
  };

  return (
    <main class="page">
      <header class="topbar">
        <button type="button" class="icon-btn" aria-label={t`Cancel`} onClick={() => history.back()}>
          <Icon name="x" size={22} stroke={2.2} />
        </button>
        <div style={{ flex: 1 }}>
          <div class="kicker">
            <Trans>
              Team <span class="nocaps">{teamName}</span>
            </Trans>
          </div>
          <h1>{isNew ? t`Create training plan` : t`Training plan`}</h1>
        </div>
      </header>
      <div class="content">
        <TextField label={t`Name`} value={name} onInput={setName} maxLength={80} />
        {isNew ? (
          <div class="field">
            <span class="field-label">
              <Trans>Kind of plan</Trans>
            </span>
            <Segmented
              label={t`Kind of plan`}
              value={kind}
              onChange={setKind}
              options={[
                { value: "regular", label: t`Regular` },
                { value: "holiday", label: t`Holiday plan` },
              ]}
            />
            <span class="field-hint">
              {kind === "regular"
                ? t`A holiday plan takes precedence in its period. After that this plan applies again.`
                : t`Applies only in the chosen holidays and replaces the regular plan there. Without training times it means a training break.`}
            </span>
          </div>
        ) : null}
        {kind === "holiday" && (holidays.length || periodId) ? (
          <Field label={t`Holidays`} hint={periodId ? t`The dates follow the holiday period, even if it is changed under Administration → Holidays.` : undefined}>
            {(fid) => (
              <select
                id={fid}
                class="select"
                value={periodId ?? ""}
                onChange={(e) => {
                  const v = (e.target as HTMLSelectElement).value;
                  const h = data.holidays.find((x) => String(x.id) === v);
                  setPeriodId(h ? h.id : null);
                  if (h) {
                    setFrom(h.startsOn);
                    setTo(h.endsOn);
                    const holiday = h.name;
                    if (isNew) setName(t`Holiday plan ${holiday}`);
                  }
                }}
              >
                <option value="">{t`Custom period`}</option>
                {data.holidays
                  .filter((h) => h.endsOn >= today || h.id === periodId)
                  .map((h) => (
                    <option value={h.id}>
                      {h.name} ({fullDate(h.startsOn)} – {fullDate(h.endsOn)})
                    </option>
                  ))}
              </select>
            )}
          </Field>
        ) : null}
        <div class="grid-2">
          <Field label={t`Valid from`}>
            {(fid) => (
              <input
                id={fid}
                class="input"
                type="date"
                value={from}
                onInput={(e) => {
                  setFrom((e.target as HTMLInputElement).value);
                  setPeriodId(null);
                }}
              />
            )}
          </Field>
          <Field label={t`Until`}>
            {(fid) => (
              <input
                id={fid}
                class="input"
                type="date"
                value={to}
                onInput={(e) => {
                  setTo((e.target as HTMLInputElement).value);
                  setPeriodId(null);
                }}
              />
            )}
          </Field>
        </div>

        <section class="stack" aria-label={t`Training times`}>
          <h2 class="section-title" style={{ fontSize: "20px" }}>
            <Trans>Training times</Trans>
          </h2>
          {rules.map((r, i) =>
            editing === i ? (
              <RuleEditor key={`edit-${i}`} title={t`Edit training time`} initial={r} ownTeamId={ownTeamId} allTeams={allTeams} onSave={saveRule} onCancel={() => setEditing(null)} />
            ) : (
              <RuleCard
                rule={{
                  id: r.id ?? -1,
                  weekday: r.weekday,
                  startsAt: r.startsAt,
                  endsAt: r.endsAt,
                  location: { id: r.locationId, name: locName(r.locationId) ?? t`Location` },
                  teams: [ownTeamId, ...r.teamIds.filter((t) => t !== ownTeamId)].map((t) => allTeams.find((x) => x.id === t) ?? { id: t, name: "?" }),
                }}
                ownTeamId={ownTeamId}
                onEdit={() => setEditing(i)}
                onDelete={async () => {
                  if (isNew) {
                    setRules(rules.filter((_, j) => j !== i));
                    return;
                  }
                  if (!(await confirmDialog({ title: t`Remove training time?`, message: t`All future events of this training time and their responses will be deleted.`, confirmLabel: t`Remove`, danger: true }))) return;
                  await api.del(`/rules/${r.id}`);
                  invalidate("/events", `/teams/${id}/plans`);
                  await reload();
                }}
              />
            ),
          )}
          {editing === null || editing === -1 ? (
            <RuleEditor key={`new-${rules.length}`} title={t`New training time`} initial={null} ownTeamId={ownTeamId} allTeams={allTeams} onSave={saveRule} />
          ) : null}
        </section>

        {shared ? (
          <TextField
            label={t`Decline deadline for joint trainings (hrs, optional)`}
            value={declineHours}
            onInput={setDeclineHours}
            inputMode="numeric"
            maxLength={3}
            hint={t`Leave empty: the longest deadline of the teams involved applies.`}
          />
        ) : null}

        {preview ? (
          <section class="notice" style={{ flexDirection: "column", gap: "6px" }} aria-live="polite">
            <strong style={{ color: "var(--text)" }}>
              <Trans>Preview</Trans>
            </strong>
            <span>
              {previewText(preview)}
            </span>
          </section>
        ) : null}

        <div class="btn-row">
          <Button size="lg" onClick={() => history.back()}>
            <Trans>Cancel</Trans>
          </Button>
          <Button
            variant="accent"
            size="lg"
            style={{ flex: 2 }}
            onClick={async () => {
              const dh = declineHours.trim() ? Number(declineHours) : null;
              if (dh != null && (!Number.isInteger(dh) || dh < 0 || dh > 168)) {
                toast(t`Please enter a deadline between 0 and 168 hours.`, "error");
                return;
              }
              if (isNew) {
                const res = await api.post<{ id: number; created: number }>(`/teams/${id}/plans`, { name: name.trim(), kind, validFrom: from, validTo: to, declineHours: dh, holidayPeriodId: kind === "holiday" ? periodId : null, rules });
                const created = res.created;
                toast(t`Plan saved. ${created} events created.`);
              } else {
                await api.patch(`/plans/${existing!.id}`, { name: name.trim(), validFrom: from, validTo: to, declineHours: dh, holidayPeriodId: kind === "holiday" ? periodId : null });
                toast(t`Plan saved.`);
              }
              invalidate("/events", `/teams/${id}/plans`);
              route(`/team/${id}/plaene`, true);
            }}
          >
            <Trans>Save plan</Trans>
          </Button>
        </div>
        {!isNew ? (
          <Button
            variant="ghost"
            icon="trash"
            onClick={async () => {
              if (!(await confirmDialog({ title: t`Delete plan?`, message: t`All future events from this plan will be deleted. Past ones are kept.`, confirmLabel: t`Delete`, danger: true }))) return;
              await api.del(`/plans/${existing!.id}`);
              invalidate("/events", `/teams/${id}/plans`);
              route(`/team/${id}/plaene`, true);
            }}
          >
            <Trans>Delete plan</Trans>
          </Button>
        ) : null}
        {!isNew ? (
          <Notice>
            <Trans>Changes to training times apply immediately. Responses are kept as long as the date stays the same.</Trans>
          </Notice>
        ) : null}
      </div>
    </main>
  );
}
