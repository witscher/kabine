// All sport profiles, one line each. `npm run new -- sport <id>` adds the line.
// Order: the order in the setup wizard; "other" stays last.
import football from "./football";
import handball from "./handball";
import other from "./other";

export const SPORT_LIST = [
  handball,
  football,
  // new sports: above this line
  other,
] as const;
