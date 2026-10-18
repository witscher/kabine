import { useState } from "preact/hooks";
import type { EventDetail, LocationRef, MyParticipation, ParticipantDetail, RosterEntry } from "../../shared/types";
import { api, errorMessage } from "../api";
import { CarpoolCard } from "../carpool";
import { dutyLines, neededText } from "../duties";
import { BlockSheet } from "../duty-blocks";
import { longDate, personName, shortName, stamp, time, timeRange, weekdayPlural } from "../format";
import { Icon } from "../icons";
import { GameReportLink, isLiveWindow, isReportWindow, LiveTickerLink } from "../live";
import { DeclineSheet, deadlineText, PersonResponseRow, QUICK_REASONS, ResponseButtons, respondedByText, sendResponse } from "../respond";
import { useMe, useSession } from "../session";
import { invalidate, useQuery } from "../store";
import { Button, confirmDialog, copyText, ErrorBox, Field, Notice, Sheet, Spinner, StatusPill, SwitchRow, TextField, toast, useDocumentTitle } from "../ui";

const KIND = { training: "Training", game: "Spiel", special: "Termin" } as const;

function weekdayOf(local: string): number {
  const [y, m, d] = local.slice(0, 10).split("-").map(Number) as [number, number, number];
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return wd === 0 ? 7 : wd;
}

/**
 * Link, der die Karten- bzw. Navi-App des Geräts öffnet: auf iPhone/iPad Apple
 * Karten, auf Android die Auswahl der installierten Apps (geo:), sonst Google Maps im Browser.
 */
export function mapsHref(location: LocationRef): string | null {
  if (!location.address) return location.mapUrl;
  const q = encodeURIComponent(location.address);
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  if (ios) return `https://maps.apple.com/?q=${q}`;
  if (/Android/.test(ua)) return `geo:0,0?q=${q}`;
  return `https://www.google.com/maps/search/?api=1&query=${q}`;
}

function MapLink({ location }: { location: LocationRef }) {
  const href = mapsHref(location);
  const content = (
    <>
      <Icon name="pin" size={18} />
      {location.name}
    </>
  );
  return href ? (
    <a href={href} target={href.startsWith("http") ? "_blank" : undefined} rel="noopener noreferrer" style={{ textUnderlineOffset: "3px" }} aria-label={`${location.name}, in der Karten-App öffnen`}>
      {content}
    </a>
  ) : (
    <span>{content}</span>
  );
}

export function EventPage({ id }: { id: string }) {
  const me = useMe();
  const { data: event, error, loading, reload } = useQuery<EventDetail>(`/events/${id}`, { refreshMs: 10_000 });
  const [declineFor, setDeclineFor] = useState<MyParticipation | null>(null);
  useDocumentTitle(event ? `${KIND[event.kind]} ${longDate(event.startsAt)}` : "Termin");

  if (loading) return <Spinner />;
  if (error || !event) {
    return (
      <main class="page">
        <header class="topbar">
          <a class="icon-btn" href="/" aria-label="Zurück">
            <Icon name="back" size={24} />
          </a>
          <h1>Termin</h1>
        </header>
        <div class="content">
          <ErrorBox error={error} onRetry={reload} />
        </div>
      </main>
    );
  }

  const mine = event.mine.filter((m) => m.participant || m.helpRequest || event.kind === "game");
  const single = mine.length === 1 && mine[0]!.person.id === me.person.id ? mine[0]! : null;

  return (
    <main class="page">
      <header class="hero" style={{ paddingTop: "calc(14px + var(--safe-top))" }}>
        <div class="hero-top">
          <button type="button" class="icon-btn" aria-label="Zurück" onClick={() => (history.length > 1 ? history.back() : location.assign("/"))} style={{ marginLeft: "-12px" }}>
            <Icon name="back" size={24} stroke={2.2} />
          </button>
          <div class="row-gap" style={{ gap: "6px" }}>
            {event.clubWide ? <span class="team-badge">Verein</span> : event.teams.map((t) => <span class="team-badge">{t.name}</span>)}
            {event.isDetached && event.kind === "training" ? <span class="team-badge outline">geändert</span> : null}
          </div>
        </div>
        <div class="kicker">{event.kind === "special" ? event.title : KIND[event.kind]}</div>
        <h1>{longDate(event.startsAt)}</h1>
        {event.kind === "game" ? <div style={{ fontWeight: 700, fontSize: "18px" }}>{event.title}</div> : null}
        <div class="meta-line">
          <span>
            <Icon name="clock" size={18} />
            {timeRange(event.startsAt, event.endsAt)}
          </span>
          {event.location ? <MapLink location={event.location} /> : null}
        </div>
      </header>

      <div class="content">
        {event.cancelled ? (
          <div class="notice warn" role="status">
            <Icon name="alert" />
            <div>
              <strong>Abgesagt{event.cancelled.byName ? ` von ${event.cancelled.byName}` : ""}.</strong>
              {event.cancelled.reason ? ` ${event.cancelled.reason}` : ""}
            </div>
          </div>
        ) : null}

        {event.kind === "game" && event.game ? <GameInfo event={event} /> : null}
        {event.kind === "special" && !event.isPast && !event.cancelled && event.teams.length ? <SpecialHelpers event={event} onChanged={reload} /> : null}
        {event.notes ? (
          <div class="card card-pad">
            <div class="small muted" style={{ fontWeight: 700 }}>
              INFO
            </div>
            <p style={{ whiteSpace: "pre-wrap" }}>{event.notes}</p>
          </div>
        ) : null}

        {mine.length ? (
          <section class="card card-body" aria-label="Deine Rückmeldung">
            <h2 class="section-title" style={{ margin: 0 }}>
              {single ? "Deine Rückmeldung" : "Rückmeldungen"}
            </h2>
            {single && !single.helpRequest ? (
              <>
                <div class="row-gap">
                  <StatusPill status={single.status} late={single.isLate} nominated={single.nominated} game={event.kind === "game"} />
                  {single.unexcused ? <span class="badge warn">Unentschuldigt gefehlt</span> : null}
                  {single.respondedAt && respondedByText(single, me.person.id) ? (
                    <span class="small muted">
                      {respondedByText(single, me.person.id)}, {stamp(single.respondedAt)}
                    </span>
                  ) : null}
                </div>
                {event.kind === "game" && !single.participant ? <p class="muted">Du bist für dieses Spiel nicht nominiert.</p> : null}
                <ResponseButtons event={event} p={single} onDecline={setDeclineFor} />
                {single.status === "no" && single.reason ? <p class="small muted">Dein Grund: „{single.reason}“</p> : null}
              </>
            ) : (
              mine.map((m) => <PersonResponseRow key={m.person.id} event={event} p={m} onDecline={setDeclineFor} />)
            )}
            {event.deadline && !event.isPast && !event.cancelled && mine.some((m) => m.participant) ? (
              <p class="small muted">
                Bitte sage rechtzeitig bis {deadlineText(event)} ({event.deadlineHours} Std. vorher) ab, damit deine Trainer besser planen können.
              </p>
            ) : null}
          </section>
        ) : null}

        {event.carpool ? <CarpoolCard event={event} carpool={event.carpool} onChanged={reload} /> : null}

        {event.counts && !event.participants ? (
          <section class="stats" aria-label="Rückmeldungen der Mannschaft">
            <div class="stat" style={{ background: "var(--card)" }}>
              <div class="n">{event.counts.yes}</div>
              <div class="l">Nehmen teil</div>
            </div>
            <div class="stat" style={{ background: "var(--card)" }}>
              <div class="n">{event.counts.no + event.counts.standing}</div>
              <div class="l">Absagen</div>
            </div>
            <div class="stat" style={{ background: "var(--card)" }}>
              <div class="n">{event.counts.inactive}</div>
              <div class="l">Inaktiv</div>
            </div>
          </section>
        ) : null}

        {event.canManage ? <CoachView event={event} onChanged={reload} /> : null}
      {event.roster ? <RosterList roster={event.roster} /> : null}
      </div>
      {declineFor ? <DeclineSheet event={event} person={declineFor} onClose={() => setDeclineFor(null)} /> : null}
    </main>
  );
}

function GameInfo({ event }: { event: EventDetail }) {
  const me = useMe();
  const g = event.game!;
  const helperPlan = event.teams.some((t) => me.helperTeams.some((h) => h.id === t.id));
  const result = g.homeGoals != null && g.guestGoals != null ? `${g.homeGoals}:${g.guestGoals}` : null;
  return (
    <section class="card card-pad stack-sm" aria-label="Spielinfos">
      <div class="row-gap" style={{ justifyContent: "space-between" }}>
        <span class="badge outline">{g.isHome ? "Heimspiel" : g.isHome === false ? "Auswärtsspiel" : "Spiel"}</span>
        {g.gameNo ? <span class="small muted">Spiel-Nr. {g.gameNo}</span> : null}
      </div>
      <div style={{ fontWeight: 700, fontSize: "17px" }}>
        {g.homeTeam} – {g.guestTeam}
        {result ? <span style={{ marginLeft: "8px", fontFamily: "var(--font-cond)", fontSize: "22px" }}>{result}</span> : null}
      </div>
      {isLiveWindow(event) ? <LiveTickerLink event={event} /> : isReportWindow(event) ? <GameReportLink event={event} /> : null}
      {event.location?.address ? (
        <p class="small muted row-gap" style={{ gap: "6px", alignItems: "center" }}>
          <span>{event.location.address}</span>
          <button type="button" class="icon-btn icon-btn-sm" aria-label="Adresse kopieren" onClick={() => copyText(event.location!.address!, "Adresse kopiert.")}>
            <Icon name="copy" size={16} />
          </button>
        </p>
      ) : null}
      {helperPlan && !event.isPast ? (
        <a class="ext-link" href="/helfer">
          <Icon name="helping" size={16} />
          {event.myDuties.length
            ? `Helferplan · ${dutyLines(event.myDuties).join(" · ")}`
            : event.helpersNeeded
              ? `Helferplan · ${neededText(event.helpersNeeded)}`
              : "Helferplan: Dienste für dieses Spiel"}
        </a>
      ) : null}
      {g.tableUrl ? (
        <a class="ext-link" href={g.tableUrl} target="_blank" rel="noopener noreferrer">
          <Icon name="link" size={16} />
          Tabelle bei handball4all
        </a>
      ) : null}
      {g.meetingPoint || g.meetingTime ? (
        <p>
          <strong>Treffpunkt:</strong> {g.meetingPoint ?? "folgt"}
          {g.meetingTime ? `, ${g.meetingTime} Uhr` : ""}
        </p>
      ) : null}
      {g.coachNotes ? <p style={{ whiteSpace: "pre-wrap" }}>{g.coachNotes}</p> : null}
      {g.squadPublished ? <p class="small muted">Kader: {g.nominatedCount} nominiert</p> : <p class="small muted">Der Kader ist noch nicht veröffentlicht.</p>}
    </section>
  );
}

// Trainer ------------------------------------------------------------------------

function CoachView({ event, onChanged }: { event: EventDetail; onChanged: () => void }) {
  const parts = event.participants ?? [];
  const [moveOpen, setMoveOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [person, setPerson] = useState<ParticipantDetail | null>(null);
  const missed = parts.filter((p) => p.unexcused);
  const yes = parts.filter((p) => p.status === "yes" && !p.unexcused);
  const no = parts.filter((p) => p.status === "no");
  const away = parts.filter((p) => p.status === "standing" || p.status === "inactive");
  const open = parts.filter((p) => p.status === "open" && !p.unexcused);
  const grouped = event.teams.length > 1;
  const editable = !event.isPast;

  const refresh = () => {
    invalidate("/events");
    onChanged();
  };

  const remind = async (personIds?: number[]) => {
    const res = await api.post<{ sent: number; persons: number }>(`/events/${event.id}/remind`, personIds ? { personIds } : {});
    toast(res.sent ? `Erinnerung an ${res.persons} ${res.persons === 1 ? "Person" : "Personen"} gesendet.` : "Erinnert. Ohne aktivierte Push-Benachrichtigung kommt nichts an.");
  };

  const teamName = (teamId: number) => event.teams.find((t) => t.id === teamId)?.name ?? "";
  const nameFor = (p: ParticipantDetail) =>
    `${shortName(p.person)}${grouped ? ` (${(p.teamIds.length ? p.teamIds : [p.teamId]).map(teamName).join(" · ")})` : ""}${p.isHelper ? " · Aushilfe" : ""}`;

  return (
    <>
      <div class="stat-tiles" role="group" aria-label="Übersicht">
        <div class="stat-tile yellow">
          <div class="n">{yes.length}</div>
          <div class="l">nehmen teil</div>
        </div>
        <div class="stat-tile">
          <div class="n">{no.length}</div>
          <div class="l">abgesagt</div>
        </div>
        <div class="stat-tile">
          <div class="n">{parts.filter((p) => p.status === "standing").length}</div>
          <div class="l">abwesend</div>
        </div>
        <div class="stat-tile dark">
          <div class="n">{parts.filter((p) => p.status === "inactive").length}</div>
          <div class="l">inaktiv</div>
        </div>
      </div>

      {editable && !event.cancelled ? (
        <div class="grid-2" style={{ gridTemplateColumns: event.kind === "game" ? "repeat(2, minmax(0, 1fr))" : "repeat(3, minmax(0, 1fr))" }}>
          {event.kind === "game" ? (
            <>
              <a class="btn btn-primary" href={`/spiele/${event.id}/kader`}>
                Kader nominieren
              </a>
              <Button onClick={() => setInfoOpen(true)}>Treffpunkt & Infos</Button>
            </>
          ) : (
            <>
              <Button variant="primary" icon="bell" disabled={!open.length} onClick={() => remind()}>
                Erinnern
              </Button>
              {event.kind === "special" ? (
                <Button onClick={() => setEditOpen(true)}>Bearbeiten</Button>
              ) : (
                <Button onClick={() => setMoveOpen(true)}>Verschieben</Button>
              )}
              <Button variant="danger" onClick={() => setCancelOpen(true)}>
                Absagen
              </Button>
            </>
          )}
        </div>
      ) : null}
      {editable && event.cancelled && event.kind !== "game" ? (
        <Button
          onClick={async () => {
            await api.post(`/events/${event.id}/uncancel`);
            toast("Der Termin findet wieder statt.");
            refresh();
          }}
        >
          Absage zurücknehmen
        </Button>
      ) : null}
      {event.kind === "game" && editable && !event.cancelled ? (
        <Button variant="ghost" size="sm" icon="bell" disabled={!open.length} onClick={() => remind()}>
          Offene Rückmeldungen erinnern
        </Button>
      ) : null}

      {event.isPast && !event.cancelled && parts.length ? (
        <p class="small muted">Wer zugesagt oder sich nicht gemeldet hat und trotzdem gefehlt hat: Namen antippen und „Fehlt unentschuldigt“ wählen.</p>
      ) : null}

      {missed.length ? (
        <section class="card card-body" aria-label="Fehlt unentschuldigt">
          <h2 class="section-title" style={{ margin: 0 }}>
            Fehlt unentschuldigt · {missed.length}
          </h2>
          <div class="chips">
            {missed.map((p) => (
              <button type="button" class="chip" onClick={() => setPerson(p)}>
                {nameFor(p)}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {yes.length ? (
        <section class="card card-body" aria-label="Zugesagt">
          <h2 class="section-title" style={{ margin: 0 }}>
            Zugesagt · {yes.length}
          </h2>
          <div class="chips">
            {yes.map((p) => (
              <button type="button" class="chip" onClick={() => setPerson(p)}>
                {nameFor(p)}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {no.length ? (
        <section class="card card-body" aria-label="Abgesagt">
          <h2 class="section-title" style={{ margin: 0 }}>
            Abgesagt · {no.length}
          </h2>
          {no.map((p, i) => (
            <button
              type="button"
              class="stack-sm"
              style={{ border: 0, background: "none", textAlign: "left", padding: i ? "12px 0 0" : 0, borderTop: i ? "1px solid var(--line)" : 0 }}
              onClick={() => setPerson(p)}
            >
              <div class="row-gap" style={{ justifyContent: "space-between", width: "100%" }}>
                <strong style={{ fontSize: "17px" }}>{nameFor(p)}</strong>
                {p.isLate ? <span class="badge warn">Kurzfristig</span> : null}
              </div>
              {p.reason ? <div style={{ fontSize: "16px" }}>„{p.reason}“</div> : null}
              {p.respondedAt ? (
                <div class="small muted">
                  {stamp(p.respondedAt)} · {p.respondedBy === "guardian" ? `von ${p.respondedByName ?? "Elternteil"} (Elternteil)` : p.respondedBy === "self" ? "selbst" : (p.respondedByName ?? "")}
                </div>
              ) : null}
            </button>
          ))}
        </section>
      ) : null}

      {away.length ? (
        <section class="card card-body" aria-label="Abwesend">
          <h2 class="section-title" style={{ margin: 0 }}>
            Abwesend · {away.length}
          </h2>
          {away.map((p) => (
            <div class="row-gap" style={{ justifyContent: "space-between" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <strong style={{ color: p.status === "inactive" ? "var(--text-3)" : undefined }}>{nameFor(p)}</strong>
                <div class="small muted">{p.status === "inactive" ? "Inaktiv" : `Dauerhaft abwesend: ${weekdayPlural(weekdayOf(event.startsAt))}`}</div>
              </div>
              {p.status === "inactive" ? (
                <Button
                  size="sm"
                  onClick={async () => {
                    await api.post(`/persons/${p.person.id}/active`, { active: true });
                    toast(`${p.person.firstName} ist wieder aktiv.`);
                    refresh();
                  }}
                >
                  Aktivieren
                </Button>
              ) : (
                <Button size="sm" onClick={() => setPerson(p)}>
                  Ändern
                </Button>
              )}
            </div>
          ))}
        </section>
      ) : null}

      {open.length ? (
        <section class="card dark card-body" aria-label="Keine Rückmeldung">
          <h2 class="section-title" style={{ margin: 0, color: "var(--yellow)" }}>
            Keine Rückmeldung · {open.length}
          </h2>
          {open.map((p) => (
            <div class="row-gap" style={{ justifyContent: "space-between" }}>
              <button type="button" style={{ border: 0, background: "none", color: "#fff", fontWeight: 700, fontSize: "17px", padding: "6px 0", textAlign: "left" }} onClick={() => setPerson(p)}>
                {nameFor(p)}
              </button>
              {editable && !event.cancelled ? (
                <Button variant="accent" size="sm" onClick={() => remind([p.person.id])}>
                  Erinnern
                </Button>
              ) : null}
            </div>
          ))}
        </section>
      ) : null}

      {!parts.length ? (
        <Notice>{event.kind === "game" ? "Noch niemand nominiert." : "Für diesen Termin gibt es keine Teilnehmer."}</Notice>
      ) : null}

      <p class="small muted">
        Absagefrist: {event.deadlineHours} Stunden vor Beginn ({deadlineText(event)}).
        {event.ruleId == null && event.kind === "training" ? " Einzeltermin." : ""}
      </p>
      {event.kind === "special" && editable ? (
        <Button
          variant="ghost"
          icon="trash"
          onClick={async () => {
            if (!(await confirmDialog({ title: "Termin löschen?", message: "Der Termin und alle Rückmeldungen werden gelöscht.", confirmLabel: "Löschen", danger: true }))) return;
            await api.del(`/events/${event.id}`);
            invalidate("/events");
            toast("Termin gelöscht.");
            history.back();
          }}
        >
          Termin löschen
        </Button>
      ) : null}

      {moveOpen ? <MoveSheet event={event} onClose={() => setMoveOpen(false)} onDone={refresh} /> : null}
      {editOpen ? <EditSheet event={event} onClose={() => setEditOpen(false)} onDone={refresh} /> : null}
      {cancelOpen ? <CancelSheet event={event} onClose={() => setCancelOpen(false)} onDone={refresh} /> : null}
      {infoOpen ? <GameInfoSheet event={event} onClose={() => setInfoOpen(false)} onDone={refresh} /> : null}
      {person ? <ParticipantSheet event={event} p={person} onClose={() => setPerson(null)} onDone={refresh} /> : null}
    </>
  );
}

function CancelSheet({ event, onClose, onDone }: { event: EventDetail; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  return (
    <Sheet open onClose={onClose} title={`${KIND[event.kind]} absagen`}>
      <p class="muted">
        {longDate(event.startsAt)}, {time(event.startsAt)} Uhr. Alle Beteiligten werden benachrichtigt, im Mannschaftschat erscheint ein Hinweis.
      </p>
      <div class="chips">
        {["Halle belegt", "Trainer verhindert", "Ferien", "Zu wenige Zusagen"].map((r) => (
          <button type="button" class={`chip ${reason === r ? "selected" : ""}`} onClick={() => setReason(r)}>
            {r}
          </button>
        ))}
      </div>
      <TextField label="Grund" value={reason} onInput={setReason} maxLength={200} />
      <Button
        variant="danger-solid"
        size="lg"
        block
        disabled={!reason.trim()}
        onClick={async () => {
          // Rückfrage, weil Trainer „Absagen“ schon für die eigene Abwesenheit gehalten haben
          const what = event.kind === "training" ? "Trainingstermin" : "Termin";
          if (
            !(await confirmDialog({
              title: `${what} komplett für alle absagen?`,
              message: `Der ${what} fällt für alle aus und alle Beteiligten werden benachrichtigt. Wenn nur du verhindert bist, nicht absagen.`,
              confirmLabel: "Für alle absagen",
              danger: true,
            }))
          )
            return;
          await api.post(`/events/${event.id}/cancel`, { reason: reason.trim() });
          toast("Abgesagt. Alle wurden informiert.");
          onClose();
          onDone();
        }}
      >
        Absagen und informieren
      </Button>
    </Sheet>
  );
}

export function useLocations(forTraining = true) {
  return useQuery<{ locations: (LocationRef & { inUse: boolean })[] }>(forTraining ? "/locations" : "/locations?all=1");
}

/**
 * Sondertermin bearbeiten: Titel, Datum, Uhrzeit, Ort, Infos. Ändern sich Datum, Uhrzeit oder Ort,
 * benachrichtigt der Server alle Beteiligten; Titel und Infos werden still gespeichert.
 */
function EditSheet({ event, onClose, onDone }: { event: EventDetail; onClose: () => void; onDone: () => void }) {
  const { data } = useLocations();
  const [title, setTitle] = useState(event.title);
  const [date, setDate] = useState(event.startsAt.slice(0, 10));
  const [start, setStart] = useState(time(event.startsAt));
  const [end, setEnd] = useState(event.endsAt ? time(event.endsAt) : "");
  const [locationId, setLocationId] = useState<number | null>(event.location?.id ?? null);
  const [notes, setNotes] = useState(event.notes ?? "");
  const past = event.isPast;
  const moved = `${date}T${start}` !== event.startsAt || (end ? `${date}T${end}` : null) !== (event.endsAt ?? null) || locationId !== (event.location?.id ?? null);
  return (
    <Sheet open onClose={onClose} title="Termin bearbeiten">
      <TextField label="Titel" value={title} onInput={setTitle} maxLength={80} />
      {past ? (
        <p class="small muted">Der Termin hat schon begonnen, Datum, Uhrzeit und Ort lassen sich nicht mehr ändern.</p>
      ) : (
        <>
          <Field label="Datum">{(id) => <input id={id} class="input" type="date" value={date} onInput={(e) => setDate((e.target as HTMLInputElement).value)} />}</Field>
          <div class="grid-2">
            <Field label="Beginn">{(id) => <input id={id} class="input" type="time" value={start} onInput={(e) => setStart((e.target as HTMLInputElement).value)} />}</Field>
            <Field label="Ende (optional)">{(id) => <input id={id} class="input" type="time" value={end} onInput={(e) => setEnd((e.target as HTMLInputElement).value)} />}</Field>
          </div>
          <Field label="Ort (optional)">
            {(id) => (
              <select id={id} class="select" value={locationId ?? ""} onChange={(e) => setLocationId(Number((e.target as HTMLSelectElement).value) || null)}>
                <option value="">Kein Ort</option>
                {(data?.locations ?? []).map((l) => (
                  <option value={l.id}>{l.name}</option>
                ))}
              </select>
            )}
          </Field>
        </>
      )}
      <Field label="Infos (optional)">
        {(id) => <textarea id={id} class="textarea" value={notes} maxLength={1000} onInput={(e) => setNotes((e.target as HTMLTextAreaElement).value)} />}
      </Field>
      <p class="small muted">
        {moved ? "Datum, Uhrzeit oder Ort ändern sich: Alle Beteiligten werden benachrichtigt." : "Titel und Infos werden still gespeichert, ohne Benachrichtigung."}
      </p>
      <Button
        variant="primary"
        block
        disabled={!title.trim() || !date || !start}
        onClick={async () => {
          if (end && end <= start) {
            toast("Das Ende muss nach dem Beginn liegen.", "error");
            return;
          }
          const body: Record<string, unknown> = { title: title.trim(), notes: notes.trim() || null };
          if (!past) Object.assign(body, { startsAt: `${date}T${start}`, endsAt: end ? `${date}T${end}` : null, locationId });
          await api.patch(`/events/${event.id}`, body);
          toast(moved ? "Gespeichert, alle wurden informiert." : "Gespeichert.");
          onDone();
          onClose();
        }}
      >
        {moved ? "Speichern und informieren" : "Speichern"}
      </Button>
    </Sheet>
  );
}

function MoveSheet({ event, onClose, onDone }: { event: EventDetail; onClose: () => void; onDone: () => void }) {
  const { data } = useLocations();
  const [date, setDate] = useState(event.startsAt.slice(0, 10));
  const [start, setStart] = useState(time(event.startsAt));
  const [end, setEnd] = useState(time(event.endsAt));
  const [locationId, setLocationId] = useState<number | null>(event.location?.id ?? null);
  return (
    <Sheet open onClose={onClose} title="Termin verschieben">
      <p class="muted">Nur dieser eine Termin ändert sich, der Trainingsplan bleibt gleich. Alle Beteiligten werden benachrichtigt.</p>
      <Field label="Datum">{(id) => <input id={id} class="input" type="date" value={date} onInput={(e) => setDate((e.target as HTMLInputElement).value)} />}</Field>
      <div class="grid-2">
        <Field label="Beginn">{(id) => <input id={id} class="input" type="time" value={start} onInput={(e) => setStart((e.target as HTMLInputElement).value)} />}</Field>
        <Field label="Ende">{(id) => <input id={id} class="input" type="time" value={end} onInput={(e) => setEnd((e.target as HTMLInputElement).value)} />}</Field>
      </div>
      <Field label="Ort">
        {(id) => (
          <select id={id} class="select" value={locationId ?? ""} onChange={(e) => setLocationId(Number((e.target as HTMLSelectElement).value) || null)}>
            {(data?.locations ?? []).map((l) => (
              <option value={l.id}>{l.name}</option>
            ))}
          </select>
        )}
      </Field>
      <Button
        variant="primary"
        size="lg"
        block
        onClick={async () => {
          await api.patch(`/events/${event.id}`, { startsAt: `${date}T${start}`, endsAt: end ? `${date}T${end}` : null, locationId });
          toast("Termin verschoben.");
          onClose();
          onDone();
        }}
      >
        Speichern und informieren
      </Button>
    </Sheet>
  );
}

function GameInfoSheet({ event, onClose, onDone }: { event: EventDetail; onClose: () => void; onDone: () => void }) {
  const g = event.game!;
  const [meetingPoint, setMeetingPoint] = useState(g.meetingPoint ?? "");
  const [meetingTime, setMeetingTime] = useState(g.meetingTime ?? "");
  const [notes, setNotes] = useState(g.coachNotes ?? "");
  // Schnellauswahl: die Vereinshallen (meist Reinhold-Crocoll-Halle) und der Spielort
  const halls = useLocations(false).data?.locations.filter((l) => l.kind === "hall").map((l) => l.name) ?? [];
  const pointChoices = [...new Set([...halls, ...(event.location ? [event.location.name] : [])])];
  return (
    <Sheet open onClose={onClose} title="Treffpunkt & Infos">
      <p class="muted">Diese Angaben bleiben auch erhalten, wenn der Spielplan neu abgeglichen wird.</p>
      <TextField label="Treffpunkt" value={meetingPoint} onInput={setMeetingPoint} placeholder="z. B. Parkplatz Halle" maxLength={200} />
      {pointChoices.length ? (
        <div class="chips" role="group" aria-label="Treffpunkt wählen">
          {pointChoices.map((name) => (
            <button type="button" class={`chip ${meetingPoint === name ? "selected" : ""}`} aria-pressed={meetingPoint === name ? "true" : "false"} onClick={() => setMeetingPoint(name)}>
              {name}
            </button>
          ))}
        </div>
      ) : null}
      <Field label="Treffen um">{(id) => <input id={id} class="input" type="time" value={meetingTime} onInput={(e) => setMeetingTime((e.target as HTMLInputElement).value)} />}</Field>
      <Field label="Hinweise">
        {(id) => <textarea id={id} class="textarea" value={notes} maxLength={1000} onInput={(e) => setNotes((e.target as HTMLTextAreaElement).value)} />}
      </Field>
      <Button
        variant="primary"
        size="lg"
        block
        onClick={async () => {
          await api.patch(`/events/${event.id}`, { meetingPoint: meetingPoint.trim() || null, meetingTime: meetingTime || null, coachNotes: notes.trim() || null });
          toast("Gespeichert. Die Mannschaft wurde informiert.");
          onClose();
          onDone();
        }}
      >
        Speichern
      </Button>
    </Sheet>
  );
}

/** Trainer tragen eine Rückmeldung für Spieler ein, z. B. für Familien ohne App. */
function CoachResponse({ event, p, onDone }: { event: EventDetail; p: ParticipantDetail; onDone: () => void }) {
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  if (event.isPast || event.cancelled || p.status === "inactive") return null;
  if (p.status === "no") {
    return (
      <Button
        icon="check"
        onClick={async () => {
          await sendResponse(event, p.person.id, "yes");
          toast(`${p.person.firstName} ist wieder zugesagt.`);
          onDone();
        }}
      >
        Wieder zusagen
      </Button>
    );
  }
  if (!declining) {
    return (
      <div class="stack-sm">
        {p.status !== "yes" ? (
          <Button
            icon="check"
            onClick={async () => {
              await sendResponse(event, p.person.id, "yes");
              toast(`Zusage für ${p.person.firstName} eingetragen.`);
              onDone();
            }}
          >
            Zusagen
          </Button>
        ) : null}
        <Button icon="x" onClick={() => setDeclining(true)}>
          Diesen Termin absagen
        </Button>
      </div>
    );
  }
  return (
    <div class="field card card-pad" aria-label="Absage eintragen">
      <span class="field-label">Grund der Absage</span>
      <div class="chips" role="group" aria-label="Schnellauswahl">
        {QUICK_REASONS.map((r) => (
          <button type="button" class={`chip ${reason === r ? "selected" : ""}`} aria-pressed={reason === r ? "true" : "false"} onClick={() => setReason(r)}>
            {r}
          </button>
        ))}
      </div>
      <input class="input" aria-label="Grund" value={reason} maxLength={200} placeholder="z. B. Schulveranstaltung" onInput={(e) => setReason((e.target as HTMLInputElement).value)} />
      <div class="btn-row">
        <Button
          variant="primary"
          disabled={!reason.trim()}
          onClick={async () => {
            await sendResponse(event, p.person.id, "no", reason.trim());
            toast(`Absage für ${p.person.firstName} eingetragen.`);
            onDone();
          }}
        >
          Absage eintragen
        </Button>
        <Button variant="ghost" onClick={() => setDeclining(false)}>
          Abbrechen
        </Button>
      </div>
    </div>
  );
}

function ParticipantSheet({ event, p, onClose, onDone }: { event: EventDetail; p: ParticipantDetail; onClose: () => void; onDone: () => void }) {
  const wd = weekdayOf(event.startsAt);
  const teamId = p.teamId;
  return (
    <Sheet open onClose={onClose} title={personName(p.person)}>
      <div class="row-gap">
        <StatusPill status={p.status} late={p.isLate} />
        {p.isHelper ? <span class="badge muted">Aushilfe</span> : null}
        {p.unexcused ? <span class="badge warn">Fehlt unentschuldigt</span> : null}
      </div>
      {p.reason ? <p>„{p.reason}“</p> : null}
      {event.isPast && !event.cancelled && (p.unexcused || p.status === "yes" || p.status === "open") ? (
        <div class="list">
          <SwitchRow
            label="Fehlt unentschuldigt"
            sub="Nicht abgesagt und trotzdem nicht da. Sehen nur Trainer, die Person selbst und ihre Eltern."
            checked={p.unexcused}
            onChange={async (unexcused) => {
              await api.put(`/events/${event.id}/unexcused/${p.person.id}`, { unexcused });
              toast(unexcused ? `${p.person.firstName}: fehlt unentschuldigt.` : "Markierung entfernt.");
              onClose();
              onDone();
            }}
          />
        </div>
      ) : null}
      <CoachResponse
        event={event}
        p={p}
        onDone={() => {
          onClose();
          onDone();
        }}
      />
      {event.kind === "training" && event.ruleId != null ? (
        <div class="list">
          <SwitchRow
            label={`Dauerhaft abwesend (${weekdayPlural(wd)})`}
            sub="Gilt für alle Trainings dieser Trainingszeit. Einzelne Zusagen bleiben möglich."
            checked={p.hasStandingAbsence}
            onChange={async (active) => {
              await api.put(`/rules/${event.ruleId}/standing-absences/${p.person.id}`, { active });
              toast(active ? "Als dauerhaft abwesend markiert." : "Dauerabwesenheit entfernt.");
              onClose();
              onDone();
            }}
          />
        </div>
      ) : null}
      <div class="stack-sm">
        {p.status !== "inactive" ? (
          <Button
            onClick={async () => {
              if (
                !(await confirmDialog({
                  title: `${p.person.firstName} inaktiv setzen?`,
                  message: "Zum Beispiel bei Verletzung, Krankheit oder Schüleraustausch. Einen Grund speichert die App nicht. Für alle Termine gilt dann „abwesend (inaktiv)“, Erinnerungen entfallen.",
                  confirmLabel: "Inaktiv setzen",
                }))
              )
                return;
              await api.post(`/persons/${p.person.id}/active`, { active: false });
              toast(`${p.person.firstName} ist jetzt inaktiv.`);
              onClose();
              onDone();
            }}
          >
            Inaktiv setzen
          </Button>
        ) : null}
        {teamId ? (
          <a class="btn btn-ghost" href={`/team/${teamId}/person/${p.person.id}`}>
            Zur Person
          </a>
        ) : null}
      </div>
      {p.respondedAt ? <p class="small muted">Letzte Rückmeldung: {stamp(p.respondedAt)}</p> : null}
    </Sheet>
  );
}

/** Mannschaft mit „Zu- und Absagen für alle sichtbar“: wer kommt, wer nicht (ohne Gründe). */
function RosterList({ roster }: { roster: RosterEntry[] }) {
  const groups: { title: string; items: RosterEntry[] }[] = [
    { title: "Zugesagt", items: roster.filter((r) => r.status === "yes") },
    { title: "Abgesagt", items: roster.filter((r) => r.status === "no") },
    { title: "Offen", items: roster.filter((r) => r.status === "open") },
    { title: "Abwesend", items: roster.filter((r) => r.status === "standing" || r.status === "inactive") },
  ].filter((g) => g.items.length);
  return (
    <section class="card card-body stack-sm" aria-label="Wer kommt">
      <h2 class="section-title" style={{ margin: 0 }}>
        Wer kommt
      </h2>
      {groups.map((g) => (
        <div>
          <div class="small muted" style={{ fontWeight: 700 }}>
            {g.title} · {g.items.length}
          </div>
          <div>{g.items.map((r) => r.name).join(", ")}</div>
        </div>
      ))}
    </section>
  );
}

/**
 * Sondertermin: Hinweis auf eigene Dienste bzw. offene Plätze. Trainer, Ersteller und Organisatoren legen
 * Zeitblöcke an; Trainer, Admins und der Ersteller ordnen Organisatoren zu.
 */
function SpecialHelpers({ event, onChanged }: { event: EventDetail; onChanged: () => void }) {
  const me = useMe();
  const { refresh: refreshSession } = useSession();
  const [adding, setAdding] = useState(false);
  const [addOrganizer, setAddOrganizer] = useState(false);
  const inHelperTab = event.teams.some((t) => me.helperTeams.some((h) => h.id === t.id));
  const text = event.myDuties.length ? dutyLines(event.myDuties).join(" · ") : event.helpersNeeded ? neededText(event.helpersNeeded) : null;
  const org = event.organizers;
  const showOrganizers = !!org && (org.editable || event.dutyManage || org.people.length > 0);
  if (!text && !event.dutyManage && !showOrganizers) return null;
  return (
    <section class="card card-pad stack-sm" aria-label="Helfer">
      {text ? (
        <a class="ext-link" href="/helfer">
          <Icon name="helping" size={16} />
          Helferplan · {text}
        </a>
      ) : null}
      {event.dutyManage ? (
        <>
          {inHelperTab && !text ? (
            <a class="ext-link" href="/helfer">
              <Icon name="helping" size={16} />
              Helferdienste im Reiter Helfer verwalten
            </a>
          ) : null}
          <Button size="sm" variant="dashed" icon="plus" onClick={() => setAdding(true)}>
            Helfer: Zeitblock hinzufügen
          </Button>
        </>
      ) : null}
      {showOrganizers && org ? (
        <div class="stack-sm" aria-label="Organisatoren" role="group">
          <strong>Organisatoren</strong>
          <ul class="list">
            {org.creator ? (
              <li class="list-row">
                <span class="main">
                  <span class="title">{org.creator.name}</span>
                  <span class="sub">hat den Termin angelegt</span>
                </span>
              </li>
            ) : null}
            {org.people.map((p) => (
              <li class="list-row">
                <span class="main">
                  <span class="title">{p.name}</span>
                </span>
                {org.editable ? (
                  <button
                    type="button"
                    class="icon-btn icon-btn-sm"
                    aria-label={`${p.name} als Organisator entfernen`}
                    onClick={async () => {
                      await api.del(`/events/${event.id}/organizers/${p.id}`);
                      toast(`${p.name} ist kein Organisator mehr.`);
                      onChanged();
                    }}
                  >
                    <Icon name="x" size={16} />
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
          <p class="small muted">Organisatoren verwalten die Helferdienste dieses Termins.</p>
          {org.editable ? (
            <Button size="sm" variant="dashed" icon="plus" onClick={() => setAddOrganizer(true)}>
              Organisator hinzufügen
            </Button>
          ) : null}
        </div>
      ) : null}
      {adding ? (
        <BlockSheet
          date={event.startsAt.slice(0, 10)}
          start={event.startsAt.slice(11, 16)}
          eventEnd={event.endsAt}
          allowNewType
          onClose={() => setAdding(false)}
          onSave={async (b) => {
            await api.post(`/duties/events/${event.id}/blocks`, {
              ...(b.newTypeName ? { newTypeName: b.newTypeName } : { dutyTypeId: b.dutyTypeId }),
              startsAt: b.startsAt,
              endsAt: b.endsAt,
              slots: b.slots,
            });
            toast(`Zeitblock ${b.label} hinzugefügt. Er steht jetzt im Reiter Helfer.`);
            invalidate("/duties");
            void refreshSession();
            onChanged();
          }}
        />
      ) : null}
      {addOrganizer ? <OrganizerSheet eventId={event.id} onClose={() => setAddOrganizer(false)} onDone={onChanged} /> : null}
    </section>
  );
}

/** Organisator suchen: ordentliche Mitglieder mit Zugang, ohne Eingabe die der beteiligten Mannschaften. */
function OrganizerSheet({ eventId, onClose, onDone }: { eventId: number; onClose: () => void; onDone: () => void }) {
  const [search, setSearch] = useState("");
  const q = search.trim();
  const people = useQuery<{ people: { personId: number; name: string; teams?: string | null }[] }>(
    `/duties/events/${eventId}/people?account=1${q.length >= 2 ? `&q=${encodeURIComponent(q)}` : ""}`,
  );
  const needle = q.toLowerCase();
  const list = (people.data?.people ?? []).filter((p) => q.length >= 2 || !needle || p.name.toLowerCase().includes(needle));
  return (
    <Sheet open onClose={onClose} title="Organisator hinzufügen">
      <TextField label="Name suchen" value={search} onInput={setSearch} maxLength={60} hint="Ordentliche Mitglieder mit Zugang zur App. Ab 2 Buchstaben: alle im Verein." />
      <ul class="list" aria-label="Personen">
        {list.slice(0, 30).map((p) => (
          <li>
            <button
              type="button"
              class="list-row"
              onClick={async () => {
                try {
                  await api.post(`/events/${eventId}/organizers`, { personId: p.personId });
                  toast(`${p.name} organisiert jetzt mit.`);
                  onDone();
                  onClose();
                } catch (err) {
                  toast(errorMessage(err), "error");
                }
              }}
            >
              <span class="main">
                <span class="title">{p.name}</span>
                {p.teams ? <span class="sub">{p.teams}</span> : null}
              </span>
              <Icon name="plus" size={18} />
            </button>
          </li>
        ))}
      </ul>
      {people.data && !list.length ? <p class="small muted">Niemand gefunden.</p> : null}
    </Sheet>
  );
}
