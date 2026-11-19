// The polls module on the start page: a card at the very top while a vote is missing, and the dot on the Events tab.
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useState } from "preact/hooks";
import { api } from "../../../src/api";
import { Icon } from "../../../src/icons";
import { useQuery } from "../../../src/store";
import { Button, toast } from "../../../src/ui";
import type { PollSummary } from "../types";
import { endsText, openLabel, hintSeen, IGNORE_HINT, kindLabel, pollsChanged, rememberHint, teamText, useInfoSheet } from "./common";

/** Shared by the cards and the tab dot (one request, the store keeps it). */
export const OPEN_PATH = "/polls/open";

function useOpenPolls(): PollSummary[] {
  return useQuery<{ polls: PollSummary[] }>(OPEN_PATH, { refreshMs: 60_000 }).data?.polls ?? [];
}

/** Dot on the Events tab while a vote of the person is missing (screen readers hear "open poll"). */
export function EventsTabDot() {
  if (!useOpenPolls().length) return null;
  return (
    <>
      <span class="dot" aria-hidden="true" />
      <span class="sr-only">
        <Trans>(open poll)</Trans>
      </span>
    </>
  );
}

/** Cards at the very top of the start page while a vote is missing: they need action, so they stand out. */
export function OpenPollCards() {
  const polls = useOpenPolls();
  const [showInfo, infoSheet] = useInfoSheet();
  return (
    <>
      {polls.map((p) => (p.kind === "order" ? <OpenOrderCard key={p.id} poll={p} showInfo={showInfo} /> : <OpenPollCard key={p.id} poll={p} />))}
      {infoSheet}
    </>
  );
}

function CardHead({ poll: p, tag }: { poll: PollSummary; tag: string }) {
  return (
    <div class="row-between poll-card-head">
      <div class="kicker">
        {kindLabel(p.kind)} · {teamText(p.teamName)} · {endsText(p.endsAt, true)}
      </div>
      <span class="poll-open-tag">
        <span class="poll-open-dot" aria-hidden="true" />
        {tag}
      </span>
    </div>
  );
}

function OpenPollCard({ poll: p }: { poll: PollSummary }) {
  const kind = kindLabel(p.kind);
  const title = p.title;
  return (
    <a class="card card-body stack-sm poll-card poll-card-open" href={`/umfragen/${p.id}`} aria-label={t`${kind}: ${title}`}>
      <CardHead poll={p} tag={t`Vote missing`} />
      <strong>{p.title}</strong>
      <span class="btn btn-primary btn-sm poll-card-button">
        <Icon name="poll" size={16} />
        <Trans>Vote</Trans>
      </span>
    </a>
  );
}

/** An order: order, or ignore it (gone from the start page for this person, no reminder). */
function OpenOrderCard({ poll: p, showInfo }: { poll: PollSummary; showInfo: (info: { title: string; message: string }) => void }) {
  const [busy, setBusy] = useState(false);
  const kind = kindLabel(p.kind);
  const title = p.title;
  const ignore = async () => {
    setBusy(true);
    try {
      await api.put(`/polls/${p.id}/ignore`, { ignored: true });
    } finally {
      setBusy(false);
    }
    pollsChanged();
    if (!hintSeen(IGNORE_HINT)) {
      rememberHint(IGNORE_HINT);
      showInfo({
        title: t`Hidden`,
        message: t`If you change your mind: under Profile → Polls you find the order again and can order until the poll ends.`,
      });
    } else toast(t`Order hidden. You find it under Profile → Polls.`);
  };
  return (
    <section class="card card-body stack-sm poll-card-open" aria-label={t`${kind}: ${title}`}>
      <CardHead poll={p} tag={openLabel()} />
      <a class="poll-card-title" href={`/umfragen/${p.id}`}>
        <strong>{p.title}</strong>
      </a>
      <div class="row-gap poll-card-actions">
        <a class="btn btn-primary btn-sm" href={`/umfragen/${p.id}`}>
          <Icon name="poll" size={16} />
          <Trans>Order</Trans>
        </a>
        <Button variant="ghost" size="sm" disabled={busy} onClick={ignore}>
          <Trans>Ignore</Trans>
        </Button>
      </div>
    </section>
  );
}
