import { t } from "@lingui/core/macro";
import { defineModule } from "../../shared/module-api";

export default defineModule({
  id: "polls",
  kind: "feature",
  // New modules start as beta: switched off until a club turns them on, marked "Beta" in the settings
  status: "stable",
  defaultOn: false,
  // Every API route of the module must match one of these (test/modules-contract.test.ts)
  paths: [/^\/api\/polls(\/|$)/],
  label: () => t`Polls`,
  description: () => t`Coaches ask their team, admins the whole club: choose an answer, find a date, or collect orders with payment.`,
  privacy: () => ({
    stores: t`Who may vote in a poll and what each person or family answered or ordered; for orders an order number, the amount and whether it was reported or confirmed as paid; product photos of the items. The club's PayPal.me name, account holder and IBAN for payments.`,
    visibleTo: t`Answers: the creator, the team's coaches and admins, unless the poll is anonymous; in scheduling polls also the participants (first name and initial). Orders: each family sees only its own, the creator, coaches and admins see all, with last names and the players' teams, and can download them as an Excel file built on their device; the club is responsible for that copy. Payment details: everyone who ordered.`,
    deleted: t`With the poll, at the latest at the season change. Someone who leaves the club is removed from running polls.`,
  }),
  notificationTopics: [{ id: "polls", label: () => t`Polls (new poll, reminder before the end)` }],
});
