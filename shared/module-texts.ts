// Switch texts of the modules (administration → club). One entry per module of shared/modules.ts;
// TypeScript fails the build while a module has no text.
import { t } from "@lingui/core/macro";
import type { ModuleId } from "./modules";

export function moduleTexts(): Record<ModuleId, { label: string; sub: string }> {
  return {
    duties: {
      label: t`Helper duties`,
      sub: t`Parents or players sign up for duties at games and special events (cake, timekeeping, washing shirts).`,
    },
    youthReferees: {
      label: t`Youth referees`,
      sub: t`Home games of the marked age groups get a youth referee duty, with a role granted by link. Needs helper duties.`,
    },
    carpools: { label: t`Carpools`, sub: t`Drivers offer seats for away games, players book them.` },
    handball4all: {
      label: t`Game schedule from handball4all`,
      sub: t`Coaches sync the games of their team from the handball4all portal (German handball associations).`,
    },
    sms: {
      label: t`SMS`,
      sub: t`Sign-in codes and helper plan reminders by text message, for people who enter a mobile number. Needs a provider account (costs per message).`,
    },
  };
}
