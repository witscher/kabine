// School and public holidays of the club's region for the current season, loaded on demand
// (Administration → Holidays, region changed in the club settings).
import { t } from "@lingui/core/macro";
import { api, ApiError, errorMessage } from "./api";
import { invalidate } from "./store";
import { toast } from "./ui";

/**
 * Loads the school and public holidays of the club's region for the current season (POST /holidays/import).
 * quiet: without a current season (early in the setup) nothing is said; the season step loads them then.
 */
export async function loadRegionHolidays(quiet = false): Promise<boolean> {
  try {
    const res = await api.post<{ periods: number; publicHolidays: number }>("/holidays/import");
    const periods = res.periods;
    const days = res.publicHolidays;
    toast(t`Holidays of the region loaded: ${periods} holiday periods, ${days} public holidays.`);
    invalidate("/holidays", "/events");
    return true;
  } catch (err) {
    if (!(quiet && err instanceof ApiError && err.code === "no_season")) toast(errorMessage(err), "error");
    return false;
  }
}
