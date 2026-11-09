// Explanations behind the info buttons (InfoButton in src/ui.tsx): plain language, with an example where it helps.
// One entry per setting; new switches on settings pages get their text here (docs/dev/design.md, Info buttons).
// Modules keep their own texts in their folder and pass them to InfoButton as an object.
import { t } from "@lingui/core/macro";

export interface HelpText {
  title: string;
  text: string;
  example?: string;
}

// Functions, so the texts are built in the language that is active when the button is opened
export const HELP = {
  autoSquad: () => ({
    title: t`Nominate the core squad automatically`,
    text: t`Whoever is in the core squad is nominated for every new game automatically, so you don't have to choose before every game. You can still change the squad for a single game. Instead of a notification about the nomination, a reminder comes three days before each game.`,
    example: t`Your 12 core players are in the squad for every game. If one cannot come, she declines herself. For the cup game you add a stand-in.`,
  }),
  gameAllPlayers: () => ({
    title: t`Whole team at games`,
    text: t`Every player of the team takes part in every game and declines if they cannot come. The nomination only decides who plays. Whoever is not nominated still comes along, sees “Not nominated” and can join a carpool. Notifications about the game go to the nominated players only.`,
    example: t`The team has 22 players. By Wednesday 4 decline. On Thursday you nominate 14 of the other 18. The other 4 still come along to the game.`,
  }),
  showResponses: () => ({
    title: t`Responses visible to everyone`,
    text: t`For trainings and special events, players and their parents see who accepted or declined. The reasons for declining stay visible to the coaches only. Games stay as they are. Better left off for youth teams, so that nobody is swayed by others declining.`,
    example: t`Before training Lena sees: 11 accepted, Mia and Paul declined. She does not see why.`,
  }),
  showResponsesGroup: () => ({
    title: t`Responses visible to everyone`,
    text: t`For special events, all members see who accepted or declined. Only the leads see the reasons.`,
  }),
  helperPlan: () => ({
    title: t`Helper plan`,
    text: t`Parents (or, in older teams, the players themselves) sign up for duties at games in the Helpers tab, such as cake & bar or washing the shirts. The template decides which duties there are.`,
    example: t`For Saturday's home game there are 2 places for cake & bar and 1 for washing the shirts. Families sign up in the Helpers tab.`,
  }),
  deadlines: () => ({
    title: t`Decline deadlines`,
    text: t`Up to this many hours before the start, players can decline without a note. Later declines are still possible, but count as short notice, and you get a notification.`,
    example: t`Deadline 6 hours, training at 6 pm: whoever declines after noon declines at short notice.`,
  }),
  parentsEnabled: () => ({
    title: t`Include parents`,
    text: t`Parents respond for their child, are in the chat and get the notifications. Turn it off when the players take responsibility themselves, for example in older youth teams and for adults.`,
    example: t`In the under-11s the parents respond. In the under-19s the players do it themselves, parents are not included there.`,
  }),
  parentsEnabledGroup: () => ({
    title: t`Include parents`,
    text: t`For a youth group: linked parents see the group's special events for their child, respond for it and are in the chat. Parents are linked through the child's team; groups have no parent links.`,
  }),
  childLimits: () => ({
    title: t`Children in the app`,
    text: t`Sets what the children of an age group may do in the app themselves. Without an own access, the parents do everything. Coaches can restrict this further for their team, and parents within that for their child. Adult classes are never limited.`,
    example: t`In the under-11s the children have no access of their own; the parents respond and are in the chat. From the under-13s the children accept and decline themselves.`,
  }),
  childLimitsTeam: () => ({
    title: t`Children in the app`,
    text: t`What the players of this team may do themselves. The club sets the limit per age group; here you can only restrict further. Within this, the parents decide for their child.`,
    example: t`The club allows the chat for the under-13s. In your team you set the chat to parents only.`,
  }),
  clubMember: () => ({
    title: t`Full club member`,
    text: t`A hidden marker that only admins see. Full club members can help organise special events and take on duties with “Who helps: members”.`,
  }),
  skillGrant: () => ({
    title: t`Approved by an admin`,
    text: t`This person may take the duty and sees it in the Helpers tab. Without the approval they do not see it at all. Coaches and admins can still enter anyone. For duties taken across teams, such as youth referee, the Helpers tab lists all games that still need someone.`,
    example: t`Only whoever has done the tournament management before is approved for it.`,
  }),
  adminMode: () => ({
    title: t`Work as admin`,
    text: t`Off: you see the app like a coach, only with your teams and without administration. On: you see all teams and the administration. This applies on all your devices.`,
  }),
  calendar: () => ({
    title: t`My events in your calendar`,
    text: t`Your events show up in your phone's calendar and stay up to date by themselves. You choose what it should contain. The link is personal, do not pass it on.`,
    example: t`You subscribe to trainings and games. If a training is cancelled, it is struck through in your calendar shortly after.`,
  }),
  statsTeam: () => ({
    title: t`How it is counted`,
    text: t`Only events where someone was expected count. Away long-term or inactive never counts as missing. Cancelled events do not count at all. At short notice means declined after the decline deadline. In games an appearance is: nominated and there. Stand-ins from other teams do not count.`,
    example: t`Lukas was injured for two weeks and entered as away long-term. Of the other 6 trainings he came to 6: he is at 100 %, not at 75 %.`,
  }),
  scheduleReminder: () => ({
    title: t`Reminder to sync`,
    text: t`When a team's game schedule has not been synced for this long, its coaches see a hint with "Sync now" at the top of their events list. The hint disappears after the sync. A coach or admin always syncs by hand.`,
    example: t`With 15 days: if the schedule of a team was last synced on the 1st, the hint shows on the 16th.`,
  }),
} satisfies Record<string, () => HelpText>;

export type HelpTopic = keyof typeof HELP;
