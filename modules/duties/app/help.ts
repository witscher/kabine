// Explanations behind the info buttons of the helper duties module (InfoButton in src/ui.tsx).
import { t } from "@lingui/core/macro";
import type { HelpText } from "../../../src/help-texts";

export const needsSkillHelp = (): HelpText => ({
  title: t`Needs prior knowledge`,
  text: t`The duty is only offered to those who can do it. Either the person switches it on in their profile under “I can do this”, or an admin approves them (Admin → Approvals or People); then everyone else does not see the duty at all. Coaches and admins can still enter anyone.`,
  example: t`Timekeeper: whoever can do it switches it on in their profile. Tournament management: only whom an admin approves sees the duty and can sign up.`,
});
