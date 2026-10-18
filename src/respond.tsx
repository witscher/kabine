import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useState } from "preact/hooks";
import { clockTimeIn } from "../shared/dates";
import type { EventSummary, MyParticipation } from "../shared/types";
import { api } from "./api";
import { longDate, nowLocal, personName, stamp, time } from "./format";
import { Icon } from "./icons";
import { useSession } from "./session";
import { refreshBadge } from "./badge";
import { currentLocale } from "./i18n";
import { invalidate } from "./store";
import { Button, Sheet, StatusPill, toast } from "./ui";

export const quickReasons = () => [t`School`, t`Ill`, t`Family`, t`Holiday`, t`Other sport`, t`Injured`];

function deadlinePassed(event: EventSummary): boolean {
  if (!event.deadline) return false;
  return nowLocal() >= event.deadline;
}

export function deadlineText(event: EventSummary): string {
  if (!event.deadline) return "";
  return `${longDate(event.deadline)}, ${clockTimeIn(currentLocale(), time(event.deadline))}`;
}

export function respondedByText(p: MyParticipation, selfId: number): string | null {
  if (!p.respondedBy || !p.respondedAt) return null;
  const name = p.respondedByName;
  if (p.respondedBy === "guardian") return byGuardianText(name);
  if (p.respondedBy === "self" && p.person.id !== selfId) {
    const firstName = p.person.firstName;
    return t`by ${firstName} themselves`;
  }
  if (p.respondedBy === "other") return name ? t`by ${name}` : null;
  return null;
}

/** "by Anna (parent)", without a name "by parent (parent)" as before. */
export function byGuardianText(respondedByName: string | null | undefined): string {
  const name = respondedByName ?? t`Parent`;
  return t`by ${name} (parent)`;
}

export async function sendResponse(event: EventSummary, personId: number, status: "yes" | "no", reason?: string) {
  await api.post(`/events/${event.id}/responses`, { personId, status, reason });
  invalidate("/events", "/session");
}

/** Declining with a reason (required) as a bottom sheet. */
export function DeclineSheet(props: { event: EventSummary; person: MyParticipation | null; onClose: () => void }) {
  const [reason, setReason] = useState(props.person?.reason ?? "");
  const [error, setError] = useState<string | null>(null);
  const late = deadlinePassed(props.event);
  const { me } = useSession();
  const forOther = props.person && me && props.person.person.id !== me.person.id;
  const firstName = props.person?.person.firstName ?? "";
  return (
    <Sheet open={!!props.person} onClose={props.onClose} title={forOther ? t`Decline for ${firstName}` : t`Decline`}>
      {late ? (
        <div class="notice warn">
          <Icon name="alert" size={18} />
          <div>
            <Trans>The deadline for declining has passed. You can still decline, the coach will then be informed immediately.</Trans>
          </div>
        </div>
      ) : null}
      <div class="field">
        <label class="field-label" for="decline-reason">
          <Trans>Reason (required)</Trans>
        </label>
        <div class="chips" role="group" aria-label={t`Quick selection`}>
          {quickReasons().map((r) => (
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
          placeholder={t`e.g. school event`}
          aria-invalid={error ? "true" : undefined}
          onInput={(e) => {
            setReason((e.target as HTMLInputElement).value);
            setError(null);
          }}
        />
        {error ? <div class="field-error">{error}</div> : null}
        <div class="field-hint">
          <Trans>Please do not give details about illnesses, “ill” is enough. Only the coaches see the reason.</Trans>
        </div>
      </div>
      <Button
        variant="primary"
        size="lg"
        block
        onClick={async () => {
          if (!reason.trim()) {
            setError(t`Please give a short reason.`);
            return;
          }
          await sendResponse(props.event, props.person!.person.id, "no", reason.trim());
          toast(late ? t`Declined. The coach has been informed.` : t`Declined.`);
          props.onClose();
        }}
      >
        {late ? t`Decline at short notice` : t`Send decline`}
      </Button>
    </Sheet>
  );
}

/**
 * Response for one person, large (card) or compact (row). Anyone who does not
 * decline counts as accepted. Accepting therefore only exists to withdraw a
 * decline, and for stand-ins and the permanently absent.
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
  const acceptLabel =
    status === "no" ? (isSelf ? t`I'm in after all` : t`Accept again`) : status === "standing" ? t`In this time` : isSelf ? t`I'm in` : t`Accept`;
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
              toast(t`Accepted.`);
            }}
          >
            {acceptLabel}
          </Button>
        ) : null}
        <Button variant={status === "no" ? "secondary" : "danger"} size={size} disabled={!p.canDecline} onClick={() => props.onDecline(p)}>
          {status === "no" ? t`Change reason` : t`Decline`}
        </Button>
      </div>
      {restricted ? (
        <p class="small muted">{!p.canDecline ? <Trans>Your parents take care of declining.</Trans> : <Trans>Your parents take care of withdrawing declines.</Trans>}</p>
      ) : null}
    </div>
  );
}

export function HelpRequestCard(props: { event: EventSummary; p: MyParticipation }) {
  const help = props.p.helpRequest!;
  const { me } = useSession();
  const forOther = me && props.p.person.id !== me.person.id;
  const team = help.teamName;
  const name = props.p.person.firstName;
  if (help.status !== "open") {
    return (
      <p class="small muted">
        {help.status === "accepted" ? (
          <Trans>Help request from {team}: accepted</Trans>
        ) : help.status === "declined" ? (
          <Trans>Help request from {team}: turned down</Trans>
        ) : (
          <Trans>Help request from {team}: withdrawn</Trans>
        )}
      </p>
    );
  }
  return (
    <div class="notice yellow" style={{ flexDirection: "column", gap: "10px" }}>
      <div>
        {forOther ? (
          <Trans>
            <strong>Help request:</strong> {team} asks whether {name} can help out at this game.
          </Trans>
        ) : (
          <Trans>
            <strong>Help request:</strong> {team} asks whether you can help out at this game.
          </Trans>
        )}
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
              toast(t`Accepted. Thanks for helping out!`);
            }}
          >
            <Trans>I'll help out</Trans>
          </Button>
          <Button
            size="sm"
            onClick={async () => {
              await api.post(`/help-requests/${help.id}/answer`, { accept: false });
              refreshBadge();
              invalidate("/events");
              toast(t`Turned down.`);
            }}
          >
            <Trans>Not this time</Trans>
          </Button>
        </div>
      ) : (
        <p class="small">
          <Trans>Your parents take care of this.</Trans>
        </p>
      )}
    </div>
  );
}

/** One row per person (parents with several children). */
export function PersonResponseRow(props: { event: EventSummary; p: MyParticipation; onDecline: (p: MyParticipation) => void }) {
  const { me } = useSession();
  const { p, event } = props;
  const by = respondedByText(p, me?.person.id ?? 0);
  const reason = p.reason;
  return (
    <div class="stack-sm" style={{ paddingTop: "4px" }}>
      <div class="row-gap" style={{ justifyContent: "space-between" }}>
        <strong>{me?.person.id === p.person.id ? t`You` : personName(p.person)}</strong>
        <StatusPill status={p.status} late={p.isLate} nominated={p.nominated} game={event.kind === "game"} />
      </div>
      {p.unexcused ? (
        <span class="badge warn" style={{ alignSelf: "flex-start" }}>
          <Trans>Missed without excuse</Trans>
        </span>
      ) : null}
      {p.helpRequest ? <HelpRequestCard event={event} p={p} /> : null}
      {event.kind === "game" && !p.participant && !p.helpRequest ? (
        <p class="small muted">
          <Trans>Not nominated for this game.</Trans>
        </p>
      ) : null}
      <ResponseButtons event={event} p={p} onDecline={props.onDecline} compact />
      {p.status === "no" && reason ? (
        <p class="small muted">
          <Trans>Reason: “{reason}”</Trans>
        </p>
      ) : null}
      {by ? (
        <p class="small muted">
          {p.status === "yes" ? t`Accepted ${by}` : t`Declined ${by}`}
          {p.respondedAt ? `, ${stamp(p.respondedAt)}` : ""}
        </p>
      ) : null}
    </div>
  );
}
