import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { moduleOn } from "../../shared/club";
import { useClub } from "../club";
import { MODULES } from "../../shared/modules";
import { useSession } from "../session";
import { TopBar, useDocumentTitle } from "../ui";

export function PrivacyPage() {
  useDocumentTitle(t`Privacy`);
  const { me } = useSession();
  const club = useClub();
  const clubName = club.name;
  const host = club.privacyUrl ? new URL(club.privacyUrl).host : "";
  const on = (m: Parameters<typeof moduleOn>[1]) => moduleOn(club.modules, m);
  return (
    <main class={`page ${me ? "" : "no-tabs"}`}>
      <TopBar title={t`Privacy and sources`} back={me ? "/profil" : "/"} />
      <div class="content">
        <section class="card card-pad stack">
          <h2 style={{ fontSize: "22px" }}>
            <Trans>Responsible</Trans>
          </h2>
          <p>
            <Trans>The app is an internal service of {clubName}.</Trans>{" "}
            {club.privacyUrl ? (
              <>
                <Trans>
                  You can find the club's full privacy policy and legal notice at <a href={club.privacyUrl}>{host}</a>.
                </Trans>{" "}
              </>
            ) : null}
            <Trans>The following notes describe what is stored specifically in this app.</Trans>
          </p>
          {club.privacyText ? <p style={{ whiteSpace: "pre-line" }}>{club.privacyText}</p> : null}
        </section>
        <section class="card card-pad stack">
          <h2 style={{ fontSize: "22px" }}>
            <Trans>What data does the app store?</Trans>
          </h2>
          <p>
            {on("sms") ? (
              <Trans>
                Of players and parents only first name, last name and (for players) the year of birth. No address. Admins can additionally be identified by their
                e-mail address.
              </Trans>
            ) : (
              <Trans>
                Of players and parents only first name, last name and (for players) the year of birth. No phone number, no address. Admins can additionally be
                identified by their e-mail address.
              </Trans>
            )}
          </p>
          {on("sms") ? (
            <p>
              <Trans>
                A mobile number is only stored if you enter it yourself, for sign-in codes and reminders by text message. Nobody else sees it. You can delete it in
                your profile at any time. The messages are sent through a text message provider the club has chosen.
              </Trans>
            </p>
          ) : null}
          <p>
            <Trans>
              The e-mail address on your access is used for signing in. Helper plan reminders only come by e-mail if you switch this on in your profile. With
              feedback it is only sent along if you want a reply. Otherwise nobody sees it, not even coaches and admins.
            </Trans>
          </p>
          <p>
            <Trans>
              A profile picture is optional. Everyone signed in to the app can see it. For minors, a parent approves the picture before others see it. You can
              remove your picture at any time; it is deleted when you leave the club.
            </Trans>
          </p>
          <p>
            <Trans>
              Also technically necessary are: passkeys (only a public key, never biometric data), sign-ins on devices and push subscriptions for notifications.
              So that the app also works without network, it stores the last loaded content on your device. It is deleted when you sign out.
            </Trans>
          </p>
          <p>
            <Trans>
              Only coaches and admins see responses with reasons. Please do not give any details about illnesses when declining, “ill” is enough. Reasons are
              deleted automatically 60 days after the event.
            </Trans>
          </p>
          <p>
            <Trans>
              Team staff such as a physio or team manager see who accepted or declined, without reasons. If a team switches on “responses visible to everyone”,
              its players and parents see the same for trainings and special events.
            </Trans>
          </p>
          <p>
            <Trans>Feedback via “Help and feedback” goes by e-mail to the people who run the app for the club and is not stored in the app.</Trans>
          </p>
          <p>
            <Trans>For each access the app stores the day of last use, without time. Only admins see it, so they can spot unused accesses.</Trans>
          </p>
          <p>
            <Trans>Chat histories are deleted at the season change. After someone leaves the club, all their data is deleted at the next season change at the latest.</Trans>
          </p>
        </section>
        <ModulePrivacy />
        <section class="card card-pad stack">
          <h2 style={{ fontSize: "22px" }}>
            <Trans>Sources</Trans>
          </h2>
          <p>
            <Trans>
              School holidays: <a href="https://www.openholidaysapi.org">OpenHolidays API</a>, data under the{" "}
              <a href="https://opendatacommons.org/licenses/odbl/">Open Database License (ODbL)</a>.
            </Trans>
          </p>
          {on("handball4all") ? (
            <p>
              <Trans>Game schedules: handball4all. They are only fetched from the device of a coach or admin.</Trans>
            </p>
          ) : null}
          <p>
            <Trans>
              Helper plan icon: <a href="https://lucide.dev">Lucide</a> (ISC licence).
            </Trans>
          </p>
          <p>
            <Trans>Fonts: Barlow and Barlow Condensed (SIL Open Font License), served directly by this app.</Trans>
          </p>
        </section>
      </div>
    </main>
  );
}

/** What the club's active modules store, from their manifests (modules/<id>/module.ts, privacy()). */
function ModulePrivacy() {
  const club = useClub();
  const list = MODULES.filter((m) => moduleOn(club.modules, m.id))
    .map((m) => ({ label: m.label(), privacy: m.privacy() }))
    .filter((m) => m.privacy);
  if (!list.length) return null;
  return (
    <section class="card card-pad stack">
      <h2 style={{ fontSize: "22px" }}>
        <Trans>Functions of this club</Trans>
      </h2>
      {list.map(({ label, privacy }) => (
        <div class="stack-sm">
          <h3 style={{ fontSize: "18px" }}>{label}</h3>
          <p>
            <strong>
              <Trans>Stored:</Trans>
            </strong>{" "}
            {privacy!.stores}
          </p>
          <p>
            <strong>
              <Trans>Visible to:</Trans>
            </strong>{" "}
            {privacy!.visibleTo}
          </p>
          <p>
            <strong>
              <Trans>Deleted:</Trans>
            </strong>{" "}
            {privacy!.deleted}
          </p>
        </div>
      ))}
    </section>
  );
}
