// All modules of Kabine. `npm run new -- module <name>` (or `connector`) adds the import and the entry.
// Order: the order of the switches in administration. A module nested inside another module's API
// paths must come before it (the first matching module wins).
import carpools from "./carpools/module";
import duties from "./duties/module";
import handball4all from "./handball4all/module";
import sms from "./sms/module";
import handballnet from "./handballnet/module";
import polls from "./polls/module";
import fans from "./fans/module";
import gameday from "./gameday/module";

export const MODULES = [
  duties,
  carpools,
  handball4all,
  sms,
  handballnet,
  polls,
  fans,
  gameday,
  // new modules: above this line
] as const;
