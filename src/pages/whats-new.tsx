// Help → What's new: what players and parents notice, from the release notes (shared/changelog.ts, items marked
// `everyone`), newest first, only releases after the club started with the app (club profile `startedOn`).
// At the very end, when the start is known, the app's birth announcement.
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { everyoneEntries } from "../../shared/changelog";
import { useClub } from "../club";
import { fullDate } from "../format";
import { TopBar, useDocumentTitle } from "../ui";

export function WhatsNewPage() {
  const club = useClub();
  const title = t`What's new`;
  useDocumentTitle(title);
  const entries = everyoneEntries(club.startedOn);
  const started = club.startedOn ? fullDate(club.startedOn) : null;
  return (
    <main class="page">
      <TopBar title={title} kicker={t`Help`} back="/hilfe" />
      <div class="content">
        <p class="muted">
          {started ? <Trans>What has come to the app since your club started with it on {started}.</Trans> : <Trans>What has come to the app, newest first.</Trans>}
        </p>
        {entries.map((e) => {
          const date = fullDate(e.date);
          return (
            <section class="stack-sm" aria-label={date}>
              <h2 class="section-title">{date}</h2>
              <ul class="card card-body news-items whats-new-items">
                {e.items.map((item) => (
                  <li>{item}</li>
                ))}
              </ul>
            </section>
          );
        })}
        {started && !entries.length ? (
          <p class="muted">
            <Trans>Nothing new since the start yet. After updates you find here what changed for players and parents.</Trans>
          </p>
        ) : null}
        {started ? <BirthCard club={club.shortName} date={started} /> : null}
      </div>
    </main>
  );
}

const STARS = [
  { x: 8, y: 14, s: 16, d: 0 },
  { x: 88, y: 10, s: 22, d: 0.6 },
  { x: 92, y: 86, s: 14, d: 1.2 },
  { x: 3, y: 88, s: 12, d: 1.8 },
  { x: 50, y: 6, s: 10, d: 2.4 },
  { x: 94, y: 44, s: 10, d: 0.9 },
];

/** At the very beginning: the app's birth announcement, with twinkling stars (still without motion if reduced). */
function BirthCard({ club, date }: { club: string; date: string }) {
  return (
    <section class="card card-pad whats-new-birth" aria-label={t`Start of the app`}>
      {STARS.map((st) => (
        <svg class="birth-star" viewBox="0 0 24 24" aria-hidden="true" style={{ left: `${st.x}%`, top: `${st.y}%`, width: `${st.s}px`, height: `${st.s}px`, animationDelay: `${st.d}s` }}>
          <path d="M12 0c.6 6.2 5.8 11.4 12 12-6.2.6-11.4 5.8-12 12-.6-6.2-5.8-11.4-12-12C6.2 11.4 11.4 6.2 12 0z" fill="currentColor" />
        </svg>
      ))}
      <div class="kicker">{club}</div>
      <h2 class="birth-title">
        <Trans>The app is born</Trans>
      </h2>
      <p class="birth-facts">
        <Trans>Born on {date}</Trans>
        <br />
        <Trans>Size: fits on every phone</Trans>
        <br />
        <Trans>Weight: lighter than a sports bag</Trans>
      </p>
      <p class="small muted">
        <Trans>Events, responses, squads and team chat in one app, signing in with a passkey instead of a password.</Trans>
      </p>
    </section>
  );
}
