// Profile → My events (hook calendarOptions): the games of followed teams in the personal calendar.
import { t } from "@lingui/core/macro";
import { api } from "../../../src/api";
import { useQuery } from "../../../src/store";
import { SwitchRow } from "../../../src/ui";
import type { FollowView } from "../types";

/** Off by default, also for calendar links made before; only shown while one follows a team. */
export function CalendarOption() {
  const { data, mutate } = useQuery<FollowView>("/fans/follows");
  if (!data || !data.teams.some((tm) => tm.following)) return null;
  return (
    <li>
      <SwitchRow
        label={t`Games as a fan`}
        sub={data.homeOnly ? t`Home games of the teams you follow, game data only` : t`Games of the teams you follow, game data only`}
        checked={data.calendar}
        onChange={async (calendar) => mutate(await api.put<FollowView>("/fans/settings", { calendar }))}
      />
    </li>
  );
}
