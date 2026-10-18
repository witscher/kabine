import { useState } from "preact/hooks";
import type { EventSummary, MyParticipation } from "../shared/types";
import { api } from "./api";
import { longDate, nowLocal, personName, stamp, time } from "./format";
import { Icon } from "./icons";
import { useSession } from "./session";
import { refreshBadge } from "./badge";
import { invalidate } from "./store";
import { Button, Sheet, StatusPill, toast } from "./ui";

export const QUICK_REASONS = ["Schule", "Krank", "Familie", "Urlaub", "Andere Sportart", "Verletzt"];

function deadlinePassed(event: EventSummary): boolean {
  if (!event.deadline) return false;
  return nowLocal() >= event.deadline;
}

export function deadlineText(event: EventSummary): string {
  if (!event.deadline) return "";
  return `${longDate(event.deadline)}, ${time(event.deadline)} Uhr`;
}

export function respondedByText(p: MyParticipation, selfId: number): string | null {
  if (!p.respondedBy || !p.respondedAt) return null;
  if (p.respondedBy === "guardian") return `von ${p.respondedByName ?? "Elternteil"} (Elternteil)`;
  if (p.respondedBy === "self" && p.person.id !== selfId) return `von ${p.person.firstName} selbst`;
  if (p.respondedBy === "other") return p.respondedByName ? `von ${p.respondedByName}` : null;
  return null;
}

export async function sendResponse(event: EventSummary, personId: number, status: "yes" | "no", reason?: string) {
  await api.post(`/events/${event.id}/responses`, { personId, status, reason });
  invalidate("/events", "/session");
}

/** Absagen mit Begründung (Pflicht) als Bottom Sheet. */
export function DeclineSheet(props: { event: EventSummary; person: MyParticipation | null; onClose: () => void }) {
  const [reason, setReason] = useState(props.person?.reason ?? "");
  const [error, setError] = useState<string | null>(null);
  const late = deadlinePassed(props.event);
  const { me } = useSession();
  const forOther = props.person && me && props.person.person.id !== me.person.id;
  return (
    <Sheet open={!!props.person} onClose={props.onClose} title={forOther ? `Absage für ${props.person!.person.firstName}` : "Absagen"}>
      {late ? (
        <div class="notice warn">
          <Icon name="alert" size={18} />
          <div>Die Absagefrist ist abgelaufen. Du kannst trotzdem absagen, der Trainer wird dann sofort informiert.</div>
        </div>
      ) : null}
      <div class="field">
        <label class="field-label" for="decline-reason">
          Grund (Pflicht)
        </label>
        <div class="chips" role="group" aria-label="Schnellauswahl">
          {QUICK_REASONS.map((r) => (
            <button type="button" class={`chip ${reason === r ? "selected" : ""}`} aria-pressed={reason === r ? "true" : "false"} onClick={() => setReason(r)}>
              {r}
            </button>
          ))}
        </div>
        <input
          id="decline-reason"
          class="input"
          value={reason}
          maxLength={200}
          placeholder="z. B. Schulveranstaltung"
          aria-invalid={error ? "true" : undefined}
          onInput={(e) => {
            setReason((e.target as HTMLInputElement).value);
            setError(null);
          }}
        />
        {error ? <div class="field-error">{error}</div> : null}
        <div class="field-hint">Bitte keine Details zu Erkrankungen angeben, „krank“ genügt. Den Grund sehen nur die Trainer.</div>
      </div>
      <Button
        variant="primary"
        size="lg"
        block
        onClick={async () => {
          if (!reason.trim()) {
            setError("Bitte gib kurz einen Grund an.");
            return;
          }
          await sendResponse(props.event, props.person!.person.id, "no", reason.trim());
          toast(late ? "Abgesagt. Der Trainer wurde informiert." : "Abgesagt.");
          props.onClose();
        }}
      >
        {late ? "Kurzfristig absagen" : "Absage senden"}
      </Button>
    </Sheet>
  );
}

/**
 * Rückmeldung für eine Person, groß (Karte) oder kompakt (Zeile). Wer nicht
 * absagt, gilt als zugesagt. Zusagen gibt es deshalb nur, um eine Absage
 * zurückzunehmen, und für Aushilfen und Dauerabwesende.
 */
export function ResponseButtons(props: { event: EventSummary; p: MyParticipation; onDecline: (p: MyParticipation) => void; compact?: boolean }) {
  const { event, p } = props;
  const { me } = useSession();
  if (!p.participant) return null;
  const isSelf = me?.person.id === p.person.id;
  const status = p.status;
  const hint = !p.canAccept && !p.canDecline ? p.blockedReason : null;
  if (hint) return <p class="small muted">{hint}</p>;
  const size = props.compact ? "sm" : "md";
  const showAccept = status !== "yes";
  const acceptLabel = status === "no" ? (isSelf ? "Bin doch dabei" : "Wieder zusagen") : status === "standing" ? "Diesmal dabei" : isSelf ? "Bin dabei" : "Zusagen";
  const restricted = isSelf && me?.hasGuardians && !p.blockedReason && ((showAccept && !p.canAccept) || !p.canDecline);
  return (
    <div class="stack-sm">
      <div class="btn-row">
        {showAccept ? (
          <Button
            variant="primary"
            size={size}
            icon="check"
            disabled={!p.canAccept}
            onClick={async () => {
              await sendResponse(event, p.person.id, "yes");
              toast("Zugesagt.");
            }}
          >
            {acceptLabel}
          </Button>
        ) : null}
        <Button variant={status === "no" ? "secondary" : "danger"} size={size} disabled={!p.canDecline} onClick={() => props.onDecline(p)}>
          {status === "no" ? "Grund ändern" : "Absagen"}
        </Button>
      </div>
      {restricted ? <p class="small muted">Deine Eltern kümmern sich um {!p.canDecline ? "Absagen" : "das Zurücknehmen von Absagen"}.</p> : null}
    </div>
  );
}

export function HelpRequestCard(props: { event: EventSummary; p: MyParticipation }) {
  const help = props.p.helpRequest!;
  const { me } = useSession();
  const forOther = me && props.p.person.id !== me.person.id;
  if (help.status !== "open") {
    return (
      <p class="small muted">
        Aushilfe-Anfrage der {help.teamName}: {help.status === "accepted" ? "angenommen" : help.status === "declined" ? "abgelehnt" : "zurückgezogen"}
      </p>
    );
  }
  return (
    <div class="notice yellow" style={{ flexDirection: "column", gap: "10px" }}>
      <div>
        <strong>Aushilfe-Anfrage:</strong> Die {help.teamName} fragt, ob {forOther ? props.p.person.firstName : "du"} bei diesem Spiel aushelfen{" "}
        {forOther ? "kann" : "kannst"}.
      </div>
      {help.canAnswer ? (
        <div class="btn-row" style={{ width: "100%" }}>
          <Button
            variant="primary"
            size="sm"
            onClick={async () => {
              await api.post(`/help-requests/${help.id}/answer`, { accept: true });
              refreshBadge();
              invalidate("/events");
              toast("Zugesagt. Danke fürs Aushelfen!");
            }}
          >
            Ich helfe aus
          </Button>
          <Button
            size="sm"
            onClick={async () => {
              await api.post(`/help-requests/${help.id}/answer`, { accept: false });
              refreshBadge();
              invalidate("/events");
              toast("Abgelehnt.");
            }}
          >
            Diesmal nicht
          </Button>
        </div>
      ) : (
        <p class="small">Deine Eltern kümmern sich darum.</p>
      )}
    </div>
  );
}

/** Eine Zeile pro Person (Eltern mit mehreren Kindern). */
export function PersonResponseRow(props: { event: EventSummary; p: MyParticipation; onDecline: (p: MyParticipation) => void }) {
  const { me } = useSession();
  const { p, event } = props;
  const by = respondedByText(p, me?.person.id ?? 0);
  return (
    <div class="stack-sm" style={{ paddingTop: "4px" }}>
      <div class="row-gap" style={{ justifyContent: "space-between" }}>
        <strong>{me?.person.id === p.person.id ? "Du" : personName(p.person)}</strong>
        <StatusPill status={p.status} late={p.isLate} nominated={p.nominated} game={event.kind === "game"} />
      </div>
      {p.unexcused ? <span class="badge warn" style={{ alignSelf: "flex-start" }}>Unentschuldigt gefehlt</span> : null}
      {p.helpRequest ? <HelpRequestCard event={event} p={p} /> : null}
      {event.kind === "game" && !p.participant && !p.helpRequest ? <p class="small muted">Nicht für dieses Spiel nominiert.</p> : null}
      <ResponseButtons event={event} p={p} onDecline={props.onDecline} compact />
      {p.status === "no" && p.reason ? <p class="small muted">Grund: „{p.reason}“</p> : null}
      {by ? (
        <p class="small muted">
          {p.status === "yes" ? "Zugesagt" : "Abgesagt"} {by}
          {p.respondedAt ? `, ${stamp(p.respondedAt)}` : ""}
        </p>
      ) : null}
    </div>
  );
}
