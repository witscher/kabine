// Liste von Hand angelegter Termine (Sondertermine, Spiele ohne handball4all):
// Verwaltung → Sondertermine und Spiele und Team → Termine.
import { shortDate, time } from "./format";
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
  if (!data.events.length) return <Empty title="Keine Termine">{empty}</Empty>;
  return (
    <ul class="list" aria-label="Sondertermine und Spiele">
      {data.events.map((e) => (
        <li>
          <a class="list-row" href={`/termine/${e.id}`}>
            <Icon name={e.kind === "game" ? "ball" : "calendar"} size={22} />
            <span class="main">
              <span class="title">
                {e.cancelled ? "Abgesagt: " : ""}
                {e.kind === "game" ? `Spiel · ${e.title}` : e.title}
              </span>
              <span class="sub">
                {shortDate(e.startsAt)}, {time(e.startsAt)} Uhr
                {showTeams ? ` · ${e.clubWide ? "Ganzer Verein" : e.teams.map((t) => t.name).join(" + ")}` : ""}
                {e.location ? ` · ${e.location}` : ""}
              </span>
            </span>
            <Icon name="chevron" size={18} />
          </a>
        </li>
      ))}
    </ul>
  );
}
