// All modules of Kabine, one line each. `npm run new -- module <id>` adds the line.
// Order: the order of the switches in administration. A module nested inside another module's API
// paths must come before it (the first matching module wins).
import carpools from "./carpools/module";
import duties from "./duties/module";
import handball4all from "./handball4all/module";
import sms from "./sms/module";
import youthReferees from "./youth-referees/module";

export const MODULES = [youthReferees, duties, carpools, handball4all, sms] as const;
