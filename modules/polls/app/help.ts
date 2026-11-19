// Explanations behind the info buttons of the polls form (InfoButton in src/ui.tsx).
import { t } from "@lingui/core/macro";
import type { HelpText } from "../../../src/help-texts";

export const familyHelp = (): HelpText => ({
  title: t`One vote per family`,
  text: t`Parents, children and siblings linked in the app vote together, once. Anyone of the family can cast or change the vote. Good for finding a date and for orders. When off, everyone votes for themselves, and parents also for their children when players are asked.`,
  example: t`Summer party: the Kaiser family with Kim and Ben answers once, not three times.`,
});

export const anonymousHelp = (): HelpText => ({
  title: t`Anonymous`,
  text: t`Nobody sees who voted what, not even you as the creator. You only see how many voted. The app still remembers the vote, so it can be changed and only those who are missing get reminded. Orders cannot be anonymous.`,
});

export const resultsHelp = (): HelpText => ({
  title: t`Result`,
  text: t`“Visible right away”: whoever may vote sees the interim result at once. “Only after the end”: only when the poll is over. You as the creator, the coaches and admins always see it. Participants see names only when finding a date, if the poll is not anonymous.`,
});
