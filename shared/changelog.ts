// Release notes the app shows to admins after an update (src/news.tsx), translated like every text.
// CHANGELOG.md has the full notes for GitHub and the update pull requests; every version there needs an
// entry here and the other way round, newest first (test/changelog.test.ts). The first entry is the
// installed version (package.json).
import { t } from "@lingui/core/macro";

export interface ChangelogEntry {
  /** "0.2.0", without the "v" */
  version: string;
  /** Release day, YYYY-MM-DD */
  date: string;
  /** A few short lines for admins: what changes for the club. */
  items: () => string[];
  /**
   * Lines for coaches (and admins) about coach features, shown to them in the news card after an update
   * (worker/domain/news.ts). Optional; most releases have none.
   */
  coaches?: () => CoachNote[];
}

/** A release note for coaches; `example` shows a sample under the text (src/news.tsx). */
export interface CoachNote {
  text: string;
  example?: "coach-buttons";
}

export const CHANGELOG: readonly ChangelogEntry[] = [
  {
    version: "0.8.0",
    date: "2026-11-10",
    items: () => [
      t`Statistics: coaches find them on the team page (training, games, helpers), players and parents under Profile → My statistics.`,
      t`Duties that need prior knowledge can now be approved by an admin, under Administration → Approvals. Youth referees are such an approval now; existing youth referees were taken over.`,
      t`New team setting "Whole team at games": every player comes along, the nomination only decides who plays.`,
      t`Settings explain themselves behind a small "i", with an example.`,
      t`Helpers tab: all your teams together, a tap on a team filters.`,
      t`When a child is marked unexcused after an event, the parents get a push at once.`,
      t`New: Administration → Protocol shows who removed an access, changed admin rights, members or game schedules, and when.`,
      t`Several security fixes for sign-in codes, personal links, restoring an export and the chat.`,
    ],
    coaches: () => [
      {
        text: t`Your team page now has "Statistics": for the last 4 weeks and the whole season, who came to training how often, how many were really there at each training, appearances in games, and declines at short notice or without excuse. With the helper plan you also see which families have helped already and can remind the others with one button. Record after the training who was there, then the figures are right. If you set someone to "Unexcused", the parents get a push at once.`,
      },
      {
        text: t`New switch in your team's settings: "Whole team at games". When it is on, every player takes part in every game and declines if they cannot come; with the nomination you only decide who plays. Whoever is not nominated sees "Not nominated", still comes along and can join a carpool. Notifications about the game still go to the nominated players only. The small "i" next to the switch explains it with an example.`,
      },
    ],
  },
  {
    version: "0.7.0",
    date: "2026-11-07",
    items: () => [
      t`Coach buttons: what only coaches and other leads can do is marked in the club's main colour with a whistle, in views players and parents see too.`,
      t`Chat: the chat list shows how many messages are unread and puts chats with news on top; a chat opens at the first unread message.`,
      t`Coaches now also see what is new for them after an update, in this card.`,
    ],
    coaches: () => [
      {
        text: t`What only you as a coach can do is now marked in the club's colour with a whistle, for example on the event page, in carpools and in the helper plan. Players and parents don't see these buttons.`,
        example: "coach-buttons",
      },
    ],
  },
  {
    version: "0.6.0",
    date: "2026-11-05",
    items: () => [
      t`Saving works the same everywhere: switches and choices save at once and show "Saved" right there; text fields have a save button in their own box that appears once you change something.`,
      t`Administration → Club saves each box on its own, without one button for the whole page.`,
      t`New page under Administration for the game schedule sync: all teams at a glance, and when coaches are reminded to sync (15, 30 or 60 days, or never).`,
    ],
  },
  {
    version: "0.5.0",
    date: "2026-11-04",
    items: () => [
      t`Legal notice and privacy policy: enter both links of your club under Administration → Club. The app shows them under every screen and every e-mail.`,
      t`Coaches see at the top of the events list what is left to do: a game without a meeting point, a game schedule not synced for 14 days.`,
      t`The person search for helper duties no longer puts names into the address of the request.`,
    ],
  },
  {
    version: "0.4.0",
    date: "2026-10-26",
    items: () => [
      t`Children in the app: under Administration → Age groups you set per youth class what children may do themselves; coaches can restrict it further for their team.`,
      t`Groups can include parents, for example a youth group across teams: switch it on in the group's settings.`,
      t`Demo and language links (?lang=en) no longer reload the app over and over.`,
    ],
  },
  {
    version: "0.3.1",
    date: "2026-10-22",
    items: () => [
      t`E-mail stays off until you set it up under Administration → E-mail: with your club's mail server, or Cloudflare Email Sending on the Workers Paid plan.`,
      t`Administration → Import is now called Import / restore: for the club's lists and Kabine backups.`,
    ],
  },
  {
    version: "0.3.0",
    date: "2026-10-22",
    items: () => [
      t`Import: teams, coaches and players from your club's Excel or CSV lists, checked before anything is created. Under Administration → Import and in the setup wizard.`,
      t`The same page takes back an export of Kabine, for example when moving to a new installation. You choose what to take over; nothing is deleted.`,
      t`Only admins change their own name; everyone else asks their coach or an admin.`,
    ],
  },
  {
    version: "0.2.3",
    date: "2026-10-20",
    items: () => [
      t`Training venues: add your club's halls or pitches and other venues under Administration → Training venues.`,
      t`KiHaSL/JuHaSL is now called “Jugendschiedsrichter” (youth referees).`,
      t`The dot for news like this one is now on the Events tab.`,
    ],
  },
  {
    version: "0.2.2",
    date: "2026-10-20",
    items: () => [
      t`School holidays and public holidays of your region now also load for the current season: under Administration → Holidays, and when you change the region.`,
      t`If nobody can get into the administration any more, whoever runs the installation can create an admin link (npm run admin:link).`,
    ],
  },
  {
    version: "0.2.1",
    date: "2026-10-20",
    items: () => [
      t`Player invitation links opened on a signed-in device lead straight to the app; nobody can pick a teammate's name there.`,
      t`Update pull requests on GitHub now open reliably. If your copy is on 0.2.0, replace the update workflow once, as the pull request says.`,
    ],
  },
  {
    version: "0.2.0",
    date: "2026-10-20",
    items: () => [
      t`Updates with database changes pause the app for about a minute and note a restore point. See Administration → Updates and maintenance, with the maintenance switch.`,
      t`Coaches, leads, staff and organisers can say “I'm not there” without cancelling the event.`,
      t`After an event coaches record attendance: present, excused or unexcused.`,
      t`Events cancelled for everyone now read “Not taking place”.`,
      t`Invitation links are for setting up only; opened again, they lead straight to the app.`,
    ],
  },
  {
    version: "0.1.0",
    date: "2026-10-18",
    items: () => [t`First release of Kabine.`],
  },
];

export const KABINE_VERSION = CHANGELOG[0]!.version;

/** Compares "1.2.3" versions: negative if a is older than b. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

/** Entries newer than the version someone has seen. */
export function entriesSince(seen: string): ChangelogEntry[] {
  return CHANGELOG.filter((e) => compareVersions(e.version, seen) > 0);
}
