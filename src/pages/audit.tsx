// Administration → Protocol: who did what to whom and when, for actions with a large effect (worker/domain/audit.ts).
// Grouped by day, newest first. Modules add texts for their own actions (hook auditTexts in src/module-api.ts).
import { plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useState } from "preact/hooks";
import type { AuditEntry } from "../../shared/types";
import { api, errorMessage } from "../api";
import { useClub } from "../club";
import { shortDate } from "../format";
import { currentLocale } from "../i18n";
import { APP_MODULES } from "../modules";
import { useQuery } from "../store";
import { Button, ErrorBox, Spinner, toast, TopBar, useDocumentTitle } from "../ui";
import { AdminOnly } from "./admin";

interface AuditPage {
  entries: AuditEntry[];
  hasMore: boolean;
}

const str = (v: unknown): string => (v == null ? "" : String(v));
const num = (v: unknown): number => (typeof v === "number" ? v : 0);

function roleName(role: unknown): string {
  switch (role) {
    case "coach":
      return t`coach`;
    case "helper":
      return t`stand-in`;
    case "staff":
      return t`staff`;
    default:
      return t`player`;
  }
}

/** "Summer party on Sat 20.06." for an event entry. */
function eventLabel(e: AuditEntry): string {
  const d = e.detail ?? {};
  const kind = str(d.kind);
  const title = str(d.title) || (kind === "training" ? t`Training` : kind === "game" ? t`Game` : t`Event`);
  const date = d.startsAt ? shortDate(str(d.startsAt)) : "";
  return date ? t`${title} on ${date}` : title;
}

/** One sentence per entry, in the reader's language. */
export function auditText(e: AuditEntry): string {
  const who = e.actor.name ?? t`The app`;
  const person = e.person?.name ?? t`a deleted person`;
  const team = e.team?.name ?? t`a deleted team`;
  const d = e.detail ?? {};
  switch (e.action) {
    case "account_removed":
      return t`${who} removed the access of ${person}`;
    case "personal_link":
      return d.replacesAccess
        ? t`${who} created a personal link for ${person}; using it signs out the previous devices`
        : t`${who} created a personal link for ${person}`;
    case "left_club":
      return d.parent ? t`${who} recorded that ${person} left the club, as parent without a remaining child` : t`${who} recorded that ${person} left the club`;
    case "person_deleted": {
      const child = str(d.parentOf);
      return child ? t`${who} deleted ${person}, as parent of ${child}` : t`${who} deleted ${person}`;
    }
    case "admin_granted":
      return t`${who} made ${person} an admin`;
    case "admin_removed":
      return t`${who} took the admin rights from ${person}`;
    case "member_added": {
      if (d.imported) {
        const count = num(d.imported);
        return plural(count, { one: `${who} added # player to ${team} from a list`, other: `${who} added # players to ${team} from a list` });
      }
      const role = roleName(d.role);
      return t`${who} added ${person} to ${team} as ${role}`;
    }
    case "member_removed": {
      const role = roleName(d.role);
      return t`${who} removed ${person} from ${team} (${role})`;
    }
    case "set_inactive":
      return t`${who} set ${person} inactive`;
    case "set_active":
      return t`${who} set ${person} active again`;
    case "guardian_set": {
      const child = str(d.child);
      return t`${who} linked ${person} as parent of ${child}`;
    }
    case "guardian_removed": {
      const child = str(d.child);
      return t`${who} removed the link of ${person} as parent of ${child}`;
    }
    case "schedule_linked": {
      const source = str(d.source);
      return t`${who} linked the game schedule of ${team} (${source})`;
    }
    case "schedule_removed": {
      const source = str(d.source);
      return t`${who} removed the game schedule of ${team} (${source})`;
    }
    case "schedule_sync": {
      const created = num(d.new);
      const moved = num(d.moved);
      const cancelled = num(d.cancelled);
      return t`${who} synced the game schedule of ${team}: ${created} new, ${moved} moved, ${cancelled} cancelled`;
    }
    case "event_cancelled": {
      const label = eventLabel(e);
      return e.team ? t`${who} cancelled ${label} (${team})` : t`${who} cancelled ${label}`;
    }
    case "event_uncancelled": {
      const label = eventLabel(e);
      return e.team ? t`${who} took back the cancellation of ${label} (${team})` : t`${who} took back the cancellation of ${label}`;
    }
    case "event_deleted": {
      const label = eventLabel(e);
      return e.team ? t`${who} deleted ${label} (${team})` : t`${who} deleted ${label}`;
    }
    case "team_deleted":
      return d.group ? t`${who} deleted the group ${team}` : t`${who} deleted the team ${team}`;
    case "season_change": {
      const season = str(d.season);
      return t`${who} carried out the season change to ${season}`;
    }
    case "export":
      return t`${who} downloaded the export of all data`;
  }
  for (const m of APP_MODULES) {
    const text = m.auditTexts?.()[e.action];
    if (text) return text(e, { who, person, team });
  }
  return `${who}: ${e.action}`;
}

export function AdminAuditPage() {
  useDocumentTitle(t`Protocol`);
  const club = useClub();
  const first = useQuery<AuditPage>("/admin/audit-log");
  const [more, setMore] = useState<AuditEntry[]>([]);
  const [hasMore, setHasMore] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const entries = [...(first.data?.entries ?? []), ...more];
  const canLoad = hasMore ?? first.data?.hasMore ?? false;

  const dayOf = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: club.timeZone });
  const dayTitle = (iso: string) => new Date(iso).toLocaleDateString(currentLocale(), { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: club.timeZone });
  const timeOf = (iso: string) => new Date(iso).toLocaleTimeString(currentLocale(), { hour: "2-digit", minute: "2-digit", timeZone: club.timeZone });
  const days: { key: string; title: string; entries: AuditEntry[] }[] = [];
  for (const e of entries) {
    const key = dayOf(e.at);
    const last = days.at(-1);
    if (last?.key === key) last.entries.push(e);
    else days.push({ key, title: dayTitle(e.at), entries: [e] });
  }

  const loadMore = async () => {
    const last = entries.at(-1);
    if (!last) return;
    setLoading(true);
    try {
      const page = await api.get<AuditPage>(`/admin/audit-log?before=${last.id}`);
      setMore((list) => [...list, ...page.entries]);
      setHasMore(page.hasMore);
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AdminOnly>
      <main class="page">
        <TopBar title={t`Protocol`} kicker={t`Administration`} back="/verwaltung" />
        <div class="content stack">
          <p class="small muted">
            <Trans>
              Who did what to whom, for actions with a large effect: access, leaving, admin rights, members, game schedules, cancelled events, the season change
              and the export. Responses, squads, chats and helper duties are not listed. Only admins see this; the season change empties it.
            </Trans>
          </p>
          {first.error ? <ErrorBox error={first.error} onRetry={first.reload} /> : null}
          {!first.data && !first.error ? <Spinner /> : null}
          {first.data && !entries.length ? (
            <p class="small muted">
              <Trans>Nothing recorded yet.</Trans>
            </p>
          ) : null}
          {days.map((day) => (
            <section class="stack-sm" aria-label={day.title}>
              <h2 class="section-title" style={{ margin: 0 }}>
                {day.title}
              </h2>
              <ul class="list">
                {day.entries.map((e) => (
                  <li class="list-row">
                    <span class="main">
                      <span class="title">{auditText(e)}</span>
                      <span class="sub">{timeOf(e.at)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {canLoad ? (
            <Button block disabled={loading} onClick={loadMore}>
              <Trans>Show older entries</Trans>
            </Button>
          ) : null}
        </div>
      </main>
    </AdminOnly>
  );
}
