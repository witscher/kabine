// All modules of Kabine. `npm run new -- module <name>` (or `connector`) adds the import and the entry.
// Order: the order of the switches in administration. A module nested inside another module's API
// paths must come before it (the first matching module wins).
import carpools from "./carpools/module";
import duties from "./duties/module";
import handball4all from "./handball4all/module";
import sms from "./sms/module";
import youthReferees from "./youth-referees/module";
import aiImport from "./ai-import/module";

export const MODULES = [
  youthReferees,
  duties,
  carpools,
  handball4all,
  sms,
  aiImport,
  // new modules: above this line
] as const;
