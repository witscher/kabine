// Release notes the app shows to admins after an update (src/news.tsx), translated like every text.
// CHANGELOG.md has the full notes for GitHub and the update pull requests; every version there needs an
// entry here and the other way round, newest first (test/changelog.test.ts). The first entry is the
// installed version (package.json). Items players and parents notice too are wrapped in `everyone(…)`;
// Help → What's new (src/pages/whats-new.tsx) lists only those.
import { t } from "@lingui/core/macro";

export interface ChangelogEntry {
  /** "0.2.0", without the "v" */
  version: string;
  /** Release day, YYYY-MM-DD */
  date: string;
  /** A few short lines for admins: what changes for the club. Wrap the ones players and parents notice in `everyone(…)`. */
  items: () => ChangelogItem[];
  /**
   * Lines for coaches (and admins) about coach features, shown to them in the news card after an update
   * (worker/domain/news.ts). Optional; most releases have none.
   */
  coaches?: () => CoachNote[];
}

/** A release note for admins; `everyone` marks one that players and parents notice too (Help → What's new). */
export type ChangelogItem = string | { text: string; everyone: true };

/** Marks a release note that players and parents notice too: written so that they understand it. */
export const everyone = (text: string): ChangelogItem => ({ text, everyone: true });

export const itemText = (item: ChangelogItem): string => (typeof item === "string" ? item : item.text);

/** A release note for coaches; `example` shows a sample under the text (src/news.tsx). */
export interface CoachNote {
  text: string;
  example?: "coach-buttons";
}

export const CHANGELOG: readonly ChangelogEntry[] = [
  {
    version: "1.0.0",
    date: "2026-11-28",
    items: () => [
      t`Kabine 1.0: the first stable release. The modules Polls, Fans and Home game day are no longer beta; switch them on under Administration → Modules.`,
      everyone(t`Played games show the result with "Win", "Draw" or "Loss"; players under 14 also see the club mascot when the club has uploaded one.`),
      everyone(t`Fans: follow other teams of the club under Profile → Fan of … and see their games on the start page (when the club has switched it on).`),
      everyone(t`Home game day: when many teams play at home on one day, everyone involved gets a message the day before and a card on the start page.`),
      everyone(t`On the start page, the team buttons each switch their team on and off.`),
      everyone(t`Notifications older than a day are closed by themselves.`),
      t`Game schedules from handball4all and handball.net sync by themselves after games and once a week, from a coach's device; games show the league table.`,
      t`Groups can be marked as training groups: their events count as training on the start page.`,
      t`New module (beta): club mascot, pictures for results and home game days.`,
      t`Administration is grouped, modules have a page of their own with a link to their documentation on kabine.dev, and help and feedback is at the top of the profile.`,
      t`Update notices: Administration → Updates and maintenance shows when a new version is available, with a push to admins (can be switched off).`,
    ],
    coaches: () => [
      {
        text: t`Game schedules now sync by themselves: after a game without a result and once a week, when you open the app. The button stays for short-notice changes. Game pages show the league table.`,
      },
      {
        text: t`On your event you see under "Elsewhere the same day" where your players take part in other teams or groups that day, with time and status, never the reason.`,
      },
    ],
  },
  {
    version: "0.9.0",
    date: "2026-11-19",
    items: () => [
      t`New module (beta): polls. Coaches ask their team, admins the whole club: choose an answer, find a date or collect orders with payment. Switch it on under Administration → Modules.`,
      t`Game schedules from handball.net for associations on Handball360, like handball4all; the schedule also syncs once a week when a coach opens the app.`,
      t`Helper duties: helpers from other teams, teams taking turns game by game, duties the coach assigns, and helper duties at club events.`,
      everyone(t`Special events can be without responses, optional, or with registration per family (each family says how many come).`),
      everyone(t`An event that has started stays under Upcoming until it ends; when the next event is today, its card is highlighted.`),
      everyone(t`The app asks once on each device whether to turn on notifications.`),
      everyone(t`Notifications about your child now name your child, e.g. "Is Mia coming?".`),
      everyone(t`New: Help → What's new shows what changed for players and parents.`),
      t`Parent link for one child: coaches create it at the player (admins also under Administration → People); it is valid for both parents of that child.`,
      t`Admins who are only parents can switch "Work as admin" off in their profile.`,
      t`Unexpected errors show a general message, under overload a hint to try again later; from the third error of a day the owner gets an e-mail.`,
      t`Security: opening the sign-in page or an invitation link no longer uses up the account's daily storage writes.`,
    ],
    coaches: () => [
      {
        text: t`New: a parent link for one child. Open the player in your squad and tap "Parent link for …": you get a link with a text to send to the parents directly, e.g. when they are not in the group chat. It links only this child, works for both parents and is valid for 7 days. Once your team is set up, the team's parent link points you to this instead.`,
      },
      {
        text: t`Helper duties: a duty type can now be assigned by the coach, then nobody signs up themselves and you pick the people. Duties can also come from other teams, e.g. youth teams wiping the floor at adult games; those teams find them in the Helpers tab under "Help out".`,
      },
    ],
  },
  {
    version: "0.8.0",
    date: "2026-11-10",
    items: () => [
      everyone(t`Statistics: coaches find them on the team page (training, games, helpers), players and parents under Profile → My statistics.`),
      t`Duties that need prior knowledge can now be approved by an admin, under Administration → Approvals. Youth referees are such an approval now; existing youth referees were taken over.`,
      t`New team setting "Whole team at games": every player comes along, the nomination only decides who plays.`,
      t`Settings explain themselves behind a small "i", with an example.`,
      everyone(t`Helpers tab: all your teams together, a tap on a team filters.`),
      everyone(t`When a child is marked unexcused after an event, the parents get a push at once.`),
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
      everyone(t`Chat: the chat list shows how many messages are unread and puts chats with news on top; a chat opens at the first unread message.`),
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
      everyone(t`Only admins change their own name; everyone else asks their coach or an admin.`),
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
      everyone(t`Player invitation links opened on a signed-in device lead straight to the app; nobody can pick a teammate's name there.`),
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
      everyone(t`Events cancelled for everyone now read “Not taking place”.`),
      everyone(t`Invitation links are for setting up only; opened again, they lead straight to the app.`),
    ],
  },
  {
    version: "0.1.0",
    date: "2026-10-18",
    items: () => [everyone(t`First release of Kabine.`)],
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

/**
 * Help → What's new: the versions with notes for players and parents, released after the club started with the
 * app (club profile `startedOn`, YYYY-MM-DD; null: all of them), newest first.
 */
export function everyoneEntries(startedOn: string | null, entries: readonly ChangelogEntry[] = CHANGELOG): { version: string; date: string; items: string[] }[] {
  return entries
    .filter((e) => !startedOn || e.date > startedOn)
    .map((e) => ({ version: e.version, date: e.date, items: e.items().flatMap((i) => (typeof i === "string" ? [] : [i.text])) }))
    .filter((e) => e.items.length > 0);
}

/** Entries newer than the version someone has seen. */
export function entriesSince(seen: string): ChangelogEntry[] {
  return CHANGELOG.filter((e) => compareVersions(e.version, seen) > 0);
}
