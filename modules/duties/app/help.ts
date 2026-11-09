// Explanations behind the info buttons of the helper duties module (InfoButton in src/ui.tsx).
import { t } from "@lingui/core/macro";
import type { HelpText } from "../../../src/help-texts";

export const needsSkillHelp = (): HelpText => ({
  title: t`Needs prior knowledge`,
  text: t`The duty is only offered to those who can do it. Either the person switches it on in their profile under “I can do this”, or an admin approves them (Admin → Approvals or People); then everyone else does not see the duty at all. Coaches and admins can still enter anyone.`,
  example: t`Timekeeper: whoever can do it switches it on in their profile. Tournament management: only whom an admin approves sees the duty and can sign up.`,
});

export const statsHelpersHelp = (): HelpText => ({
  title: t`Helpers per family`,
  text: t`A family is a child of the team with its parents; siblings in the same team count as one family. Duties done and those someone has already signed up for count. With “Remind these families”, everyone without a duty gets a notification, once a day and only while places are free.`,
  example: t`Anja baked a cake once, Marc is signed up for Saturday: the Jonas family has 2 duties, 1 of them planned.`,
});
