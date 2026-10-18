// Worker part of the SMS module: provider settings, phone numbers, sign-in codes by SMS, and the text
// channel the core uses for codes and helper plan reminders (worker/domain/texts.ts).
import { defineWorkerModule } from "../../../worker/module-api";
import manifest from "../module";
import { smsRoutes } from "./routes";
import { sendSmsTo, smsAvailable } from "./settings";

export default defineWorkerModule({
  manifest,
  routes: smsRoutes,
  texts: { available: smsAvailable, send: sendSmsTo },
});
