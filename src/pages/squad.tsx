import { useEffect, useMemo, useState } from "preact/hooks";
import type { EventSummary, ParticipationStatus, PersonRef } from "../../shared/types";
import { api } from "../api";
import { personName, shortDate, shortName, time } from "../format";
import { Icon } from "../icons";
import { invalidate, useQuery } from "../store";
import { Button, confirmDialog, ErrorBox, Notice, Sheet, Spinner, toast, useDocumentTitle } from "../ui";

interface Candidate {
  person: PersonRef;
  isHelper: boolean;
  isCore: boolean;
  isActive: boolean;
  nominated: boolean;
  status: ParticipationStatus | null;
  reason: string | null;
  hint: string;
  conflict: string | null;
  ageWarning: string | null;
}

interface SquadData {
  event: EventSummary;
  team: { id: number; name: string; maxSquad: number; autoSquad: boolean };
  published: boolean;
  automatic: boolean;
  candidates: Candidate[];
  coreIds: number[];
  lastGameIds: number[];
  helpRequests: { id: number; status: string; person: PersonRef; homeTeam: string | null }[];
}

export function SquadPage({ id }: { id: string }) {
  useDocumentTitle("Kader nominieren");
  const { data, error, loading, reload } = useQuery<SquadData>(`/events/${id}/squad`);
  const [picked, setPicked] = useState<number[] | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    if (!data || picked) return;
    const nominated = data.candidates.filter((c) => c.nominated).map((c) => c.person.id);
    const active = new Set(data.candidates.filter((c) => c.isActive).map((c) => c.person.id));
    setPicked(data.published ? nominated : data.coreIds.filter((pid) => active.has(pid)));
  }, [data]);

  const max = data?.team.maxSquad ?? 20;
  const selected = picked ?? [];
  const declined = useMemo(() => (data?.candidates ?? []).filter((c) => c.nominated && c.status === "no"), [data]);
  const replacements = useMemo(
    () => (data?.candidates ?? []).filter((c) => !c.nominated && c.isActive && !c.conflict && !selected.includes(c.person.id)).slice(0, 4),
    [data, selected],
  );

  if (loading || !picked) return error ? <ErrorBox error={error} onRetry={reload} /> : <Spinner />;
  if (error || !data) return <ErrorBox error={error} onRetry={reload} />;

  const toggle = (c: Candidate) => {
    if (!c.isActive) return;
    if (selected.includes(c.person.id)) setPicked(selected.filter((x) => x !== c.person.id));
    else if (selected.length >= max) toast(`Höchstens ${max} Spieler im Kader.`, "error");
    else setPicked([...selected, c.person.id]);
  };
  const activeIds = new Set(data.candidates.filter((c) => c.isActive).map((c) => c.person.id));
  const changed = data.published
    ? JSON.stringify([...selected].sort()) !== JSON.stringify(data.candidates.filter((c) => c.nominated).map((c) => c.person.id).sort())
    : true;
  const ev = data.event;

  return (
    <main class="page">
      <header class="topbar" style={{ flexDirection: "column", alignItems: "stretch", gap: "14px", paddingLeft: "16px", paddingRight: "16px" }}>
        <div class="row-gap">
          <button type="button" class="icon-btn" aria-label="Zurück" onClick={() => history.back()} style={{ marginLeft: "-8px" }}>
            <Icon name="back" size={24} stroke={2.2} />
          </button>
          <h1 style={{ fontSize: "28px" }}>Kader nominieren</h1>
        </div>
        <div class="squad-head">
          <div>
            <div style={{ fontSize: "13px", fontWeight: 700, letterSpacing: "0.06em" }}>
              {shortDate(ev.startsAt).toUpperCase()} · {time(ev.startsAt)}
            </div>
            <div style={{ fontFamily: "var(--font-cond)", fontWeight: 700, fontSize: "24px", lineHeight: 1.1 }}>{ev.title}</div>
            <div style={{ fontSize: "14px" }}>{ev.location?.name ?? "Halle folgt"}</div>
          </div>
          <div>
            <div class="squad-count" aria-live="polite">
              {selected.length}
              <small>/{max}</small>
            </div>
            <div style={{ fontSize: "12px", fontWeight: 700, textAlign: "right" }}>nominiert</div>
          </div>
        </div>
      </header>

      <div class="content">
        {data.automatic ? (
          <Notice>Automatisch: Für dieses Spiel ist der Stammkader nominiert. Änderst du hier etwas, gilt deine Auswahl nur für dieses Spiel.</Notice>
        ) : null}
        {data.team.autoSquad && !data.automatic && data.published && !ev.isPast ? (
          <div class="notice">
            <Icon name="info" size={18} />
            <div class="stack-sm" style={{ flex: 1 }}>
              <span>Diesen Kader hast du von Hand angepasst. Änderungen am Stammkader wirken hier nicht.</span>
              <Button
                size="sm"
                onClick={async () => {
                  await api.post(`/events/${id}/squad/auto`);
                  invalidate("/events");
                  setPicked(null);
                  await reload();
                  toast("Der Kader folgt wieder dem Stammkader.");
                }}
              >
                Wieder automatisch
              </Button>
            </div>
          </div>
        ) : null}
        {selected.length > max ? (
          <Notice kind="warn">
            Mehr als {max} im Kader. Bitte abwählen oder die Kadergröße unter Team → Einstellungen erhöhen.
          </Notice>
        ) : null}
        {declined.length ? (
          <div class="notice warn">
            <Icon name="alert" size={18} />
            <div>
              <strong>Absage:</strong> {declined.map((d) => `${shortName(d.person)}${d.reason ? ` („${d.reason}“)` : ""}`).join(", ")}.
              {replacements.length ? ` Ersatzvorschlag: ${replacements.map((r) => shortName(r.person)).join(", ")}.` : ""}
            </div>
          </div>
        ) : null}

        <div class="grid-2">
          <Button
            disabled={!data.coreIds.length}
            onClick={() => setPicked(data.coreIds.filter((pid) => activeIds.has(pid)).slice(0, max))}
          >
            Stammkader übernehmen
          </Button>
          <Button disabled={!data.lastGameIds.length} onClick={() => setPicked(data.lastGameIds.filter((pid) => activeIds.has(pid)).slice(0, max))}>
            Wie letztes Spiel
          </Button>
        </div>
        {!data.coreIds.length ? (
          <p class="small muted">
            Noch kein Stammkader festgelegt. Das geht unter <a href={`/team/${data.team.id}`}>Team → Kader</a>.
          </p>
        ) : null}

        <ul class="list" aria-label="Spielerinnen und Spieler">
          {data.candidates.map((c) => {
            const on = selected.includes(c.person.id);
            const warning = c.conflict ?? c.ageWarning;
            if (!c.isActive) {
              return (
                <li>
                  <div class="squad-row off">
                    <span class="check disabled" />
                    <span style={{ flex: 1 }}>
                      <span style={{ display: "block", fontWeight: 700 }}>{shortName(c.person)}</span>
                      <span class="small">Inaktiv, nicht nominierbar</span>
                    </span>
                  </div>
                </li>
              );
            }
            return (
              <li>
                <button type="button" class={`squad-row ${on ? "on" : ""}`} role="checkbox" aria-checked={on ? "true" : "false"} onClick={() => toggle(c)}>
                  <span class={`check ${on ? "on" : ""}`}>{on ? <Icon name="check" size={16} stroke={3} /> : null}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", fontWeight: 700, fontSize: "16px" }}>{shortName(c.person)}</span>
                    <span class="small muted" style={{ display: "block" }}>
                      {c.nominated && c.status === "yes"
                        ? "Zugesagt"
                        : c.nominated && c.status === "no"
                          ? `Abgesagt${c.reason ? `: ${c.reason}` : ""}`
                          : c.hint || " "}
                    </span>
                    {warning ? (
                      <span class="small warn-text" style={{ display: "block" }}>
                        {warning}
                      </span>
                    ) : null}
                  </span>
                  {c.isHelper ? <span class="badge muted">Aushilfe</span> : null}
                  {c.isCore ? <span class="badge outline">Stamm</span> : null}
                </button>
              </li>
            );
          })}
        </ul>

        {data.helpRequests.length ? (
          <div class="card card-pad stack-sm">
            <strong>Aushilfe-Anfragen</strong>
            {data.helpRequests.map((h) => (
              <div class="row-gap" style={{ justifyContent: "space-between" }}>
                <span>
                  {personName(h.person)} {h.homeTeam ? <span class="muted">({h.homeTeam})</span> : null}
                </span>
                <span class={`pill ${h.status === "accepted" ? "pill-yes" : h.status === "declined" ? "pill-no" : "pill-open"}`}>
                  {h.status === "accepted" ? "Zugesagt" : h.status === "declined" ? "Abgelehnt" : "Angefragt"}
                </span>
              </div>
            ))}
          </div>
        ) : null}

        <Button variant="dashed" icon="plus" onClick={() => setHelpOpen(true)}>
          Aushilfe anfragen
        </Button>

        <Button
          variant="primary"
          size="lg"
          disabled={!changed && data.published}
          onClick={async () => {
            if (!selected.length && !(await confirmDialog({ title: "Leeren Kader veröffentlichen?", message: "Niemand ist nominiert.", confirmLabel: "Trotzdem" }))) return;
            const res = await api.put<{ added: number; removed: number }>(`/events/${id}/squad`, { personIds: selected });
            invalidate(`/events`);
            setPicked(null);
            toast(data.published ? `Kader aktualisiert (${res.added} neu, ${res.removed} entfernt).` : "Kader veröffentlicht. Die Nominierten wurden benachrichtigt.");
            await reload();
          }}
        >
          {data.published ? `Änderungen speichern · ${selected.length}` : `Kader veröffentlichen · ${selected.length} ${selected.length === 1 ? "Person" : "Personen"}`}
        </Button>
        <p class="small muted" style={{ textAlign: "center" }}>
          Nominierte erhalten eine Benachrichtigung und gelten als zugesagt, bis sie absagen.
        </p>
        {!data.published ? <Notice>Vorausgewählt ist der Stammkader. Spieler und Eltern sehen die Nominierung erst nach dem Veröffentlichen.</Notice> : null}
      </div>
      {helpOpen ? <HelpSheet eventId={id} teamName={data.team.name} onClose={() => setHelpOpen(false)} onDone={reload} /> : null}
    </main>
  );
}

function HelpSheet({ eventId, teamName, onClose, onDone }: { eventId: string; teamName: string; onClose: () => void; onDone: () => void }) {
  const { data, error, reload } = useQuery<{ candidates: { person: PersonRef; team: { id: number; name: string }; conflict: string | null; requested: boolean }[] }>(
    `/events/${eventId}/help-candidates`,
  );
  return (
    <Sheet open onClose={onClose} title="Aushilfe anfragen">
      <p class="muted">
        Vorschläge aus der 2. Mannschaft derselben Altersklasse und der nächstjüngeren Jugend. Die Anfrage geht an die Person bzw. ihre Eltern, die Trainer der
        Stammmannschaft werden informiert.
      </p>
      {error ? <ErrorBox error={error} /> : null}
      {!data ? <Spinner /> : null}
      {data && !data.candidates.length ? <Notice>Für die {teamName} gibt es keine passenden Aushilfen.</Notice> : null}
      <ul class="list">
        {(data?.candidates ?? []).map((c) => (
          <li class="list-row">
            <span class="main">
              <span class="title">{personName(c.person)}</span>
              <span class="sub">{c.team.name}</span>
              {c.conflict ? <span class="small warn-text">{c.conflict}</span> : null}
            </span>
            {c.requested ? (
              <span class="pill pill-muted">Angefragt</span>
            ) : (
              <Button
                size="sm"
                variant="primary"
                onClick={async () => {
                  await api.post(`/events/${eventId}/help-requests`, { personId: c.person.id });
                  toast(`${c.person.firstName} wurde angefragt.`);
                  await reload();
                  onDone();
                }}
              >
                Anfragen
              </Button>
            )}
          </li>
        ))}
      </ul>
    </Sheet>
  );
}
