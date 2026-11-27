// Pages of the fans module: Profile → Fan of … (follow teams, switches) and the page of a game one follows.
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useState } from "preact/hooks";
import { api } from "../../../src/api";
import { clubShort } from "../../../src/club";
import { fullDate, time } from "../../../src/format";
import { Icon } from "../../../src/icons";
import { LeagueTableCard } from "../../../src/league-table";
import { GameLinks, isLiveWindow, isReportWindow } from "../../../src/live";
import { invalidate, useQuery } from "../../../src/store";
import { ErrorBox, Notice, Spinner, SwitchRow, toast, TopBar, useDocumentTitle } from "../../../src/ui";
import type { FanGamePage, FollowTeam, FollowView } from "../types";
import { clubButtonEnabled, setClubButtonEnabled } from "./list";

const followLabel = (name: string) => t`Follow ${name}`;

/** Profile → Fan of …: follow other teams of the club. */
export function FollowPage() {
  useDocumentTitle(t`Fan of …`);
  const { data, error, reload, mutate } = useQuery<FollowView>("/fans/follows");
  const [clubButton, setClubButton] = useState(clubButtonEnabled);
  const short = clubShort();
  const toggle = async (tm: FollowTeam) => {
    mutate(await api.put<FollowView>(`/fans/follows/${tm.id}`, { follow: !tm.following }));
    const name = tm.name;
    toast(tm.following ? t`You no longer follow ${name}.` : t`You now follow ${name}.`);
    invalidate("/events", "/me/notifications");
  };
  return (
    <main class="page">
      <TopBar title={t`Fan of …`} kicker={t`Profile`} back="/profil" />
      <div class="content">
        <p class="muted">
          <Trans>
            Follow other teams of the club as a fan. Their games appear in your event list under the star, without responses and without names. If a game
            is moved or cancelled at short notice, you get a message. Nobody else sees whom you follow.
          </Trans>
        </p>
        {error ? <ErrorBox error={error} onRetry={reload} /> : null}
        {!data && !error ? <Spinner /> : null}
        {data ? (
          <ul class="list" aria-label={t`Settings as a fan`}>
            <li>
              <SwitchRow
                label={t`Home games only`}
                sub={t`Of the teams you follow, only the games at home, also for messages and the calendar`}
                checked={data.homeOnly}
                onChange={async (homeOnly) => {
                  mutate(await api.put<FollowView>("/fans/settings", { homeOnly }));
                  invalidate("/events");
                }}
              />
            </li>
            <li>
              <SwitchRow
                label={t`Button “${short}” in the event list`}
                sub={t`Shows all games of the club, your own ones as usual. Only on this device.`}
                checked={clubButton}
                onChange={(on) => {
                  setClubButtonEnabled(on);
                  setClubButton(on);
                }}
              />
            </li>
          </ul>
        ) : null}
        {data ? (
          <ul class="list" aria-label={t`Teams`}>
            {data.teams.map((tm) => (
              <li class="list-row" key={tm.id}>
                <span class="main">
                  <span class="title">{tm.name}</span>
                  {tm.own ? (
                    <span class="sub">
                      <Trans>Your team</Trans>
                    </span>
                  ) : tm.following ? (
                    <span class="sub">
                      <Trans>Games in your event list</Trans>
                    </span>
                  ) : null}
                </span>
                {tm.own ? null : (
                  <button
                    type="button"
                    class="star-toggle"
                    aria-pressed={tm.following ? "true" : "false"}
                    aria-label={followLabel(tm.name)}
                    onClick={() => void toggle(tm)}
                  >
                    <Icon name="star" size={20} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </main>
  );
}

/** A game of the club as a fan: kick-off, venue, opponent, result, live link. No squad, responses or names. */
export function FanGamePage({ id }: { id: string }) {
  const { data: g, error, reload } = useQuery<FanGamePage>(`/fans/games/${id}`);
  useDocumentTitle(g ? g.title : t`Game`);
  const team = g ? g.teams.map((tm) => tm.name).join(" + ") : "";
  const kickoff = g ? time(g.startsAt) : "";
  const home = g?.result?.home;
  const guest = g?.result?.guest;
  return (
    <main class="page">
      <TopBar title={t`Game`} kicker={g?.following ? t`${team} · Fan` : team} back="/" />
      <div class="content">
        {error ? <ErrorBox error={error} onRetry={reload} /> : null}
        {!g && !error ? <Spinner /> : null}
        {g ? (
          <>
            <section class="card" aria-label={g.title}>
              <div class="card-head fan-game-head">
                <span class="label">
                  {g.isHome === true ? t`Home game` : g.isHome === false ? t`Away game` : t`Game`} · <span class="nocaps">{team}</span>
                </span>
              </div>
              <div class="card-pad stack-sm">
                <h2 style={{ margin: 0 }}>{g.title}</h2>
                {g.cancelled ? (
                  <span class="cancel-tag" style={{ alignSelf: "flex-start" }}>
                    <Trans>Not taking place</Trans>
                  </span>
                ) : null}
                <div class="row-gap">
                  <Icon name="clock" size={18} />
                  <span>
                    {fullDate(g.startsAt)} · <Trans>Kick-off {kickoff}</Trans>
                  </span>
                </div>
                {g.location ? (
                  <div class="row-gap">
                    <Icon name="pin" size={18} />
                    {g.location.mapUrl ? (
                      <a href={g.location.mapUrl} target="_blank" rel="noopener noreferrer">
                        {g.location.name}
                      </a>
                    ) : (
                      <span>{g.location.name}</span>
                    )}
                  </div>
                ) : null}
                {g.result ? (
                  <div class="row-gap">
                    <Icon name="check" size={18} />
                    <span>
                      <Trans>
                        Result {home}:{guest}
                      </Trans>
                    </span>
                  </div>
                ) : null}
              </div>
            </section>
            {isLiveWindow(g) ? (
              <section class="stack-sm" aria-label={t`Game in progress`}>
                <span class="live-label on-light">
                  <span class="today-dot" aria-hidden="true" />
                  <Trans>Game in progress</Trans>
                </span>
                <GameLinks event={g} phase="live" />
              </section>
            ) : isReportWindow(g) ? (
              <GameLinks event={g} phase="after" />
            ) : null}
            {g.standings ? <LeagueTableCard table={g.standings} /> : null}
            <Notice>
              {g.following ? t`You follow ${team} as a fan.` : null}{" "}
              <Trans>Only the team's players, parents and coaches see the squad, responses and carpools.</Trans>
            </Notice>
            <a class="btn btn-block" href="/profil/fan">
              <Icon name="star" size={18} />
              <Trans>Follow teams</Trans>
            </a>
          </>
        ) : null}
      </div>
    </main>
  );
}
