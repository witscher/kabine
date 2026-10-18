// Profile → My events: personal calendar as a subscription link with checkboxes for training,
// games and helper duties (server: worker/routes/calendar.ts).
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useState } from "preact/hooks";
import { api } from "./api";
import { useMe } from "./session";
import { useQuery } from "./store";
import { Button, confirmDialog, copyText, Notice, Sheet, SwitchRow, toast } from "./ui";

interface CalendarPrefs {
  training: boolean;
  games: boolean;
  duties: boolean;
}

interface CalendarState extends CalendarPrefs {
  hasCalendar: boolean;
}

export function MyCalendar() {
  const me = useMe();
  const { data, mutate } = useQuery<CalendarState>("/profile/calendar");
  const [open, setOpen] = useState(false);
  if (!data) return null;
  const showDuties = me.helperTeams.length > 0 || me.referee;
  const set = async (key: keyof CalendarPrefs, value: boolean) => {
    const next = { ...data, [key]: value };
    // With a link save immediately, without one send it along when creating the link
    if (data.hasCalendar) await api.put("/profile/calendar", { training: next.training, games: next.games, duties: next.duties });
    mutate(next);
  };
  return (
    <section class="stack-sm" aria-label={t`My events`}>
      <h2 class="section-title">
        <Trans>My events</Trans>
      </h2>
      <p class="small muted">
        <Trans>Your events as a calendar on your phone, always up to date. Choose what it should contain.</Trans>
      </p>
      <ul class="list">
        <li>
          <SwitchRow label={t`Training and other events`} checked={data.training} onChange={(v) => set("training", v)} />
        </li>
        <li>
          <SwitchRow label={t`Games`} sub={t`All games of your teams, with meeting point if you are nominated`} checked={data.games} onChange={(v) => set("games", v)} />
        </li>
        {showDuties ? (
          <li>
            <SwitchRow label={t`Helper duties`} checked={data.duties} onChange={(v) => set("duties", v)} />
          </li>
        ) : null}
      </ul>
      <Button icon="calendar" onClick={() => setOpen(true)}>
        {data.hasCalendar ? t`Calendar link` : t`Subscribe in calendar`}
      </Button>
      {open ? (
        <CalendarSheet
          state={data}
          onClose={() => setOpen(false)}
          onChange={(hasCalendar) => mutate({ ...data, hasCalendar })}
        />
      ) : null}
    </section>
  );
}

function CalendarSheet(props: { state: CalendarState; onClose: () => void; onChange: (hasCalendar: boolean) => void }) {
  const { state } = props;
  const [url, setUrl] = useState<string | null>(null);
  const webcal = url?.replace(/^https?:/, "webcal:");
  const create = async () => {
    const res = await api.post<{ url: string }>("/profile/calendar-token", { training: state.training, games: state.games, duties: state.duties });
    setUrl(res.url);
    props.onChange(true);
  };
  return (
    <Sheet open onClose={props.onClose} title={t`My events in the calendar`}>
      <p class="muted">
        <Trans>
          With a personal link your events appear in the calendar app on your phone and stay up to date. Do not share the link: anyone who has it can see your
          events.
        </Trans>
      </p>
      {url ? (
        <div class="stack-sm">
          <a class="btn btn-primary" href={webcal}>
            <Trans>Subscribe in calendar</Trans>
          </a>
          <div class="url-box">{url}</div>
          <div class="btn-row">
            <Button icon="copy" onClick={() => copyText(url, t`Link copied.`)}>
              <Trans>Copy link</Trans>
            </Button>
            <a class="btn" href={url} download="kabine.ics">
              <Trans>Download as file</Trans>
            </a>
          </div>
          <p class="small muted">
            <Trans>If subscribing does not work, copy the link and paste it in the calendar app under “Add subscribed calendar” or “Add by URL”.</Trans>
          </p>
          <p class="small muted">
            <Trans>
              Google Calendar: on a computer, go to calendar.google.com → Other calendars → From URL and paste the link. It then also appears in the app. Google
              only updates every few hours.
            </Trans>
          </p>
        </div>
      ) : state.hasCalendar ? (
        <div class="stack-sm">
          <Notice>
            <Trans>
              You already have a calendar link. For security reasons the app does not show it again. A new link makes the old one invalid, then you have to
              subscribe again.
            </Trans>
          </Notice>
          <Button variant="primary" icon="calendar" onClick={create}>
            <Trans>Create new link</Trans>
          </Button>
          <Button
            variant="danger"
            onClick={async () => {
              if (
                !(await confirmDialog({
                  title: t`Remove calendar link?`,
                  message: t`The calendar on your devices will no longer be updated afterwards.`,
                  confirmLabel: t`Remove`,
                  danger: true,
                }))
              )
                return;
              await api.del("/profile/calendar-token");
              props.onChange(false);
              toast(t`Calendar link removed.`);
              props.onClose();
            }}
          >
            <Trans>Remove link</Trans>
          </Button>
        </div>
      ) : (
        <Button variant="primary" icon="calendar" onClick={create}>
          <Trans>Create link</Trans>
        </Button>
      )}
    </Sheet>
  );
}
