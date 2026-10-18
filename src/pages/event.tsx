import { plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useState } from "preact/hooks";
import type { EventDetail, LocationRef, MyParticipation, ParticipantDetail, RosterEntry } from "../../shared/types";
import { api, errorMessage } from "../api";
import { CarpoolCard } from "../carpool";
import { dutyLines, neededText } from "../duties";
import { BlockSheet } from "../duty-blocks";
import { longDate, personName, shortName, stamp, time, timeRange, weekdayPlural } from "../format";
import { Icon } from "../icons";
import { GameReportLink, isLiveWindow, isReportWindow, LiveTickerLink } from "../live";
import { byGuardianText, DeclineSheet, deadlineText, PersonResponseRow, quickReasons, ResponseButtons, respondedByText, sendResponse } from "../respond";
import { useMe, useSession } from "../session";
import { invalidate, useQuery } from "../store";
import { Button, confirmDialog, copyText, ErrorBox, Field, Notice, Segmented, Sheet, Spinner, StatusPill, SwitchRow, TextField, toast, useDocumentTitle } from "../ui";

const kindLabel = (kind: EventDetail["kind"]) => ({ training: t`Training`, game: t`Game`, special: t`Event` })[kind];

function weekdayOf(local: string): number {
  const [y, m, d] = local.slice(0, 10).split("-").map(Number) as [number, number, number];
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return wd === 0 ? 7 : wd;
}

/**
 * Link that opens the device's maps or navigation app: on iPhone/iPad Apple
 * Maps, on Android the choice of installed apps (geo:), otherwise Google Maps in the browser.
 */
/** Reason or other free text in quotation marks of the app's language. */
function quoted(text: string): string {
  return t`“${text}”`;
}

function permanentlyAbsent(weekdays: string): string {
  return t`Permanently absent: ${weekdays}`;
}

function lastResponse(when: string): string {
  return t`Last response: ${when}`;
}

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
  const name = location.name;
  const content = (
    <>
      <Icon name="pin" size={18} />
      {location.name}
    </>
  );
  return href ? (
    <a href={href} target={href.startsWith("http") ? "_blank" : undefined} rel="noopener noreferrer" style={{ textUnderlineOffset: "3px" }} aria-label={t`${name}, open in the maps app`}>
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
  useDocumentTitle(event ? `${kindLabel(event.kind)} ${longDate(event.startsAt)}` : t`Event`);

  if (loading) return <Spinner />;
  if (error || !event) {
    return (
      <main class="page">
        <header class="topbar">
          <a class="icon-btn" href="/" aria-label={t`Back`}>
            <Icon name="back" size={24} />
          </a>
          <h1>
            <Trans>Event</Trans>
          </h1>
        </header>
        <div class="content">
          <ErrorBox error={error} onRetry={reload} />
        </div>
      </main>
    );
  }

  const mine = event.mine.filter((m) => m.participant || m.helpRequest || event.kind === "game");
  const single = mine.length === 1 && mine[0]!.person.id === me.person.id ? mine[0]! : null;
  const cancelledBy = event.cancelled?.byName;
  const myReason = single?.reason;
  const deadline = deadlineText(event);
  const hours = event.deadlineHours;

  return (
    <main class="page">
      <header class="hero" style={{ paddingTop: "calc(14px + var(--safe-top))" }}>
        <div class="hero-top">
          <button type="button" class="icon-btn" aria-label={t`Back`} onClick={() => (history.length > 1 ? history.back() : location.assign("/"))} style={{ marginLeft: "-12px" }}>
            <Icon name="back" size={24} stroke={2.2} />
          </button>
          <div class="row-gap" style={{ gap: "6px" }}>
            {event.clubWide ? <span class="team-badge">
                <Trans>Club</Trans>
              </span> : event.teams.map((t) => <span class="team-badge">{t.name}</span>)}
            {event.isDetached && event.kind === "training" ? <span class="team-badge outline">
                <Trans>changed</Trans>
              </span> : null}
          </div>
        </div>
        <div class="kicker">{event.kind === "special" ? event.title : kindLabel(event.kind)}</div>
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
              <strong>{cancelledBy ? t`Cancelled by ${cancelledBy}.` : t`Cancelled.`}</strong>
              {event.cancelled.reason ? ` ${event.cancelled.reason}` : ""}
            </div>
          </div>
        ) : null}

        {event.kind === "game" && event.game ? <GameInfo event={event} /> : null}
        {event.kind === "special" && !event.isPast && !event.cancelled && event.teams.length ? <SpecialHelpers event={event} onChanged={reload} /> : null}
        {event.notes ? (
          <div class="card card-pad">
            <div class="small muted" style={{ fontWeight: 700 }}>
              <Trans>INFO</Trans>
            </div>
            <p style={{ whiteSpace: "pre-wrap" }}>{event.notes}</p>
          </div>
        ) : null}

        {mine.length ? (
          <section class="card card-body" aria-label={t`Your response`}>
            <h2 class="section-title" style={{ margin: 0 }}>
              {single ? t`Your response` : t`Responses`}
            </h2>
            {single && !single.helpRequest ? (
              <>
                <div class="row-gap">
                  <StatusPill status={single.status} late={single.isLate} nominated={single.nominated} game={event.kind === "game"} optional={single.optional} />
                  {single.unexcused ? (
                    <span class="badge warn">
                      <Trans>Missed without excuse</Trans>
                    </span>
                  ) : null}
                  {single.respondedAt && respondedByText(single, me.person.id) ? (
                    <span class="small muted">
                      {respondedByText(single, me.person.id)}, {stamp(single.respondedAt)}
                    </span>
                  ) : null}
                </div>
                {event.kind === "game" && !single.participant ? (
                  <p class="muted">
                    <Trans>You are not nominated for this game.</Trans>
                  </p>
                ) : null}
                <ResponseButtons event={event} p={single} onDecline={setDeclineFor} />
                {single.status === "no" && myReason ? (
                  <p class="small muted">
                    <Trans>Your reason: “{myReason}”</Trans>
                  </p>
                ) : null}
              </>
            ) : (
              mine.map((m) => <PersonResponseRow key={m.person.id} event={event} p={m} onDecline={setDeclineFor} />)
            )}
            {event.deadline && !event.isPast && !event.cancelled && mine.some((m) => m.participant) ? (
              <p class="small muted">
                <Trans>Please decline in good time, by {deadline} ({hours} hrs before), so your coaches can plan better.</Trans>
              </p>
            ) : null}
          </section>
        ) : null}

        {event.carpool ? <CarpoolCard event={event} carpool={event.carpool} onChanged={reload} /> : null}

        {event.counts && !event.participants ? (
          <section class="stats" aria-label={t`Team responses`}>
            <div class="stat" style={{ background: "var(--card)" }}>
              <div class="n">{event.counts.yes}</div>
              <div class="l">
                <Trans>Taking part</Trans>
              </div>
            </div>
            <div class="stat" style={{ background: "var(--card)" }}>
              <div class="n">{event.counts.no + event.counts.standing}</div>
              <div class="l">
                <Trans>Declines</Trans>
              </div>
            </div>
            <div class="stat" style={{ background: "var(--card)" }}>
              <div class="n">{event.counts.inactive}</div>
              <div class="l">
                <Trans>Inactive</Trans>
              </div>
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
  const gameNo = g.gameNo;
  const text = event.myDuties.length ? dutyLines(event.myDuties).join(" · ") : event.helpersNeeded ? neededText(event.helpersNeeded) : null;
  const point = g.meetingPoint ?? t`to follow`;
  const meetTime = g.meetingTime;
  const count = g.nominatedCount;
  return (
    <section class="card card-pad stack-sm" aria-label={t`Game info`}>
      <div class="row-gap" style={{ justifyContent: "space-between" }}>
        <span class="badge outline">{g.isHome ? t`Home game` : g.isHome === false ? t`Away game` : t`Game`}</span>
        {gameNo ? (
          <span class="small muted">
            <Trans>Game no. {gameNo}</Trans>
          </span>
        ) : null}
      </div>
      <div style={{ fontWeight: 700, fontSize: "17px" }}>
        {g.homeTeam} – {g.guestTeam}
        {result ? <span style={{ marginLeft: "8px", fontFamily: "var(--font-cond)", fontSize: "22px" }}>{result}</span> : null}
      </div>
      {isLiveWindow(event) ? <LiveTickerLink event={event} /> : isReportWindow(event) ? <GameReportLink event={event} /> : null}
      {event.location?.address ? (
        <p class="small muted row-gap" style={{ gap: "6px", alignItems: "center" }}>
          <span>{event.location.address}</span>
          <button type="button" class="icon-btn icon-btn-sm" aria-label={t`Copy address`} onClick={() => copyText(event.location!.address!, t`Address copied.`)}>
            <Icon name="copy" size={16} />
          </button>
        </p>
      ) : null}
      {helperPlan && !event.isPast ? (
        <a class="ext-link" href="/helfer">
          <Icon name="helping" size={16} />
          {text ? t`Helper plan · ${text}` : t`Helper plan: duties for this game`}
        </a>
      ) : null}
      {g.tableUrl ? (
        <a class="ext-link" href={g.tableUrl} target="_blank" rel="noopener noreferrer">
          <Icon name="link" size={16} />
          <Trans>Table on handball4all</Trans>
        </a>
      ) : null}
      {g.meetingPoint || g.meetingTime ? (
        <p>
          {meetTime ? (
            <Trans>
              <strong>Meeting point:</strong> {point}, {meetTime}
            </Trans>
          ) : (
            <Trans>
              <strong>Meeting point:</strong> {point}
            </Trans>
          )}
        </p>
      ) : null}
      {g.coachNotes ? <p style={{ whiteSpace: "pre-wrap" }}>{g.coachNotes}</p> : null}
      {g.squadPublished ? (
        <p class="small muted">
          <Trans>Squad: {count} nominated</Trans>
        </p>
      ) : (
        <p class="small muted">
          <Trans>The squad has not been published yet.</Trans>
        </p>
      )}
    </section>
  );
}

// Coaches ------------------------------------------------------------------------

function CoachView({ event, onChanged }: { event: EventDetail; onChanged: () => void }) {
  const parts = event.participants ?? [];
  const [moveOpen, setMoveOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [person, setPerson] = useState<ParticipantDetail | null>(null);
  const missed = parts.filter((p) => p.unexcused);
  const yes = parts.filter((p) => p.status === "yes" && !p.unexcused);
  const no = parts.filter((p) => p.status === "no" && !p.optional);
  const away = parts.filter((p) => p.status === "standing" || p.status === "inactive");
  const open = parts.filter((p) => p.status === "open" && !p.unexcused && !p.optional);
  // Optional training: who could join but has not accepted (not missing, no reminder)
  const optionalOut = parts.filter((p) => p.optional && (p.status === "open" || p.status === "no"));
  const grouped = event.teams.length > 1;
  const editable = !event.isPast;
  const deadline = deadlineText(event);
  const hours = event.deadlineHours;

  const refresh = () => {
    invalidate("/events");
    onChanged();
  };

  const remind = async (personIds?: number[]) => {
    const res = await api.post<{ sent: number; persons: number }>(`/events/${event.id}/remind`, personIds ? { personIds } : {});
    const persons = res.persons;
    toast(
      res.sent
        ? plural(persons, { one: "Reminder sent to # person.", other: "Reminder sent to # people." })
        : t`Reminded. Without push notifications switched on, nothing arrives.`,
    );
  };

  const teamName = (teamId: number) => event.teams.find((t) => t.id === teamId)?.name ?? "";
  const nameFor = (p: ParticipantDetail) =>
    `${shortName(p.person)}${grouped ? ` (${(p.teamIds.length ? p.teamIds : [p.teamId]).map(teamName).join(" · ")})` : ""}${p.isHelper ? ` · ${t`Stand-in`}` : ""}`;

  return (
    <>
      <div class="stat-tiles" role="group" aria-label={t`Overview`}>
        <div class="stat-tile yellow">
          <div class="n">{yes.length}</div>
          <div class="l">
            <Trans>taking part</Trans>
          </div>
        </div>
        <div class="stat-tile">
          <div class="n">{no.length}</div>
          <div class="l">
            <Trans>declined</Trans>
          </div>
        </div>
        <div class="stat-tile">
          <div class="n">{parts.filter((p) => p.status === "standing").length}</div>
          <div class="l">
            <Trans>absent</Trans>
          </div>
        </div>
        <div class="stat-tile dark">
          <div class="n">{parts.filter((p) => p.status === "inactive").length}</div>
          <div class="l">
            <Trans>inactive</Trans>
          </div>
        </div>
      </div>

      {editable && !event.cancelled ? (
        <div class="grid-2" style={{ gridTemplateColumns: event.kind === "game" ? "repeat(2, minmax(0, 1fr))" : "repeat(3, minmax(0, 1fr))" }}>
          {event.kind === "game" ? (
            <>
              <a class="btn btn-primary" href={`/spiele/${event.id}/kader`}>
                <Trans>Nominate squad</Trans>
              </a>
              <Button onClick={() => setInfoOpen(true)}>
                <Trans>Meeting point & info</Trans>
              </Button>
            </>
          ) : (
            <>
              <Button variant="primary" icon="bell" disabled={!open.length} onClick={() => remind()}>
                <Trans>Remind</Trans>
              </Button>
              {event.kind === "special" ? (
                <Button onClick={() => setEditOpen(true)}>
                  <Trans>Edit</Trans>
                </Button>
              ) : (
                <Button onClick={() => setMoveOpen(true)}>
                  <Trans>Move</Trans>
                </Button>
              )}
              <Button variant="danger" onClick={() => setCancelOpen(true)}>
                <Trans context="cancel event">Cancel</Trans>
              </Button>
            </>
          )}
        </div>
      ) : null}
      {editable && event.cancelled && event.kind !== "game" ? (
        <Button
          onClick={async () => {
            await api.post(`/events/${event.id}/uncancel`);
            toast(t`The event is back on.`);
            refresh();
          }}
        >
          <Trans>Undo cancellation</Trans>
        </Button>
      ) : null}
      {event.kind === "game" && editable && !event.cancelled ? (
        <Button variant="ghost" size="sm" icon="bell" disabled={!open.length} onClick={() => remind()}>
          <Trans>Remind missing responses</Trans>
        </Button>
      ) : null}

      {event.isPast && !event.cancelled && parts.length ? (
        <p class="small muted">
          <Trans>Anyone who accepted or did not respond and still missed it: tap the name and choose “Absent without excuse”.</Trans>
        </p>
      ) : null}

      {missed.length ? (
        <section class="card card-body" aria-label={t`Absent without excuse`}>
          <h2 class="section-title" style={{ margin: 0 }}>
            <Trans>Absent without excuse</Trans> · {missed.length}
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
        <section class="card card-body" aria-label={t`Accepted`}>
          <h2 class="section-title" style={{ margin: 0 }}>
            <Trans>Accepted</Trans> · {yes.length}
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
        <section class="card card-body" aria-label={t`Declined`}>
          <h2 class="section-title" style={{ margin: 0 }}>
            <Trans>Declined</Trans> · {no.length}
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
                {p.isLate ? (
                  <span class="badge warn">
                    <Trans>Short notice</Trans>
                  </span>
                ) : null}
              </div>
              {p.reason ? <div style={{ fontSize: "16px" }}>{quoted(p.reason)}</div> : null}
              {p.respondedAt ? (
                <div class="small muted">
                  {stamp(p.respondedAt)} · {p.respondedBy === "guardian" ? byGuardianText(p.respondedByName) : p.respondedBy === "self" ? t`themselves` : (p.respondedByName ?? "")}
                </div>
              ) : null}
            </button>
          ))}
        </section>
      ) : null}

      {away.length ? (
        <section class="card card-body" aria-label={t`Absent`}>
          <h2 class="section-title" style={{ margin: 0 }}>
            <Trans>Absent</Trans> · {away.length}
          </h2>
          {away.map((p) => (
            <div class="row-gap" style={{ justifyContent: "space-between" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <strong style={{ color: p.status === "inactive" ? "var(--text-3)" : undefined }}>{nameFor(p)}</strong>
                <div class="small muted">{p.status === "inactive" ? t`Inactive` : permanentlyAbsent(weekdayPlural(weekdayOf(event.startsAt)))}</div>
              </div>
              {p.status === "inactive" ? (
                <Button
                  size="sm"
                  onClick={async () => {
                    await api.post(`/persons/${p.person.id}/active`, { active: true });
                    const name = p.person.firstName;
                    toast(t`${name} is active again.`);
                    refresh();
                  }}
                >
                  <Trans>Activate</Trans>
                </Button>
              ) : (
                <Button size="sm" onClick={() => setPerson(p)}>
                  <Trans>Change</Trans>
                </Button>
              )}
            </div>
          ))}
        </section>
      ) : null}

      {open.length ? (
        <section class="card dark card-body" aria-label={t`No response`}>
          <h2 class="section-title" style={{ margin: 0, color: "var(--yellow)" }}>
            <Trans>No response</Trans> · {open.length}
          </h2>
          {open.map((p) => (
            <div class="row-gap" style={{ justifyContent: "space-between" }}>
              <button type="button" style={{ border: 0, background: "none", color: "#fff", fontWeight: 700, fontSize: "17px", padding: "6px 0", textAlign: "left" }} onClick={() => setPerson(p)}>
                {nameFor(p)}
              </button>
              {editable && !event.cancelled ? (
                <Button variant="accent" size="sm" onClick={() => remind([p.person.id])}>
                  <Trans>Remind</Trans>
                </Button>
              ) : null}
            </div>
          ))}
        </section>
      ) : null}

      {optionalOut.length ? (
        <section class="card card-body" aria-label={t`Optional, not joining`}>
          <h2 class="section-title" style={{ margin: 0 }}>
            <Trans>Optional, not joining</Trans> · {optionalOut.length}
          </h2>
          <p class="small muted">
            <Trans>They may join this training if they want to. Nobody counts as missing.</Trans>
          </p>
          <div class="chips">
            {optionalOut.map((p) => (
              <button type="button" class="chip" onClick={() => setPerson(p)}>
                {nameFor(p)}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {event.kind === "training" && grouped && editable && !event.cancelled ? <JoiningTeams event={event} onChanged={refresh} /> : null}

      {!parts.length ? (
        <Notice>{event.kind === "game" ? t`Nobody nominated yet.` : t`There are no participants for this event.`}</Notice>
      ) : null}

      <p class="small muted">
        <Trans>Decline deadline: {hours} hours before the start ({deadline}).</Trans>
        {event.ruleId == null && event.kind === "training" ? ` ${t`One-off event.`}` : ""}
      </p>
      {event.kind === "special" && editable ? (
        <Button
          variant="ghost"
          icon="trash"
          onClick={async () => {
            if (!(await confirmDialog({ title: t`Delete event?`, message: t`The event and all responses will be deleted.`, confirmLabel: t`Delete`, danger: true }))) return;
            await api.del(`/events/${event.id}`);
            invalidate("/events");
            toast(t`Event deleted.`);
            history.back();
          }}
        >
          <Trans>Delete event</Trans>
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
  const date = longDate(event.startsAt);
  const clock = time(event.startsAt);
  const title = event.kind === "training" ? t`Cancel training` : event.kind === "game" ? t`Cancel game` : t`Cancel event`;
  return (
    <Sheet open onClose={onClose} title={title}>
      <p class="muted">
        <Trans>{date}, {clock}. Everyone involved will be notified, and a note appears in the team chat.</Trans>
      </p>
      <div class="chips">
        {[t`Hall unavailable`, t`Coach unavailable`, t`School holidays`, t`Too few acceptances`].map((r) => (
          <button type="button" class={`chip ${reason === r ? "selected" : ""}`} onClick={() => setReason(r)}>
            {r}
          </button>
        ))}
      </div>
      <TextField label={t`Reason`} value={reason} onInput={setReason} maxLength={200} />
      <Button
        variant="danger-solid"
        size="lg"
        block
        disabled={!reason.trim()}
        onClick={async () => {
          // Ask again, because coaches have mistaken "Cancel" for reporting their own absence
          const training = event.kind === "training";
          if (
            !(await confirmDialog({
              title: training ? t`Cancel this training session for everyone?` : t`Cancel this event for everyone?`,
              message: training
                ? t`The training session is off for everyone and everyone involved will be notified. If only you cannot make it, do not cancel.`
                : t`The event is off for everyone and everyone involved will be notified. If only you cannot make it, do not cancel.`,
              confirmLabel: t`Cancel for everyone`,
              danger: true,
            }))
          )
            return;
          await api.post(`/events/${event.id}/cancel`, { reason: reason.trim() });
          toast(t`Cancelled. Everyone has been informed.`);
          onClose();
          onDone();
        }}
      >
        <Trans>Cancel and inform</Trans>
      </Button>
    </Sheet>
  );
}

export function useLocations(forTraining = true) {
  return useQuery<{ locations: (LocationRef & { inUse: boolean })[] }>(forTraining ? "/locations" : "/locations?all=1");
}

/**
 * Edit a special event: title, date, time, location, info. If date, time or location change,
 * the server notifies everyone involved; title and info are saved quietly.
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
    <Sheet open onClose={onClose} title={t`Edit event`}>
      <TextField label={t`Title`} value={title} onInput={setTitle} maxLength={80} />
      {past ? (
        <p class="small muted">
          <Trans>The event has already started, date, time and venue can no longer be changed.</Trans>
        </p>
      ) : (
        <>
          <Field label={t`Date`}>{(id) => <input id={id} class="input" type="date" value={date} onInput={(e) => setDate((e.target as HTMLInputElement).value)} />}</Field>
          <div class="grid-2">
            <Field label={t`Start time`}>{(id) => <input id={id} class="input" type="time" value={start} onInput={(e) => setStart((e.target as HTMLInputElement).value)} />}</Field>
            <Field label={t`End time (optional)`}>{(id) => <input id={id} class="input" type="time" value={end} onInput={(e) => setEnd((e.target as HTMLInputElement).value)} />}</Field>
          </div>
          <Field label={t`Venue (optional)`}>
            {(id) => (
              <select id={id} class="select" value={locationId ?? ""} onChange={(e) => setLocationId(Number((e.target as HTMLSelectElement).value) || null)}>
                <option value="">{t`No venue`}</option>
                {(data?.locations ?? []).map((l) => (
                  <option value={l.id}>{l.name}</option>
                ))}
              </select>
            )}
          </Field>
        </>
      )}
      <Field label={t`Info (optional)`}>
        {(id) => <textarea id={id} class="textarea" value={notes} maxLength={1000} onInput={(e) => setNotes((e.target as HTMLTextAreaElement).value)} />}
      </Field>
      <p class="small muted">
        {moved ? t`Date, time or venue change: everyone involved will be notified.` : t`Title and info are saved quietly, without notification.`}
      </p>
      <Button
        variant="primary"
        block
        disabled={!title.trim() || !date || !start}
        onClick={async () => {
          if (end && end <= start) {
            toast(t`The end must be after the start.`, "error");
            return;
          }
          const body: Record<string, unknown> = { title: title.trim(), notes: notes.trim() || null };
          if (!past) Object.assign(body, { startsAt: `${date}T${start}`, endsAt: end ? `${date}T${end}` : null, locationId });
          await api.patch(`/events/${event.id}`, body);
          toast(moved ? t`Saved, everyone has been informed.` : t`Saved.`);
          onDone();
          onClose();
        }}
      >
        {moved ? t`Save and inform` : t`Save`}
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
    <Sheet open onClose={onClose} title={t`Move event`}>
      <p class="muted">
        <Trans>Only this one event changes, the training schedule stays the same. Everyone involved will be notified.</Trans>
      </p>
      <Field label={t`Date`}>{(id) => <input id={id} class="input" type="date" value={date} onInput={(e) => setDate((e.target as HTMLInputElement).value)} />}</Field>
      <div class="grid-2">
        <Field label={t`Start time`}>{(id) => <input id={id} class="input" type="time" value={start} onInput={(e) => setStart((e.target as HTMLInputElement).value)} />}</Field>
        <Field label={t`End time`}>{(id) => <input id={id} class="input" type="time" value={end} onInput={(e) => setEnd((e.target as HTMLInputElement).value)} />}</Field>
      </div>
      <Field label={t`Venue`}>
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
          toast(t`Event moved.`);
          onClose();
          onDone();
        }}
      >
        <Trans>Save and inform</Trans>
      </Button>
    </Sheet>
  );
}

function GameInfoSheet({ event, onClose, onDone }: { event: EventDetail; onClose: () => void; onDone: () => void }) {
  const g = event.game!;
  const [meetingPoint, setMeetingPoint] = useState(g.meetingPoint ?? "");
  const [meetingTime, setMeetingTime] = useState(g.meetingTime ?? "");
  const [notes, setNotes] = useState(g.coachNotes ?? "");
  // Quick selection: the club's halls and the game venue
  const halls = useLocations(false).data?.locations.filter((l) => l.kind === "hall").map((l) => l.name) ?? [];
  const pointChoices = [...new Set([...halls, ...(event.location ? [event.location.name] : [])])];
  return (
    <Sheet open onClose={onClose} title={t`Meeting point & info`}>
      <p class="muted">
        <Trans>These details are kept even when the fixture list is synced again.</Trans>
      </p>
      <TextField label={t`Meeting point`} value={meetingPoint} onInput={setMeetingPoint} placeholder={t`e.g. hall car park`} maxLength={200} />
      {pointChoices.length ? (
        <div class="chips" role="group" aria-label={t`Choose meeting point`}>
          {pointChoices.map((name) => (
            <button type="button" class={`chip ${meetingPoint === name ? "selected" : ""}`} aria-pressed={meetingPoint === name ? "true" : "false"} onClick={() => setMeetingPoint(name)}>
              {name}
            </button>
          ))}
        </div>
      ) : null}
      <Field label={t`Meet at`}>{(id) => <input id={id} class="input" type="time" value={meetingTime} onInput={(e) => setMeetingTime((e.target as HTMLInputElement).value)} />}</Field>
      <Field label={t`Notes`}>
        {(id) => <textarea id={id} class="textarea" value={notes} maxLength={1000} onInput={(e) => setNotes((e.target as HTMLTextAreaElement).value)} />}
      </Field>
      <Button
        variant="primary"
        size="lg"
        block
        onClick={async () => {
          await api.patch(`/events/${event.id}`, { meetingPoint: meetingPoint.trim() || null, meetingTime: meetingTime || null, coachNotes: notes.trim() || null });
          toast(t`Saved. The team has been informed.`);
          onClose();
          onDone();
        }}
      >
        <Trans>Save</Trans>
      </Button>
    </Sheet>
  );
}

/** Coaches enter a response for players, e.g. for families without the app. */
function CoachResponse({ event, p, onDone }: { event: EventDetail; p: ParticipantDetail; onDone: () => void }) {
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const name = p.person.firstName;
  if (event.isPast || event.cancelled || p.status === "inactive") return null;
  if (p.status === "no") {
    return (
      <Button
        icon="check"
        onClick={async () => {
          await sendResponse(event, p.person.id, "yes");
          toast(t`${name} is accepted again.`);
          onDone();
        }}
      >
        <Trans>Accept again</Trans>
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
              toast(t`Acceptance entered for ${name}.`);
              onDone();
            }}
          >
            <Trans>Accept</Trans>
          </Button>
        ) : null}
        <Button icon="x" onClick={() => setDeclining(true)}>
          <Trans>Decline this event</Trans>
        </Button>
      </div>
    );
  }
  return (
    <div class="field card card-pad" aria-label={t`Enter decline`}>
      <span class="field-label">
        <Trans>Reason for declining</Trans>
      </span>
      <div class="chips" role="group" aria-label={t`Quick selection`}>
        {quickReasons().map((r) => (
          <button type="button" class={`chip ${reason === r ? "selected" : ""}`} aria-pressed={reason === r ? "true" : "false"} onClick={() => setReason(r)}>
            {r}
          </button>
        ))}
      </div>
      <input class="input" aria-label={t`Reason`} value={reason} maxLength={200} placeholder={t`e.g. school event`} onInput={(e) => setReason((e.target as HTMLInputElement).value)} />
      <div class="btn-row">
        <Button
          variant="primary"
          disabled={!reason.trim()}
          onClick={async () => {
            await sendResponse(event, p.person.id, "no", reason.trim());
            toast(t`Decline entered for ${name}.`);
            onDone();
          }}
        >
          <Trans>Enter decline</Trans>
        </Button>
        <Button variant="ghost" onClick={() => setDeclining(false)}>
          <Trans>Cancel</Trans>
        </Button>
      </div>
    </div>
  );
}

/** Joint training: mandatory or optional per team, for this event only. */
function JoiningTeams({ event, onChanged }: { event: EventDetail; onChanged: () => void }) {
  return (
    <section class="card card-body stack-sm" aria-label={t`Teams at this training`}>
      <h2 class="section-title" style={{ margin: 0 }}>
        <Trans>Teams at this training</Trans>
      </h2>
      {event.teams.map((team) => {
        const teamName = team.name;
        const optional = event.optionalTeamIds.includes(team.id);
        return (
          <div class="row-gap" style={{ justifyContent: "space-between" }}>
            <span class="team-badge">{teamName}</span>
            <Segmented
              label={t`Joining for ${teamName}`}
              value={optional ? "optional" : "mandatory"}
              options={[
                { value: "mandatory", label: t`Mandatory` },
                { value: "optional", label: t({ message: "Optional", context: "training" }) },
              ]}
              onChange={async (v) => {
                try {
                  await api.put(`/events/${event.id}/teams/${team.id}/optional`, { optional: v === "optional" });
                  onChanged();
                } catch (err) {
                  toast(errorMessage(err), "error");
                }
              }}
            />
          </div>
        );
      })}
      <p class="small muted">
        <Trans>Applies to this training only. The training plan sets it for all trainings.</Trans>
      </p>
    </section>
  );
}

function ParticipantSheet({ event, p, onClose, onDone }: { event: EventDetail; p: ParticipantDetail; onClose: () => void; onDone: () => void }) {
  const wd = weekdayOf(event.startsAt);
  const teamId = p.teamId;
  const name = p.person.firstName;
  const weekdays = weekdayPlural(wd);
  return (
    <Sheet open onClose={onClose} title={personName(p.person)}>
      <div class="row-gap">
        <StatusPill status={p.status} late={p.isLate} optional={p.optional} />
        {p.isHelper ? <span class="badge muted">{t`Stand-in`}</span> : null}
        {p.unexcused ? (
          <span class="badge warn">
            <Trans>Absent without excuse</Trans>
          </span>
        ) : null}
      </div>
      {p.reason ? <p>{quoted(p.reason)}</p> : null}
      {event.isPast && !event.cancelled && !p.optional && (p.unexcused || p.status === "yes" || p.status === "open") ? (
        <div class="list">
          <SwitchRow
            label={t`Absent without excuse`}
            sub={t`Did not decline and still did not come. Only coaches, the person themselves and their parents see this.`}
            checked={p.unexcused}
            onChange={async (unexcused) => {
              await api.put(`/events/${event.id}/unexcused/${p.person.id}`, { unexcused });
              toast(unexcused ? t`${name}: absent without excuse.` : t`Mark removed.`);
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
            label={t`Permanently absent (${weekdays})`}
            sub={t`Applies to all trainings in this training slot. Accepting individual sessions remains possible.`}
            checked={p.hasStandingAbsence}
            onChange={async (active) => {
              await api.put(`/rules/${event.ruleId}/standing-absences/${p.person.id}`, { active });
              toast(active ? t`Marked as permanently absent.` : t`Permanent absence removed.`);
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
                  title: t`Set ${name} to inactive?`,
                  message: t`For example for an injury, illness or a school exchange. The app does not store a reason. All events then count as “absent (inactive)” and reminders stop.`,
                  confirmLabel: t`Set inactive`,
                }))
              )
                return;
              await api.post(`/persons/${p.person.id}/active`, { active: false });
              toast(t`${name} is now inactive.`);
              onClose();
              onDone();
            }}
          >
            <Trans>Set inactive</Trans>
          </Button>
        ) : null}
        {teamId ? (
          <a class="btn btn-ghost" href={`/team/${teamId}/person/${p.person.id}`}>
            <Trans>Go to person</Trans>
          </a>
        ) : null}
      </div>
      {p.respondedAt ? <p class="small muted">{lastResponse(stamp(p.respondedAt))}</p> : null}
    </Sheet>
  );
}

/** Team with "responses visible to everyone": who is coming, who is not (without reasons). */
function RosterList({ roster }: { roster: RosterEntry[] }) {
  const groups: { title: string; items: RosterEntry[] }[] = [
    { title: t`Accepted`, items: roster.filter((r) => r.status === "yes") },
    { title: t`Declined`, items: roster.filter((r) => r.status === "no") },
    { title: t`Pending`, items: roster.filter((r) => r.status === "open") },
    { title: t`Absent`, items: roster.filter((r) => r.status === "standing" || r.status === "inactive") },
  ].filter((g) => g.items.length);
  return (
    <section class="card card-body stack-sm" aria-label={t`Who is coming`}>
      <h2 class="section-title" style={{ margin: 0 }}>
        <Trans>Who is coming</Trans>
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
 * Special event: note on your own duties or open spots. Coaches, the creator and organisers create
 * time blocks; coaches, admins and the creator assign organisers.
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
    <section class="card card-pad stack-sm" aria-label={t`Helpers`}>
      {text ? (
        <a class="ext-link" href="/helfer">
          <Icon name="helping" size={16} />
          <Trans>Helper plan · {text}</Trans>
        </a>
      ) : null}
      {event.dutyManage ? (
        <>
          {inHelperTab && !text ? (
            <a class="ext-link" href="/helfer">
              <Icon name="helping" size={16} />
              <Trans>Manage helper duties in the Helpers tab</Trans>
            </a>
          ) : null}
          <Button size="sm" variant="dashed" icon="plus" onClick={() => setAdding(true)}>
            <Trans>Helpers: add time block</Trans>
          </Button>
        </>
      ) : null}
      {showOrganizers && org ? (
        <div class="stack-sm" aria-label={t`Organisers`} role="group">
          <strong>
            <Trans>Organisers</Trans>
          </strong>
          <ul class="list">
            {org.creator ? (
              <li class="list-row">
                <span class="main">
                  <span class="title">{org.creator.name}</span>
                  <span class="sub">
                    <Trans>created the event</Trans>
                  </span>
                </span>
              </li>
            ) : null}
            {org.people.map((p) => {
              const name = p.name;
              return (
                <li class="list-row">
                  <span class="main">
                    <span class="title">{p.name}</span>
                  </span>
                  {org.editable ? (
                    <button
                      type="button"
                      class="icon-btn icon-btn-sm"
                      aria-label={t`Remove ${name} as organiser`}
                      onClick={async () => {
                        await api.del(`/events/${event.id}/organizers/${p.id}`);
                        toast(t`${name} is no longer an organiser.`);
                        onChanged();
                      }}
                    >
                      <Icon name="x" size={16} />
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
          <p class="small muted">
            <Trans>Organisers manage the helper duties of this event.</Trans>
          </p>
          {org.editable ? (
            <Button size="sm" variant="dashed" icon="plus" onClick={() => setAddOrganizer(true)}>
              <Trans>Add organiser</Trans>
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
            const label = b.label;
            toast(t`Time block ${label} added. It is now in the Helpers tab.`);
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

/** Search for an organiser: full members with access, without input those of the teams involved. */
function OrganizerSheet({ eventId, onClose, onDone }: { eventId: number; onClose: () => void; onDone: () => void }) {
  const [search, setSearch] = useState("");
  const q = search.trim();
  const people = useQuery<{ people: { personId: number; name: string; teams?: string | null }[] }>(
    `/duties/events/${eventId}/people?account=1${q.length >= 2 ? `&q=${encodeURIComponent(q)}` : ""}`,
  );
  const needle = q.toLowerCase();
  const list = (people.data?.people ?? []).filter((p) => q.length >= 2 || !needle || p.name.toLowerCase().includes(needle));
  return (
    <Sheet open onClose={onClose} title={t`Add organiser`}>
      <TextField
        label={t`Search by name`}
        value={search}
        onInput={setSearch}
        maxLength={60}
        hint={t`Full members with access to the app. From 2 letters: everyone in the club.`}
      />
      <ul class="list" aria-label={t`People`}>
        {list.slice(0, 30).map((p) => (
          <li>
            <button
              type="button"
              class="list-row"
              onClick={async () => {
                try {
                  await api.post(`/events/${eventId}/organizers`, { personId: p.personId });
                  const name = p.name;
                  toast(t`${name} is now co-organising.`);
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
      {people.data && !list.length ? (
        <p class="small muted">
          <Trans>Nobody found.</Trans>
        </p>
      ) : null}
    </Sheet>
  );
}
