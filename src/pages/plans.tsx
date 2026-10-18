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
  /** Ferienplan folgt diesem Ferienzeitraum */
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
          {rule.teams.length > 1 ? <span class="small muted">gemeinsames Training</span> : null}
        </div>
      </div>
      {onEdit ? (
        <button type="button" class="icon-btn" aria-label="Trainingszeit bearbeiten" onClick={onEdit} style={{ width: "48px", height: "auto" }}>
          <Icon name="edit" size={20} />
        </button>
      ) : null}
      {onDelete ? (
        <button type="button" class="icon-btn" aria-label="Trainingszeit entfernen" onClick={onDelete} style={{ width: "44px", height: "auto" }}>
          <Icon name="trash" size={18} />
        </button>
      ) : null}
    </div>
  );
}

export function PlansPage({ id }: { id: string }) {
  useDocumentTitle("Trainingspläne");
  const { route } = useLocation();
  const { data, error, loading, reload } = useQuery<PlansResponse>(`/teams/${id}/plans`);
  const today = todayLocal();
  const plans = data?.plans ?? [];
  const regular = plans.filter((p) => p.kind === "regular");
  const holiday = plans.filter((p) => p.kind === "holiday" && p.validTo >= today);
  // Alle kommenden Ferien unter Verwaltung → Ferien, für die es noch keinen Ferienplan gibt
  const upcomingHolidays = (data?.holidays ?? []).filter(
    (h) => h.endsOn >= today && !plans.some((p) => p.kind === "holiday" && (p.holidayPeriodId === h.id || (p.validFrom <= h.startsOn && h.endsOn <= p.validTo))),
  );

  return (
    <main class="page">
      <TopBar title="Trainingspläne" kicker="Team" back={`/team/${id}`} />
      <div class="content">
        {error ? <ErrorBox error={error} onRetry={reload} /> : null}
        {loading ? <Spinner /> : null}
        <Button variant="primary" size="lg" icon="plus" onClick={() => route(`/team/${id}/plaene/neu`)}>
          Trainingsplan anlegen
        </Button>

        {regular.map((p) => (
          <section class="stack-sm" aria-label={p.name}>
            <div class="row-gap" style={{ justifyContent: "space-between" }}>
              <div>
                <h2 class="section-title">{p.name}</h2>
                <div class="small muted" style={{ marginLeft: "2px" }}>
                  {fullDate(p.validFrom)} bis {fullDate(p.validTo)} {p.isCurrent ? "· aktuell" : ""}
                </div>
              </div>
              <a class="btn btn-sm" href={`/team/${id}/plaene/${p.id}`}>
                Bearbeiten
              </a>
            </div>
            {p.rules.map((r) => (
              <RuleCard rule={r} ownTeamId={Number(id)} />
            ))}
            {!p.rules.length ? <p class="small muted">Noch keine Trainingszeiten.</p> : null}
          </section>
        ))}

        {data?.sharedRules.length ? (
          <section class="stack-sm" aria-label="Gemeinsame Trainings anderer Pläne">
            <h2 class="section-title">Gemeinsam mit anderen</h2>
            {data.sharedRules.map((r) => (
              <div class="stack-sm">
                <RuleCard rule={r} ownTeamId={Number(id)} />
                <p class="small muted">
                  Aus dem Plan „{r.planName}“ der {r.ownerTeam}.
                </p>
              </div>
            ))}
          </section>
        ) : null}

        <section class="stack-sm" aria-label="Ferien">
          <h2 class="section-title">Ferien</h2>
          {holiday.map((p) => (
            <a class="list-row card" href={`/team/${id}/plaene/${p.id}`}>
              <Icon name="sun" size={22} />
              <span class="main">
                <span class="title">{p.name}</span>
                <span class="sub">
                  {fullDate(p.validFrom)} bis {fullDate(p.validTo)} · {p.rules.length ? `${p.rules.length} Trainingszeiten` : "Trainingspause"}
                </span>
              </span>
              <Icon name="chevron" size={18} />
            </a>
          ))}
          {upcomingHolidays.map((h) => (
            <div class="card card-pad stack-sm">
              <div>
                <strong>{h.name}</strong>
                <div class="small muted">
                  {fullDate(h.startsOn)} bis {fullDate(h.endsOn)}: noch kein Ferienplan, der reguläre Plan läuft weiter.
                </div>
              </div>
              <div class="btn-row">
                <Button
                  size="sm"
                  onClick={async () => {
                    await api.post(`/teams/${id}/plans`, { name: `Pause ${h.name}`, kind: "holiday", validFrom: h.startsOn, validTo: h.endsOn, holidayPeriodId: h.id, rules: [] });
                    invalidate("/events", `/teams/${id}/plans`);
                    toast(`In den ${h.name} findet kein Training statt.`);
                    await reload();
                  }}
                >
                  Trainingspause
                </Button>
                <Button size="sm" onClick={() => route(`/team/${id}/plaene/neu?kind=holiday&holiday=${h.id}&from=${h.startsOn}&to=${h.endsOn}&name=${encodeURIComponent(`Ferienplan ${h.name}`)}`)}>
                  Ferienplan
                </Button>
              </div>
            </div>
          ))}
          {!holiday.length && !upcomingHolidays.length ? <p class="small muted">Keine kommenden Ferien eingetragen.</p> : null}
          <p class="small muted">Ein Ferienplan gilt nur in seinem Zeitraum und hat dort Vorrang vor dem regulären Plan.</p>
        </section>
      </div>
    </main>
  );
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
      <div class="weekdays" role="group" aria-label="Wochentag">
        {[1, 2, 3, 4, 5, 6, 7].map((d) => (
          <button type="button" aria-pressed={weekday === d ? "true" : "false"} onClick={() => setWeekday(d)}>
            {weekdayShortIso(d)}
          </button>
        ))}
      </div>
      <div class="grid-2">
        <Field label="Beginn">{(fid) => <input id={fid} class="input" type="time" value={start} onInput={(e) => setStart((e.target as HTMLInputElement).value)} />}</Field>
        <Field label="Ende">{(fid) => <input id={fid} class="input" type="time" value={end} onInput={(e) => setEnd((e.target as HTMLInputElement).value)} />}</Field>
      </div>
      <Field label="Ort">
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
            <option value="new">+ Neuen Ort anlegen</option>
          </select>
        )}
      </Field>
      <div class="stack-sm">
        <span class="field-label">Mannschaften</span>
        <div class="row-gap" style={{ gap: "6px" }}>
          <span class="badge team">{props.allTeams.find((t) => t.id === props.ownTeamId)?.name}</span>
          {teams.map((t) => (
            <button type="button" class="badge team other" style={{ border: 0, minHeight: "32px" }} onClick={() => setTeams(teams.filter((x) => x !== t))} aria-label={`${props.allTeams.find((x) => x.id === t)?.name} entfernen`}>
              {props.allTeams.find((x) => x.id === t)?.name} ✕
            </button>
          ))}
          <button type="button" class="btn btn-sm btn-dashed" onClick={() => setTeamPicker(true)}>
            + gemeinsam mit …
          </button>
        </div>
      </div>
      <div class="btn-row">
        {props.onCancel ? <Button onClick={props.onCancel}>Abbrechen</Button> : null}
        <Button
          variant="primary"
          onClick={async () => {
            if (!locationId) {
              toast("Bitte einen Ort wählen.", "error");
              return;
            }
            if (start >= end) {
              toast("Das Ende muss nach dem Beginn liegen.", "error");
              return;
            }
            await props.onSave({ id: props.initial?.id, weekday, startsAt: start, endsAt: end, locationId, teamIds: teams });
          }}
        >
          {props.initial?.id ? "Speichern" : "Hinzufügen"}
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
        <Sheet open onClose={() => setTeamPicker(false)} title="Gemeinsam mit">
          <p class="muted">Aus einer gemeinsamen Trainingszeit entsteht ein Termin, der bei allen Mannschaften erscheint. Alle beteiligten Trainer dürfen ihn bearbeiten.</p>
          <div class="chips">
            {props.allTeams
              .filter((t) => t.id !== props.ownTeamId)
              .map((t) => (
                <button
                  type="button"
                  class={`chip ${teams.includes(t.id) ? "selected" : ""}`}
                  aria-pressed={teams.includes(t.id) ? "true" : "false"}
                  onClick={() => setTeams(teams.includes(t.id) ? teams.filter((x) => x !== t.id) : [...teams, t.id])}
                >
                  {t.name}
                </button>
              ))}
          </div>
          <Button variant="primary" onClick={() => setTeamPicker(false)}>
            Fertig
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
    <Sheet open onClose={onClose} title="Neuer Trainingsort">
      <p class="muted">Zum Beispiel eine Schulturnhalle oder ein Sportplatz. Der Ort steht danach allen Trainern zur Verfügung.</p>
      <TextField label="Name" value={name} onInput={setName} maxLength={80} />
      <TextField label="Adresse (optional)" value={address} onInput={setAddress} maxLength={200} />
      <Button
        variant="primary"
        size="lg"
        block
        disabled={!name.trim()}
        onClick={async () => {
          const res = await api.post<{ id: number }>("/locations", { name: name.trim(), address: address.trim() || null });
          invalidate("/locations");
          toast("Ort angelegt.");
          onCreated(res.id);
        }}
      >
        Anlegen
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
  useDocumentTitle(isNew ? "Trainingsplan anlegen" : "Trainingsplan");
  const today = todayLocal();
  const [name, setName] = useState(query.name ?? "Regulärer Plan");
  const [kind, setKind] = useState<"regular" | "holiday">((query.kind as "holiday") ?? "regular");
  const [from, setFrom] = useState(query.from ?? today);
  const [to, setTo] = useState(query.to ?? `${Number(today.slice(0, 4)) + (Number(today.slice(5, 7)) >= 8 ? 1 : 0)}-07-28`);
  // Ferienplan mit Zeitraum: Daten folgen den Ferien unter Verwaltung → Ferien
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
  if (!isNew && !existing) return <ErrorBox error={new Error("Diesen Plan gibt es nicht.")} />;

  const locName = (lid: number) => locs?.locations.find((l) => l.id === lid)?.name;
  const shared = rules.some((r) => r.teamIds.filter((t) => t !== ownTeamId).length > 0);
  const holidays = data.holidays.filter((h) => h.endsOn >= today);

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
    toast(r.id ? "Trainingszeit geändert. Zukünftige Termine sind angepasst." : "Trainingszeit hinzugefügt.");
    setEditing(null);
    await reload();
  };

  return (
    <main class="page">
      <header class="topbar">
        <button type="button" class="icon-btn" aria-label="Abbrechen" onClick={() => history.back()}>
          <Icon name="x" size={22} stroke={2.2} />
        </button>
        <div style={{ flex: 1 }}>
          <div class="kicker">
            Team <span class="nocaps">{allTeams.find((t) => t.id === ownTeamId)?.name ?? ""}</span>
          </div>
          <h1>{isNew ? "Trainingsplan anlegen" : "Trainingsplan"}</h1>
        </div>
      </header>
      <div class="content">
        <TextField label="Name" value={name} onInput={setName} maxLength={80} />
        {isNew ? (
          <div class="field">
            <span class="field-label">Art des Plans</span>
            <Segmented
              label="Art des Plans"
              value={kind}
              onChange={setKind}
              options={[
                { value: "regular", label: "Regulär" },
                { value: "holiday", label: "Ferienplan" },
              ]}
            />
            <span class="field-hint">
              {kind === "regular"
                ? "Ein Ferienplan hat in seinem Zeitraum Vorrang. Danach gilt wieder dieser Plan."
                : "Gilt nur in den gewählten Ferien und ersetzt dort den regulären Plan. Ohne Trainingszeiten bedeutet er Trainingspause."}
            </span>
          </div>
        ) : null}
        {kind === "holiday" && (holidays.length || periodId) ? (
          <Field label="Ferien" hint={periodId ? "Die Daten folgen dem Ferienzeitraum, auch wenn er unter Verwaltung → Ferien geändert wird." : undefined}>
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
                    if (isNew) setName(`Ferienplan ${h.name}`);
                  }
                }}
              >
                <option value="">Eigener Zeitraum</option>
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
          <Field label="Gültig ab">
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
          <Field label="Bis">
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

        <section class="stack" aria-label="Trainingszeiten">
          <h2 class="section-title" style={{ fontSize: "20px" }}>
            Trainingszeiten
          </h2>
          {rules.map((r, i) =>
            editing === i ? (
              <RuleEditor key={`edit-${i}`} title="Trainingszeit bearbeiten" initial={r} ownTeamId={ownTeamId} allTeams={allTeams} onSave={saveRule} onCancel={() => setEditing(null)} />
            ) : (
              <RuleCard
                rule={{
                  id: r.id ?? -1,
                  weekday: r.weekday,
                  startsAt: r.startsAt,
                  endsAt: r.endsAt,
                  location: { id: r.locationId, name: locName(r.locationId) ?? "Ort" },
                  teams: [ownTeamId, ...r.teamIds.filter((t) => t !== ownTeamId)].map((t) => allTeams.find((x) => x.id === t) ?? { id: t, name: "?" }),
                }}
                ownTeamId={ownTeamId}
                onEdit={() => setEditing(i)}
                onDelete={async () => {
                  if (isNew) {
                    setRules(rules.filter((_, j) => j !== i));
                    return;
                  }
                  if (!(await confirmDialog({ title: "Trainingszeit entfernen?", message: "Alle zukünftigen Termine dieser Trainingszeit und ihre Rückmeldungen werden gelöscht.", confirmLabel: "Entfernen", danger: true }))) return;
                  await api.del(`/rules/${r.id}`);
                  invalidate("/events", `/teams/${id}/plans`);
                  await reload();
                }}
              />
            ),
          )}
          {editing === null || editing === -1 ? (
            <RuleEditor key={`new-${rules.length}`} title="Neue Trainingszeit" initial={null} ownTeamId={ownTeamId} allTeams={allTeams} onSave={saveRule} />
          ) : null}
        </section>

        {shared ? (
          <TextField
            label="Absagefrist für gemeinsame Trainings (Std., optional)"
            value={declineHours}
            onInput={setDeclineHours}
            inputMode="numeric"
            maxLength={3}
            hint="Leer lassen: Es gilt die längste Frist der beteiligten Mannschaften."
          />
        ) : null}

        {preview ? (
          <section class="notice" style={{ flexDirection: "column", gap: "6px" }} aria-live="polite">
            <strong style={{ color: "var(--text)" }}>Vorschau</strong>
            <span>
              Für die nächsten {preview.weeks} Wochen werden {preview.occurrences} Termine erzeugt.
              {preview.uncoveredHolidays.length
                ? ` ${preview.uncoveredHolidays.map((h) => `In den ${h.name} (${fullDate(h.startsOn).slice(0, 6)} bis ${fullDate(h.endsOn).slice(0, 6)})`).join(", ")} ist noch kein Ferienplan hinterlegt.`
                : ""}
            </span>
          </section>
        ) : null}

        <div class="btn-row">
          <Button size="lg" onClick={() => history.back()}>
            Abbrechen
          </Button>
          <Button
            variant="accent"
            size="lg"
            style={{ flex: 2 }}
            onClick={async () => {
              const dh = declineHours.trim() ? Number(declineHours) : null;
              if (dh != null && (!Number.isInteger(dh) || dh < 0 || dh > 168)) {
                toast("Bitte eine Frist zwischen 0 und 168 Stunden angeben.", "error");
                return;
              }
              if (isNew) {
                const res = await api.post<{ id: number; created: number }>(`/teams/${id}/plans`, { name: name.trim(), kind, validFrom: from, validTo: to, declineHours: dh, holidayPeriodId: kind === "holiday" ? periodId : null, rules });
                toast(`Plan gespeichert. ${res.created} Termine erzeugt.`);
              } else {
                await api.patch(`/plans/${existing!.id}`, { name: name.trim(), validFrom: from, validTo: to, declineHours: dh, holidayPeriodId: kind === "holiday" ? periodId : null });
                toast("Plan gespeichert.");
              }
              invalidate("/events", `/teams/${id}/plans`);
              route(`/team/${id}/plaene`, true);
            }}
          >
            Plan speichern
          </Button>
        </div>
        {!isNew ? (
          <Button
            variant="ghost"
            icon="trash"
            onClick={async () => {
              if (!(await confirmDialog({ title: "Plan löschen?", message: "Alle zukünftigen Termine aus diesem Plan werden gelöscht. Vergangene bleiben erhalten.", confirmLabel: "Löschen", danger: true }))) return;
              await api.del(`/plans/${existing!.id}`);
              invalidate("/events", `/teams/${id}/plans`);
              route(`/team/${id}/plaene`, true);
            }}
          >
            Plan löschen
          </Button>
        ) : null}
        {!isNew ? <Notice>Änderungen an Trainingszeiten gelten sofort. Rückmeldungen bleiben erhalten, solange das Datum gleich bleibt.</Notice> : null}
      </div>
    </main>
  );
}
