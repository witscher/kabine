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

export const assignOnlyHelp = (): HelpText => ({
  title: t`Assigned by the coach`,
  text: t`Nobody signs up themselves. Coaches, admins and the organisers of an event assign people, and only people who fit “Who helps” (or “Helpers from” of the time slot). The person assigned is notified at once and can withdraw if they can't make it. No “helpers wanted” goes out for this duty.`,
  example: t`Hall duty of the adult teams: the coach assigns two players for every home game. Whoever can't make it withdraws, and the coach sees the free place.`,
});

export const adultsOnlyHelp = (): HelpText => ({
  title: t`Adults only`,
  text: t`Nobody under 18 by birth year takes this duty: they cannot sign up, are not assigned and get no “helpers wanted”. Without a birth year a person counts as an adult; these are mostly parents and coaches. A parent signing up through their child's team does the duty themselves and may do so.`,
  example: t`Stewards at home games of the first team, helpers from the women's and the second team: a 17-year-old who plays for the women does not see the stewards' duty.`,
});

export const notifyOpenHelp = (): HelpText => ({
  title: t`Send “helpers wanted”`,
  text: t`Three days before an event everyone who could take the duty gets a notification while places are free. Switch it off when that would be too many messages for this duty. The duty stays in the helper plan, and coaches still get the hint about open places.`,
  example: t`Wipers from four youth teams: switch it off, otherwise all parents would get a message before every game of the first team. Stewards from the adult teams: leave it on.`,
});
