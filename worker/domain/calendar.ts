// Personal calendar (iCalendar, RFC 5545): training, games and helper duties depending on
// the checkboxes. Times are local time of the club's zone and are written with TZID.
import { t } from "@lingui/core/macro";
import type { EventSummary, MyParticipation } from "../../shared/types";
import { timeZone } from "../lib/time";

export interface CalendarItem {
  uid: string;
  start: string; // local time 'YYYY-MM-DDTHH:MM'
  durationMinutes: number;
  summary: string;
  location: string | null;
  description: string | null;
  cancelled: boolean;
}

/** Rules of Central European Time; the zones listed below follow them. */
const CET_ZONES = new Set([
  "Europe/Berlin", "Europe/Vienna", "Europe/Zurich", "Europe/Amsterdam", "Europe/Brussels", "Europe/Luxembourg", "Europe/Paris",
  "Europe/Rome", "Europe/Madrid", "Europe/Copenhagen", "Europe/Oslo", "Europe/Stockholm", "Europe/Prague", "Europe/Warsaw",
  "Europe/Budapest", "Europe/Bratislava", "Europe/Ljubljana", "Europe/Zagreb", "Europe/Belgrade", "Europe/Vaduz", "Europe/Monaco",
]);

/**
 * VTIMEZONE block for the club's zone. Calendar apps know IANA names, so other zones go without
 * the block (TZID alone).
 */
function vtimezone(zone: string): string[] {
  if (!CET_ZONES.has(zone)) return [];
  return [
  "BEGIN:VTIMEZONE",
  `TZID:${zone}`,
  "BEGIN:DAYLIGHT",
  "TZOFFSETFROM:+0100",
  "TZOFFSETTO:+0200",
  "TZNAME:CEST",
  "DTSTART:19700329T020000",
  "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU",
  "END:DAYLIGHT",
  "BEGIN:STANDARD",
  "TZOFFSETFROM:+0200",
  "TZOFFSETTO:+0100",
  "TZNAME:CET",
  "DTSTART:19701025T030000",
  "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU",
  "END:STANDARD",
  "END:VTIMEZONE",
  ];
}

function escapeText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

/** Wraps lines longer than 75 octets (folding). */
function fold(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let current = "";
  let size = 0;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
    if (size + n > (parts.length ? 74 : 75)) {
      parts.push(current);
      current = "";
      size = 0;
    }
    current += ch;
    size += n;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

function localStamp(local: string): string {
  return `${local.slice(0, 4)}${local.slice(5, 7)}${local.slice(8, 10)}T${local.slice(11, 13)}${local.slice(14, 16)}00`;
}

export function buildCalendar(name: string, items: CalendarItem[], nowUtcIso: string, zone = timeZone()): string {
  const stamp = nowUtcIso.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Kabine//Kabine//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(name)}`,
    `X-WR-TIMEZONE:${zone}`,
    "REFRESH-INTERVAL;VALUE=DURATION:PT6H",
    ...vtimezone(zone),
  ];
  for (const it of items) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${it.uid}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;TZID=${zone}:${localStamp(it.start)}`,
      `DURATION:PT${it.durationMinutes}M`,
      `SUMMARY:${escapeText(it.summary)}`,
    );
    if (it.location) lines.push(`LOCATION:${escapeText(it.location)}`);
    if (it.description) lines.push(`DESCRIPTION:${escapeText(it.description)}`);
    if (it.cancelled) lines.push("STATUS:CANCELLED");
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

export interface CalendarPrefs {
  training: boolean;
  games: boolean;
  duties: boolean;
}

export interface CalendarDuty {
  id: number;
  label: string;
  /** Task (done around the event): short entry at that time */
  task: boolean;
  childName: string | null;
  note: string | null;
  startsAt: string;
  endsAt: string | null;
  cancelled: boolean;
  location: string | null;
  teamName: string | null;
  isHome: boolean | null;
  homeTeam: string | null;
  guestTeam: string | null;
  title: string | null;
}


function minutesBetween(from: string, to: string): number {
  return (Date.parse(`${to}:00Z`) - Date.parse(`${from}:00Z`)) / 60_000;
}

function teamLabel(e: EventSummary): string {
  return e.teams.map((t) => t.name).join(" + ");
}

/** "vs opponent" or "at opponent"; without home/away information the title of the event. */
function opponentText(isHome: boolean | null, homeTeam: string | null, guestTeam: string | null, title: string | null): string {
  if (isHome === true && guestTeam) return t`vs ${guestTeam}`;
  if (isHome === false && homeTeam) return t`at ${homeTeam}`;
  return title ?? t`Game`;
}

/** State of a person in the title: "nominated" for games, otherwise only deviations. */
function annotation(e: EventSummary, m: MyParticipation): string {
  if (m.status === "no") return t({ message: "declined", context: "calendar" });
  if (m.status === "standing") return t({ message: "absent", context: "calendar" });
  if (m.status === "inactive") return t({ message: "inactive", context: "calendar" });
  if (e.kind === "game" && m.nominated) return t({ message: "nominated", context: "calendar" });
  return "";
}

/**
 * Who is concerned, grouped by state: "Ella and Mia nominated", "Ella attending, Mia declined".
 * The own person without a name (or "you" if children are named too), children by first name.
 */
function personsSuffix(e: EventSummary, selfId: number): string {
  const concerned = e.mine.filter((m) => m.participant || e.kind === "game");
  const alone = concerned.length === 1;
  const groups = new Map<string, string[]>();
  for (const m of concerned) {
    const name = m.person.id === selfId ? (alone ? "" : t({ message: "you", context: "calendar" })) : m.person.firstName;
    const state = annotation(e, m);
    groups.set(state, [...(groups.get(state) ?? []), name]);
  }
  const mixed = groups.size > 1;
  return [...groups]
    .map(([state, names]) => {
      // Without a deviation only a word if there are several groups
      const word =
        state || (mixed ? (e.kind === "game" ? t({ message: "not nominated", context: "calendar" }) : t({ message: "attending", context: "calendar" })) : "");
      const who = names.filter(Boolean);
      const rest = who.slice(0, -1).join(", ");
      const last = who[who.length - 1] ?? "";
      const list = who.length > 1 ? t`${rest} and ${last}` : (who[0] ?? "");
      return [list, word].filter(Boolean).join(" ");
    })
    .filter(Boolean)
    .join(", ");
}

/** Opponent of a game: "vs X", "at X" or "· Tournament Y" (without home/away). */
function gameVs(e: EventSummary): string {
  const g = e.game;
  if (!g || g.isHome == null) return `· ${e.title}`;
  return opponentText(g.isHome, g.homeTeam, g.guestTeam, e.title);
}

function eventTitle(e: EventSummary): string {
  const teams = teamLabel(e);
  if (e.kind === "training") return teams ? t`Training ${teams}` : t`Training`;
  const vs = gameVs(e);
  if (e.kind === "game") return teams ? t`Game ${teams} ${vs}` : t`Game ${vs}`;
  return teams ? `${e.title} · ${teams}` : e.title;
}

function cancelledEntry(entry: string): string {
  return t`Not taking place: ${entry}`;
}

function noteText(note: string | null): string | null {
  return note ? t`Note: ${note}` : null;
}

/** Summary of the meeting point entry: "Meeting point wD · Game vs X" (without home/away the title). */
function meetingSummary(e: EventSummary): string {
  const teams = teamLabel(e);
  const vs = gameVs(e);
  const what = e.game?.isHome == null ? e.title : t`Game ${vs}`;
  return t`Meeting point ${teams} · ${what}`;
}

function locationText(e: EventSummary): string | null {
  return [e.location?.name, e.location?.address].filter(Boolean).join(", ") || null;
}

/**
 * Calendar entries from the events (as in the event overview) and the own duties.
 * coachTeamIds: coaches get the meeting point even without a nomination.
 */
export function calendarItems(
  events: EventSummary[],
  duties: CalendarDuty[],
  prefs: CalendarPrefs,
  opts: { selfId: number; coachTeamIds: number[]; origin: string; uidHost?: string },
): CalendarItem[] {
  // Stable per installation, so two clubs in one calendar never share UIDs
  const uidHost = opts.uidHost ?? "kabine";
  const items: CalendarItem[] = [];
  for (const e of events) {
    if (e.kind === "game" ? !prefs.games : !prefs.training) continue;
    const base = eventTitle(e);
    const suffix = personsSuffix(e, opts.selfId);
    const title = suffix ? `${base} · ${suffix}` : base;
    const g = e.game;
    const meetAt = g?.meetingTime ?? null;
    const point = g?.meetingPoint ?? null;
    const meeting = meetAt ? (point ? t`Meet at ${meetAt} · ${point}` : t`Meet at ${meetAt}`) : point ? t`Meeting point: ${point}` : null;
    const throwOff = e.startsAt.slice(11, 16);
    const description = [
      e.kind === "game" ? t`Start of play ${throwOff}` : null,
      meeting,
      `${opts.origin}/termine/${e.id}`,
    ]
      .filter(Boolean)
      .join("\n");
    const fallback = e.kind === "training" ? 90 : 120;
    const duration = e.endsAt && e.endsAt > e.startsAt ? minutesBetween(e.startsAt, e.endsAt) : fallback;
    items.push({
      uid: `event-${e.id}@${uidHost}`,
      start: e.startsAt,
      durationMinutes: duration,
      summary: e.cancelled ? cancelledEntry(base) : title,
      location: locationText(e),
      description,
      cancelled: !!e.cancelled,
    });

    // Meeting point: separate entry for nominees (or their parents) and coaches
    if (e.kind !== "game" || !g?.meetingTime || e.cancelled) continue;
    const meetStart = `${e.startsAt.slice(0, 10)}T${g.meetingTime}`;
    if (meetStart >= e.startsAt) continue;
    const nominated = e.mine.some((m) => m.nominated && m.status !== "no");
    const coach = e.teams.some((t) => opts.coachTeamIds.includes(t.id));
    if (!nominated && !coach) continue;
    items.push({
      uid: `meet-${e.id}@${uidHost}`,
      start: meetStart,
      durationMinutes: Math.max(15, minutesBetween(meetStart, e.startsAt)),
      summary: meetingSummary(e),
      location: g.meetingPoint ?? locationText(e),
      description: [t`Start of play ${throwOff}`, `${opts.origin}/termine/${e.id}`].join("\n"),
      cancelled: false,
    });
  }
  if (prefs.duties) {
    for (const d of duties) {
      const game = `${d.teamName ? `${d.teamName} ` : ""}${opponentText(d.isHome, d.homeTeam, d.guestTeam, d.title)}`;
      const label = d.label;
      const child = d.childName;
      const summary = d.task
        ? child
          ? t`Task ${label} · ${game} · for ${child}`
          : t`Task ${label} · ${game}`
        : child
          ? t`Helper duty ${label} · ${game} · for ${child}`
          : t`Helper duty ${label} · ${game}`;
      items.push({
        uid: `duty-${d.id}@${uidHost}`,
        start: d.startsAt,
        // Time block of the duty; tasks as a short entry at the start or end of the event
        durationMinutes: d.task ? 15 : d.endsAt && d.endsAt > d.startsAt ? minutesBetween(d.startsAt, d.endsAt) : 120,
        summary: d.cancelled ? cancelledEntry(summary) : summary,
        location: d.location,
        description: noteText(d.note),
        cancelled: d.cancelled,
      });
    }
  }
  return items.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
}
