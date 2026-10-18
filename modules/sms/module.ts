import { t } from "@lingui/core/macro";
import { defineModule } from "../../shared/module-api";

export default defineModule({
  id: "sms",
  kind: "provider",
  vendor: "seven.io",
  status: "stable",
  defaultOn: false,
  paths: [/^\/api\/(admin\/sms|auth\/sms|me\/phone)/],
  label: () => t`SMS`,
  description: () =>
    t`Sign-in codes and helper plan reminders by text message, for people who enter a mobile number. Needs a provider account (costs per message).`,
  privacy: () => ({
    stores: t`The mobile number of people who enter one themselves, and whether it is confirmed.`,
    visibleTo: t`Nobody else, not even admins. Text messages go through the club's SMS provider.`,
    deleted: t`When removed in the profile or when the person leaves the club.`,
  }),
});
