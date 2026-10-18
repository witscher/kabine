// App part of the SMS module: the provider settings page under Administration.
// The phone number in the profile and the "code by SMS" sign-in stay in the core screens
// (src/pages/profile.tsx, src/pages/login.tsx) and show while the module is on.
import { t } from "@lingui/core/macro";
import { defineAppModule } from "../../../src/module-api";
import { lazyPage } from "../../../src/update";
import manifest from "../module";

export default defineAppModule({
  manifest,
  routes: [{ path: "/verwaltung/sms", page: lazyPage(() => import("./settings").then((m) => m.AdminSmsPage)) }],
  adminMenu: () => [{ href: "/verwaltung/sms", icon: "phone", title: t`SMS`, sub: t`Provider for codes and reminders by SMS` }],
});
