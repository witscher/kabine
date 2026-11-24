// Pages of the home game day module: the page of the day (people involved and admins) and the settings for admins.
import { plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { api, errorMessage } from "../../../src/api";
import { fullDate, time } from "../../../src/format";
import { Icon } from "../../../src/icons";
import { GameLinks, isLiveWindow } from "../../../src/live";
import { AdminOnly } from "../../../src/pages/admin";
import { useQuery } from "../../../src/store";
import { Button, ErrorBox, Segmented, Spinner, SwitchRow, toast, TopBar, useDocumentTitle } from "../../../src/ui";
import { GAMEDAY_HOURS, type GamedayDetail, type GamedayGame, type GamedaySettings, type GamedaySettingsView } from "../types";
import { mascotUrl } from "./list";

/** All home games of the day; own and followed ones marked, the live link while a game runs, open helper slots. */
export function GamedayPage({ date }: { date: string }) {
  useDocumentTitle(t`Home game day`);
  const { data: d, error, reload } = useQuery<GamedayDetail>(`/gameday/days/${date}`);
  const count = d?.teams ?? 0;
  const first = d ? time(d.first) : "";
  const last = d ? time(d.last) : "";
  const mascot = d ? mascotUrl(d.mascotVersion) : null;
  const open = d?.helpersNeeded ?? 0;
  return (
    <main class="page">
      <TopBar title={t`Home game day`} kicker={d ? fullDate(d.date) : undefined} back="/" />
      <div class="content">
        {error ? <ErrorBox error={error} onRetry={reload} /> : null}
        {!d && !error ? <Spinner /> : null}
        {d ? (
          <>
            <section class="card gameday-day" aria-label={t`Games of the day`}>
              <div class="card-pad stack-sm gameday-day-head">
                {d.hall ? (
                  <div class="row-gap">
                    <Icon name="pin" size={18} />
                    <strong>{d.hall}</strong>
                  </div>
                ) : null}
                <div class="small muted">
                  {plural(count, { one: "# team", other: "# teams" })} · <Trans>{first} to {last}</Trans>
                </div>
                {mascot ? <img class="gameday-day-mascot" src={mascot} alt="" width={72} height={80} decoding="async" /> : null}
              </div>
              {d.games.map((g) => (
                <GameItem key={g.id} game={g} />
              ))}
            </section>
            {open > 0 ? (
              <section class="card card-pad stack-sm" aria-label={t`Helpers wanted`}>
                <strong>
                  <Trans>Helpers wanted</Trans>
                </strong>
                <div class="small muted">{plural(open, { one: "One place in the helper plan is still free on this day.", other: "# places in the helper plan are still free on this day." })}</div>
                <a class="btn btn-sm" href="/helfer" style={{ alignSelf: "flex-start" }}>
                  <Trans>Sign up in the helper plan</Trans>
                </a>
              </section>
            ) : null}
          </>
        ) : null}
      </div>
    </main>
  );
}

function GameItem({ game: g }: { game: GamedayGame }) {
  const live = isLiveWindow(g);
  const body = (
    <>
      <span class="gameday-item-time">{time(g.startsAt)}</span>
      <span class="main">
        <span class="title">{g.title}</span>
        {g.own ? (
          <span class="sub">
            <Trans>your team</Trans>
          </span>
        ) : null}
        {g.fan ? (
          <span class="gameday-fan">
            <Icon name="star" size={13} />
            <Trans>Fan</Trans>
          </span>
        ) : null}
        {g.location ? <span class="sub">{g.location}</span> : null}
      </span>
    </>
  );
  return (
    <div class={`gameday-item ${g.own ? "mine" : ""}`}>
      {g.href ? (
        <a class="gameday-item-row" href={g.href}>
          {body}
        </a>
      ) : (
        <div class="gameday-item-row">{body}</div>
      )}
      {live ? (
        <div class="gameday-item-live">
          <span class="gameday-live-label">
            <span class="today-dot" aria-hidden="true" />
            <Trans>In progress</Trans>
          </span>
          <GameLinks event={g} phase="live" />
        </div>
      ) : null}
    </div>
  );
}

/** Administration → Home game days: the push the day before, from how many teams, at which hour, the mascot. */
export function AdminGamedayPage() {
  useDocumentTitle(t`Home game days`);
  const { data, error, reload } = useQuery<GamedaySettingsView>("/gameday/settings");
  const save = async (patch: Partial<GamedaySettings>) => {
    if (!data) return;
    try {
      await api.put("/gameday/settings", { enabled: data.enabled, minTeams: data.minTeams, hour: data.hour, ...patch });
      await reload();
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  };
  const upload = async (file: File | undefined) => {
    if (!file) return;
    try {
      await api.upload("/gameday/mascot", file);
      await reload();
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  };
  const mascot = data ? mascotUrl(data.mascotVersion) : null;
  const next = data?.next;
  const nextDate = next ? fullDate(next.date) : "";
  const sendDate = next ? fullDate(next.sendAt) : "";
  const sendTime = next ? next.sendAt.slice(11) : "";
  const nextTeams = next?.teams ?? 0;
  const nextRecipients = next?.recipients ?? 0;
  return (
    <AdminOnly>
      <main class="page">
        <TopBar title={t`Home game days`} kicker={t`Administration`} back="/verwaltung" />
        <div class="content">
          <p class="muted">
            <Trans>
              When many teams play at home on the same day, everyone involved gets a message the day before: players, parents and coaches of the teams
              that play, their fans and whoever has a helper duty that day. They also see a card on the start page and the overview of the day.
            </Trans>
          </p>
          {error ? <ErrorBox error={error} onRetry={reload} /> : null}
          {!data && !error ? <Spinner /> : null}
          {data ? (
            <>
              <SwitchRow label={t`Message the day before`} sub={t`Push to everyone involved`} checked={data.enabled} onChange={(enabled) => save({ enabled })} />
              <section class="card card-pad stack-sm" aria-label={t`From how many teams`}>
                <strong>
                  <Trans>From how many teams</Trans>
                </strong>
                <div class="row-gap">
                  <div class="stepper" role="group" aria-label={t`Teams`}>
                    <button type="button" class="icon-btn" aria-label={t`One team fewer`} disabled={data.minTeams <= 2} onClick={() => save({ minTeams: data.minTeams - 1 })}>
                      −
                    </button>
                    <span class="stepper-value" aria-live="polite">
                      {data.minTeams}
                    </span>
                    <button type="button" class="icon-btn" aria-label={t`One team more`} disabled={data.minTeams >= 20} onClick={() => save({ minTeams: data.minTeams + 1 })}>
                      +
                    </button>
                  </div>
                  <span class="muted">
                    <Trans>teams with a home game on the same day</Trans>
                  </span>
                </div>
              </section>
              <section class="card card-pad stack-sm" aria-label={t`Time the day before`}>
                <strong>
                  <Trans>Time the day before</Trans>
                </strong>
                <Segmented<string>
                  label={t`Time`}
                  value={String(data.hour)}
                  onChange={(v) => save({ hour: Number(v) as GamedaySettings["hour"] })}
                  options={GAMEDAY_HOURS.map((h) => ({ value: String(h), label: t`${h}:00` }))}
                />
              </section>
              <section class="card card-pad stack-sm" aria-label={t`Mascot`}>
                <strong>
                  <Trans>Mascot</Trans>
                </strong>
                <p class="small muted">
                  <Trans>Optional: a picture of the club's mascot on the card and the tiles. PNG, JPEG or WebP, at most 256 KB. Without one, no picture is shown.</Trans>
                </p>
                {mascot ? <img class="gameday-admin-mascot" src={mascot} alt={t`Mascot`} width={118} height={132} /> : null}
                <div class="row-gap">
                  <label class="btn btn-dashed">
                    <Trans>Upload picture</Trans>
                    <input type="file" accept="image/png,image/jpeg,image/webp" class="sr-only" onChange={(e) => void upload((e.target as HTMLInputElement).files?.[0])} />
                  </label>
                  {mascot ? (
                    <Button
                      variant="ghost"
                      icon="trash"
                      onClick={async () => {
                        await api.del("/gameday/mascot");
                        await reload();
                      }}
                    >
                      <Trans>Remove picture</Trans>
                    </Button>
                  ) : null}
                </div>
              </section>
              <section class="card card-pad stack-sm" aria-label={t`Next home game day`}>
                <strong>
                  <Trans>Next home game day</Trans>
                </strong>
                {next ? (
                  <p class="small muted">
                    {data.enabled
                      ? plural(nextRecipients, {
                          one: `${nextDate} · ${nextTeams} teams · the message goes out on ${sendDate} at ${sendTime} (to # access)`,
                          other: `${nextDate} · ${nextTeams} teams · the message goes out on ${sendDate} at ${sendTime} (to # accesses)`,
                        })
                      : t`${nextDate} · ${nextTeams} teams · no message the day before`}
                  </p>
                ) : (
                  <p class="small muted">
                    <Trans>None in the next three months.</Trans>
                  </p>
                )}
              </section>
            </>
          ) : null}
        </div>
      </main>
    </AdminOnly>
  );
}
