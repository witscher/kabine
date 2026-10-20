// List of manually created events (special events, games without handball4all):
// Administration → Special events and games, and Team → Events.
import { t } from "@lingui/core/macro";
import { shortDate, timeRange } from "./format";
import { Icon } from "./icons";
import { useQuery } from "./store";
import { Empty, ErrorBox, Spinner } from "./ui";

export interface ExtraEvent {
  id: number;
  kind: "game" | "special" | "training";
  title: string;
  startsAt: string;
  teams: { id: number; name: string }[];
  clubWide: boolean;
  cancelled: boolean;
  location: string | null;
}

export function ExtraEventList({ path, empty, showTeams = true }: { path: string; empty: string; showTeams?: boolean }) {
  const { data, error, reload } = useQuery<{ events: ExtraEvent[] }>(path);
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <Spinner />;
  if (!data.events.length) return <Empty title={t`No events`}>{empty}</Empty>;
  return (
    <ul class="list" aria-label={t`Special events and games`}>
      {data.events.map((e) => {
        const title = e.title;
        const label = e.kind === "game" ? t`Game · ${title}` : title;
        const teams = e.clubWide ? t`Whole club` : e.teams.map((team) => team.name).join(" + ");
        return (
          <li>
            <a class="list-row" href={`/termine/${e.id}`}>
              <Icon name={e.kind === "game" ? "ball" : "calendar"} size={22} />
              <span class="main">
                <span class="title">{e.cancelled ? t`Not taking place: ${label}` : label}</span>
                <span class="sub">
                  {shortDate(e.startsAt)}, {timeRange(e.startsAt, null)}
                  {showTeams ? ` · ${teams}` : ""}
                  {e.location ? ` · ${e.location}` : ""}
                </span>
              </span>
              <Icon name="chevron" size={18} />
            </a>
          </li>
        );
      })}
    </ul>
  );
}
