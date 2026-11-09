// Explanations behind the info buttons of the helper duties module (InfoButton in src/ui.tsx).
import { t } from "@lingui/core/macro";
import type { HelpText } from "../../../src/help-texts";

export const needsSkillHelp = (): HelpText => ({
  title: t`Needs prior knowledge`,
  text: t`The duty is only offered to those who can do it: they switch it on in their profile under “I can do this”. Coaches and admins can still enter anyone.`,
  example: t`Timekeeper: whoever can do it switches it on in their profile and then sees the free places.`,
});
