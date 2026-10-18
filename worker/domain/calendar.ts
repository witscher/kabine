// Persönlicher Kalender (iCalendar, RFC 5545): Training, Spiele und Helferdienste je nach
// Häkchen. Zeiten sind lokale Zeit Europe/Berlin und werden mit TZID ausgegeben.
import type { EventSummary, MyParticipation } from "../../shared/types";

export interface CalendarItem {
  uid: string;
  start: string; // lokale Zeit 'YYYY-MM-DDTHH:MM'
  durationMinutes: number;
  summary: string;
  location: string | null;
  description: string | null;
  cancelled: boolean;
}

const VTIMEZONE = [
  "BEGIN:VTIMEZONE",
  "TZID:Europe/Berlin",
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

function escapeText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

/** Zeilen über 75 Oktette umbrechen (Folding). */
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

export function buildCalendar(name: string, items: CalendarItem[], nowUtcIso: string): string {
  const stamp = nowUtcIso.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Kabine//Kabine//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(name)}`,
    "X-WR-TIMEZONE:Europe/Berlin",
    "REFRESH-INTERVAL;VALUE=DURATION:PT6H",
    ...VTIMEZONE,
  ];
  for (const it of items) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${it.uid}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;TZID=Europe/Berlin:${localStamp(it.start)}`,
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
  /** Aufgabe (wird drumherum erledigt): kurzer Eintrag zum Zeitpunkt */
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

/** „gegen Gegner“ bzw. „bei Gegner“, ohne Heim/Auswärts-Angabe der Titel des Termins. */
function opponentText(isHome: boolean | null, homeTeam: string | null, guestTeam: string | null, title: string | null): string {
  if (isHome === true && guestTeam) return `gegen ${guestTeam}`;
  if (isHome === false && homeTeam) return `bei ${homeTeam}`;
  return title ?? "Spiel";
}

/** Zustand einer Person im Titel: bei Spielen „nominiert“, sonst nur Abweichungen. */
function annotation(e: EventSummary, m: MyParticipation): string {
  if (m.status === "no") return "abgesagt";
  if (m.status === "standing") return "abwesend";
  if (m.status === "inactive") return "inaktiv";
  if (e.kind === "game" && m.nominated) return "nominiert";
  return "";
}

/**
 * Wer betroffen ist, nach Zustand gruppiert: „Ella und Mia nominiert“, „Ella dabei, Mia abgesagt“.
 * Die eigene Person ohne Namen (bzw. „du“, wenn auch Kinder genannt werden), Kinder mit Vornamen.
 */
function personsSuffix(e: EventSummary, selfId: number): string {
  const concerned = e.mine.filter((m) => m.participant || e.kind === "game");
  const alone = concerned.length === 1;
  const groups = new Map<string, string[]>();
  for (const m of concerned) {
    const name = m.person.id === selfId ? (alone ? "" : "du") : m.person.firstName;
    const state = annotation(e, m);
    groups.set(state, [...(groups.get(state) ?? []), name]);
  }
  const mixed = groups.size > 1;
  return [...groups]
    .map(([state, names]) => {
      // Ohne Abweichung nur dann ein Wort, wenn es mehrere Gruppen gibt
      const word = state || (mixed ? (e.kind === "game" ? "nicht nominiert" : "dabei") : "");
      const who = names.filter(Boolean);
      const list = who.length > 1 ? `${who.slice(0, -1).join(", ")} und ${who[who.length - 1]}` : (who[0] ?? "");
      return [list, word].filter(Boolean).join(" ");
    })
    .filter(Boolean)
    .join(", ");
}

/** Gegner eines Spiels: „gegen X“, „bei X“ oder „· Turnier Y“ (ohne Heim/Auswärts). */
function gameVs(e: EventSummary): string {
  const g = e.game;
  if (!g || g.isHome == null) return `· ${e.title}`;
  return opponentText(g.isHome, g.homeTeam, g.guestTeam, e.title);
}

function eventTitle(e: EventSummary): string {
  const teams = teamLabel(e);
  if (e.kind === "training") return teams ? `Training ${teams}` : "Training";
  if (e.kind === "game") return teams ? `Spiel ${teams} ${gameVs(e)}` : `Spiel ${gameVs(e)}`;
  return teams ? `${e.title} · ${teams}` : e.title;
}

function locationText(e: EventSummary): string | null {
  return [e.location?.name, e.location?.address].filter(Boolean).join(", ") || null;
}

/**
 * Kalendereinträge aus den Terminen (wie in der Terminübersicht) und den eigenen Diensten.
 * coachTeamIds: Trainer bekommen den Treffpunkt auch ohne Nominierung.
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
    const meeting = g?.meetingTime ? `Treffen ${g.meetingTime} Uhr${g.meetingPoint ? ` · ${g.meetingPoint}` : ""}` : g?.meetingPoint ? `Treffpunkt: ${g.meetingPoint}` : null;
    const description = [
      e.kind === "game" ? `Anpfiff ${e.startsAt.slice(11, 16)} Uhr` : null,
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
      summary: e.cancelled ? `Abgesagt: ${base}` : title,
      location: locationText(e),
      description,
      cancelled: !!e.cancelled,
    });

    // Treffpunkt: eigener Termin für Nominierte (bzw. deren Eltern) und Trainer
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
      summary: `Treffpunkt ${teamLabel(e)} · ${g.isHome == null ? e.title : `Spiel ${gameVs(e)}`}`,
      location: g.meetingPoint ?? locationText(e),
      description: [`Anpfiff ${e.startsAt.slice(11, 16)} Uhr`, `${opts.origin}/termine/${e.id}`].join("\n"),
      cancelled: false,
    });
  }
  if (prefs.duties) {
    for (const d of duties) {
      const game = `${d.teamName ? `${d.teamName} ` : ""}${opponentText(d.isHome, d.homeTeam, d.guestTeam, d.title)}`;
      const summary = `${d.task ? "Aufgabe" : "Helferdienst"} ${d.label} · ${game}${d.childName ? ` · für ${d.childName}` : ""}`;
      items.push({
        uid: `duty-${d.id}@${uidHost}`,
        start: d.startsAt,
        // Zeitblock des Dienstes; Aufgaben als kurzer Eintrag zum Beginn bzw. Ende des Termins
        durationMinutes: d.task ? 15 : d.endsAt && d.endsAt > d.startsAt ? minutesBetween(d.startsAt, d.endsAt) : 120,
        summary: d.cancelled ? `Abgesagt: ${summary}` : summary,
        location: d.location,
        description: d.note ? `Notiz: ${d.note}` : null,
        cancelled: d.cancelled,
      });
    }
  }
  return items.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
}
