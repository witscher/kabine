import { t } from "@lingui/core/macro";
import { defineModule } from "../../shared/module-api";

export default defineModule({
  id: "fans",
  kind: "feature",
  // New modules start as beta: switched off until a club turns them on, marked "Beta" in the settings
  status: "beta",
  defaultOn: false,
  // Every API route of the module must match one of these (test/modules-contract.test.ts)
  paths: [/^\/api\/fans\//],
  label: () => t`Fans`,
  description: () =>
    t`Everyone can follow other teams of the club and sees their games in the event list, with kick-off, venue, opponent and result, but no names or responses. A push when a game is moved or cancelled at short notice.`,
  privacy: () => ({
    stores: t`Per access: which teams it follows, whether only home games, and whether the games go into the personal calendar.`,
    visibleTo: t`Only the person themselves; nobody else sees whom someone follows. Followers see only the game data of those teams (kick-off, venue, opponent, result, cancellation), no squad, responses or names.`,
    deleted: t`When the person unfollows or switches it off, leaves the club, or the team or access is deleted. Follows stay over the season change.`,
  }),
  notificationTopics: [{ id: "fans", label: () => t`Games as a fan (moved or cancelled at short notice)`, self: true }],
});
