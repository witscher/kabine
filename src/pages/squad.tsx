import { plural, select, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useEffect, useMemo, useState } from "preact/hooks";
import type { EventSummary, ParticipationStatus, PersonRef } from "../../shared/types";
import { api } from "../api";
import { personName, shortDate, shortName, time } from "../format";
import { Icon } from "../icons";
import { invalidate, useQuery } from "../store";
import { Button, confirmDialog, ErrorBox, Notice, Sheet, Spinner, toast, useDocumentTitle } from "../ui";
import { useVenue } from "../club";

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
  useDocumentTitle(t`Nominate squad`);
  const venue = useVenue();
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
    else if (selected.length >= max) toast(t`At most ${max} players in the squad.`, "error");
    else setPicked([...selected, c.person.id]);
  };
  const activeIds = new Set(data.candidates.filter((c) => c.isActive).map((c) => c.person.id));
  const changed = data.published
    ? JSON.stringify([...selected].sort()) !== JSON.stringify(data.candidates.filter((c) => c.nominated).map((c) => c.person.id).sort())
    : true;
  const ev = data.event;
  const declinedNames = declined
    .map((d) => {
      const name = shortName(d.person);
      const reason = d.reason;
      return reason ? t`${name} ("${reason}")` : name;
    })
    .join(", ");
  const replacementNames = replacements.map((r) => shortName(r.person)).join(", ");
  const count = selected.length;

  return (
    <main class="page">
      <header class="topbar" style={{ flexDirection: "column", alignItems: "stretch", gap: "14px", paddingLeft: "16px", paddingRight: "16px" }}>
        <div class="row-gap">
          <button type="button" class="icon-btn" aria-label={t`Back`} onClick={() => history.back()} style={{ marginLeft: "-8px" }}>
            <Icon name="back" size={24} stroke={2.2} />
          </button>
          <h1 style={{ fontSize: "28px" }}>
            <Trans>Nominate squad</Trans>
          </h1>
        </div>
        <div class="squad-head">
          <div>
            <div style={{ fontSize: "13px", fontWeight: 700, letterSpacing: "0.06em" }}>
              {shortDate(ev.startsAt).toUpperCase()} · {time(ev.startsAt)}
            </div>
            <div style={{ fontFamily: "var(--font-cond)", fontWeight: 700, fontSize: "24px", lineHeight: 1.1 }}>{ev.title}</div>
            <div style={{ fontSize: "14px" }}>{ev.location?.name ?? select(venue, { hall: "Hall to follow", pitch: "Pitch to follow", other: "Venue to follow" })}</div>
          </div>
          <div>
            <div class="squad-count" aria-live="polite">
              {selected.length}
              <small>/{max}</small>
            </div>
            <div style={{ fontSize: "12px", fontWeight: 700, textAlign: "right" }}>
              <Trans>nominated</Trans>
            </div>
          </div>
        </div>
      </header>

      <div class="content">
        {data.automatic ? (
          <Notice>
            <Trans>Automatic: the core squad is nominated for this game. If you change anything here, your selection only applies to this game.</Trans>
          </Notice>
        ) : null}
        {data.team.autoSquad && !data.automatic && data.published && !ev.isPast ? (
          <div class="notice">
            <Icon name="info" size={18} />
            <div class="stack-sm" style={{ flex: 1 }}>
              <span>
                <Trans>You adjusted this squad by hand. Changes to the core squad do not apply here.</Trans>
              </span>
              <Button
                size="sm"
                onClick={async () => {
                  await api.post(`/events/${id}/squad/auto`);
                  invalidate("/events");
                  setPicked(null);
                  await reload();
                  toast(t`The squad follows the core squad again.`);
                }}
              >
                <Trans>Automatic again</Trans>
              </Button>
            </div>
          </div>
        ) : null}
        {selected.length > max ? (
          <Notice kind="warn">
            <Trans>More than {max} in the squad. Please deselect players or increase the squad size under Team → Settings.</Trans>
          </Notice>
        ) : null}
        {declined.length ? (
          <div class="notice warn">
            <Icon name="alert" size={18} />
            <div>
              <Trans>
                <strong>Declined:</strong> {declinedNames}.
              </Trans>
              {replacements.length ? " " + t`Suggested replacement: ${replacementNames}.` : ""}
            </div>
          </div>
        ) : null}

        <div class="grid-2">
          <Button
            disabled={!data.coreIds.length}
            onClick={() => setPicked(data.coreIds.filter((pid) => activeIds.has(pid)).slice(0, max))}
          >
            <Trans>Use core squad</Trans>
          </Button>
          <Button disabled={!data.lastGameIds.length} onClick={() => setPicked(data.lastGameIds.filter((pid) => activeIds.has(pid)).slice(0, max))}>
            <Trans>Same as last game</Trans>
          </Button>
        </div>
        {!data.coreIds.length ? (
          <p class="small muted">
            <Trans>
              No core squad set yet. You can do that under <a href={`/team/${data.team.id}`}>Team → Squad</a>.
            </Trans>
          </p>
        ) : null}

        <ul class="list" aria-label={t({ message: "Players", context: "list" })}>
          {data.candidates.map((c) => {
            const on = selected.includes(c.person.id);
            const warning = c.conflict ?? c.ageWarning;
            const reason = c.reason;
            if (!c.isActive) {
              return (
                <li>
                  <div class="squad-row off">
                    <span class="check disabled" />
                    <span style={{ flex: 1 }}>
                      <span style={{ display: "block", fontWeight: 700 }}>{shortName(c.person)}</span>
                      <span class="small">
                        <Trans>Inactive, cannot be nominated</Trans>
                      </span>
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
                        ? t`Accepted`
                        : c.nominated && c.status === "no"
                          ? reason
                            ? t`Declined: ${reason}`
                            : t`Declined`
                          : c.hint || " "}
                    </span>
                    {warning ? (
                      <span class="small warn-text" style={{ display: "block" }}>
                        {warning}
                      </span>
                    ) : null}
                  </span>
                  {c.isHelper ? <span class="badge muted">
                      <Trans>Stand-in</Trans>
                    </span> : null}
                  {c.isCore ? <span class="badge outline">
                      <Trans>Core</Trans>
                    </span> : null}
                </button>
              </li>
            );
          })}
        </ul>

        {data.helpRequests.length ? (
          <div class="card card-pad stack-sm">
            <strong>
              <Trans>Stand-in requests</Trans>
            </strong>
            {data.helpRequests.map((h) => (
              <div class="row-gap" style={{ justifyContent: "space-between" }}>
                <span>
                  {personName(h.person)} {h.homeTeam ? <span class="muted">({h.homeTeam})</span> : null}
                </span>
                <span class={`pill ${h.status === "accepted" ? "pill-yes" : h.status === "declined" ? "pill-no" : "pill-open"}`}>
                  {h.status === "accepted" ? t`Accepted` : h.status === "declined" ? t`Turned down` : t`Requested`}
                </span>
              </div>
            ))}
          </div>
        ) : null}

        <Button variant="dashed" icon="plus" onClick={() => setHelpOpen(true)}>
          <Trans>Request a stand-in</Trans>
        </Button>

        <Button
          variant="primary"
          size="lg"
          disabled={!changed && data.published}
          onClick={async () => {
            if (!selected.length && !(await confirmDialog({ title: t`Publish an empty squad?`, message: t`Nobody is nominated.`, confirmLabel: t`Anyway` }))) return;
            const res = await api.put<{ added: number; removed: number }>(`/events/${id}/squad`, { personIds: selected });
            invalidate(`/events`);
            setPicked(null);
            const added = res.added;
            const removed = res.removed;
            toast(data.published ? t`Squad updated (${added} new, ${removed} removed).` : t`Squad published. The nominated players have been notified.`);
            await reload();
          }}
        >
          {data.published ? t`Save changes · ${count}` : plural(count, { one: "Publish squad · # person", other: "Publish squad · # people" })}
        </Button>
        <p class="small muted" style={{ textAlign: "center" }}>
          <Trans>Nominated players receive a notification and count as accepted until they decline.</Trans>
        </p>
        {!data.published ? (
          <Notice>
            <Trans>The core squad is preselected. Players and parents only see the nomination after publishing.</Trans>
          </Notice>
        ) : null}
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
    <Sheet open onClose={onClose} title={t`Request a stand-in`}>
      <p class="muted">
        <Trans>
          Suggestions from the second team of the same age class and the next younger youth team. The request goes to the person or their parents, and the
          coaches of their home team are informed.
        </Trans>
      </p>
      {error ? <ErrorBox error={error} /> : null}
      {!data ? <Spinner /> : null}
      {data && !data.candidates.length ? (
        <Notice>
          <Trans>There are no suitable stand-ins for {teamName}.</Trans>
        </Notice>
      ) : null}
      <ul class="list">
        {(data?.candidates ?? []).map((c) => (
          <li class="list-row">
            <span class="main">
              <span class="title">{personName(c.person)}</span>
              <span class="sub">{c.team.name}</span>
              {c.conflict ? <span class="small warn-text">{c.conflict}</span> : null}
            </span>
            {c.requested ? (
              <span class="pill pill-muted">
                <Trans>Requested</Trans>
              </span>
            ) : (
              <Button
                size="sm"
                variant="primary"
                onClick={async () => {
                  await api.post(`/events/${eventId}/help-requests`, { personId: c.person.id });
                  const name = c.person.firstName;
                  toast(t`${name} has been asked.`);
                  await reload();
                  onDone();
                }}
              >
                <Trans>Send request</Trans>
              </Button>
            )}
          </li>
        ))}
      </ul>
    </Sheet>
  );
}
