// Which API paths belong to a module the club can switch off (shared/club.ts, ClubModules).
import type { ModuleId } from "../../shared/club";

const PATHS: [RegExp, ModuleId | null][] = [
  // Games entered by hand belong to the base, although their routes live with the helper plan
  [/^\/api\/duties\/(teams\/\d+\/games|games\/\d+)$/, null],
  // Youth referees first: their paths lie inside the helper plan's
  [/^\/api\/(duties\/referee|referee\/|admin\/referee)/, "youthReferees"],
  [/^\/api\/(duties|duty-|admin\/duty-|profile\/duty-prefs)/, "duties"],
  [/^\/api\/events\/\d+\/carpool/, "carpools"],
  [/^\/api\/teams\/\d+\/games\//, "handball4all"],
  [/^\/api\/(admin\/sms|auth\/sms|me\/phone)/, "sms"],
];

export function moduleOfPath(path: string): ModuleId | null {
  return PATHS.find(([re]) => re.test(path))?.[1] ?? null;
}
