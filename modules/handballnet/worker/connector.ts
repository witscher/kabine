// Game schedule from handball.net (Handball360, German handball associations).
//
// Access: the public calendar subscription that handball.net offers for every team
// (webcal://www.handball.net/kalender/team/<id>.ics, "Kalender abonnieren" on the team page). It allows
// browsers (CORS) and is meant to be fetched by calendar apps, so the coach's device fetches it like a
// calendar app would, only at the press of a button and at most every 10 minutes per team. The server
// checks the calendar and syncs the games; it never calls handball.net itself.
import { t } from "@lingui/core/macro";
import { type FixtureConnector, FixtureFormatError, type FixtureGame, type FixtureSource } from "../../../worker/module-api";

const vendor = "handball.net";
const MAX_TEXT = 500_000;

export const calendarUrl = (teamId: string) => `https://www.handball.net/kalender/team/${teamId}.ics`;
export const teamUrl = (teamId: string) => `https://www.handball.net/team/${teamId}`;

/**
 * The team id from a link of handball.net: the team page (…/team/70533?season_id=2627&phaseId=15125, also
 * …/mannschaften/70533/…) or its calendar (webcal://…/kalender/team/70533.ics?t=…).
 */
export function parseTeamLink(input: string): { teamId: string } | null {
  let url: URL;
  try {
    url = new URL(input.trim().replace(/^webcals?:\/\//i, "https://"));
  } catch {
    return null;
  }
  if (!/^(www\.)?handball\.net$/.test(url.hostname)) return null;
  const id = /^\/(?:team|teams|mannschaften|kalender\/team)\/(\d{1,10})(?:\.ics)?(?:\/|$)/.exec(url.pathname)?.[1];
  return id ? { teamId: id } : null;
}

/** Content lines of an iCal text: folded lines joined (RFC 5545, 3.1). */
function contentLines(text: string): string[] {
  return text.replace(/\r\n|\r/g, "\n").replace(/\n[ \t]/g, "").split("\n");
}

/** Text value with the iCal escapes resolved. */
const unescape = (v: string) => v.replace(/\\([\\;,nN])/g, (_, c: string) => (c === "n" || c === "N" ? "\n" : c));

/**
 * Hall and address from LOCATION, e.g. "ANDERNACH, GESCHW.-SCHOLL-REALSCH., LUDWIG-HILLESHEIM-STRAßE, 56626 ANDERNACH,
 * 56626 ANDERNACH": the name (it may contain commas), then street and "postcode town" (repeated).
 */
function venueOf(value: string): { name: string; address: string | null } | null {
  const parts = unescape(value).split(",").map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return null;
  const postal = parts.findIndex((p) => /^\d{4,5}\s/.test(p));
  if (postal < 2) return { name: parts.join(", "), address: null };
  return { name: parts.slice(0, postal - 1).join(", "), address: `${parts[postal - 1]}, ${parts[postal]}` };
}

interface Property {
  name: string;
  params: Record<string, string>;
  value: string;
}

function property(line: string): Property | null {
  const colon = line.indexOf(":");
  if (colon < 1) return null;
  const [name, ...params] = line.slice(0, colon).split(";");
  return {
    name: name!.toUpperCase(),
    params: Object.fromEntries(params.map((p) => [p.split("=")[0]!.toUpperCase(), p.slice(p.indexOf("=") + 1)])),
    value: line.slice(colon + 1),
  };
}

/** "20260913T120000" local time (floating or with TZID) as date and time; times in UTC ("…Z") are not used. */
function localStart(p: Property | undefined): { date: string; time: string | null } | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})\d{2}(Z?))?$/.exec(p?.value.trim() ?? "");
  if (!m || m[6] === "Z") return null;
  const date = `${m[1]}-${m[2]}-${m[3]}`;
  if (Number.isNaN(Date.parse(`${date}T00:00:00Z`))) return null;
  if (!m[4] || p?.params.VALUE === "DATE") return { date, time: null };
  if (Number(m[4]) > 23 || Number(m[5]) > 59) return null;
  return { date, time: `${m[4]}:${m[5]}` };
}

/** Short id of a hall from its text, so that games in the same hall share one location. */
function venueId(text: string): string {
  let h = 0x811c9dc5;
  for (const ch of text.toLowerCase().replace(/\s+/g, " ")) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `h${h.toString(36)}`;
}

/** "Heim - Gast (15:19)": the two teams and the result, if any. */
function teamsOf(summary: string): { home: string; guest: string; homeGoals: number | null; guestGoals: number | null } | null {
  const m = /^(.*?)(?:\s*\((\d{1,3}):(\d{1,3})\))?\s*$/.exec(summary);
  const parts = (m?.[1] ?? "").split(" - ");
  if (parts.length !== 2) return null;
  const [home, guest] = parts.map((p) => p.trim());
  if (!home || !guest) return null;
  return { home, guest, homeGoals: m?.[2] ? Number(m[2]) : null, guestGoals: m?.[3] ? Number(m[3]) : null };
}

/** The games in a team calendar of handball.net, with the calendar's name (the team). */
export function parseCalendar(data: unknown): { name: string | null; games: FixtureGame[]; skipped: number } {
  if (typeof data !== "string" || data.length > MAX_TEXT) throw new FixtureFormatError(t`Response is not a calendar`);
  const lines = contentLines(data);
  if (!lines.some((l) => l.trim().toUpperCase() === "BEGIN:VCALENDAR")) throw new FixtureFormatError(t`Response is not a calendar`);

  let name: string | null = null;
  let event: Property[] | null = null;
  const events: Property[][] = [];
  for (const line of lines) {
    const p = property(line.trim());
    if (!p) continue;
    if (p.name === "BEGIN" && p.value.toUpperCase() === "VEVENT") event = [];
    else if (p.name === "END" && p.value.toUpperCase() === "VEVENT") {
      if (event) events.push(event);
      event = null;
    } else if (event) event.push(p);
    else if (p.name === "X-WR-CALNAME") name = unescape(p.value).trim().slice(0, 80) || null;
  }

  const games: FixtureGame[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  for (const props of events) {
    const get = (n: string) => props.find((p) => p.name === n);
    // UID spiel-469777@…, the game page …/match/469777
    const id = /^spiel-(\d{1,12})@/.exec(get("UID")?.value.trim() ?? "")?.[1];
    // Cancelled games are left out; the core then cancels them in Kabine
    if (get("STATUS")?.value.trim().toUpperCase() === "CANCELLED") continue;
    const start = localStart(get("DTSTART"));
    const teams = teamsOf(unescape(get("SUMMARY")?.value ?? ""));
    // Games without a time (00:00 or a whole day) are not scheduled yet
    if (!id || !start || !start.time || start.time === "00:00" || !teams) {
      skipped++;
      continue;
    }
    if (seen.has(id)) continue;
    seen.add(id);
    const number = /Spielnummer\s+([A-Za-z0-9-]{1,30})/.exec(unescape(get("DESCRIPTION")?.value ?? ""))?.[1] ?? null;
    const location = get("LOCATION")?.value ?? "";
    const venue = venueOf(location);
    games.push({
      externalId: id,
      number,
      date: start.date,
      time: start.time,
      home: teams.home.slice(0, 80),
      guest: teams.guest.slice(0, 80),
      venue: venue ? { externalId: venueId(unescape(location)), name: venue.name.slice(0, 120), address: venue.address?.slice(0, 200) ?? null } : null,
      homeGoals: teams.homeGoals,
      guestGoals: teams.guestGoals,
    });
  }
  return { name, games, skipped };
}

const teamId = (source: FixtureSource) => String(source.teamId);

export const connector: FixtureConnector = {
  name: vendor,
  // The calendar allows browsers (CORS); the coach's device fetches it like a calendar app
  fetchFrom: "device",
  format: "text",
  // Fair use: at the push of a button, at most every 10 minutes per team (as handball4all), and by itself when a coach
  // opens the app, once a week and after each game until its result is there (at most twice); a subscribed calendar
  // app fetches it every 6 hours
  minIntervalMs: 10 * 60_000,
  autoSyncDays: 7,
  autoSyncResults: true,
  linkField: () => ({
    label: t`Link to the team at ${vendor}`,
    hint: t`Open the team at ${vendor} and paste the link from the address bar, or the link of "Subscribe to calendar".`,
    placeholder: "https://www.handball.net/team/…",
  }),
  parseLink: (input) => parseTeamLink(input),
  describe: (source) => {
    const id = teamId(source);
    return t`Team ${id}`;
  },
  request: (source) => ({ url: calendarUrl(teamId(source)) }),
  parse: (data) => {
    const calendar = parseCalendar(data);
    // The calendar comes from the coach's browser and is not trusted: every game must be one of the team's
    if (!calendar.name) throw new FixtureFormatError(t`The calendar names no team`);
    if (calendar.games.some((g) => g.home !== calendar.name && g.guest !== calendar.name)) {
      throw new FixtureFormatError(t`The calendar contains games of another team`);
    }
    return { games: calendar.games, ownTeamHint: calendar.name, skipped: calendar.skipped };
  },
  tableUrl: (source) => teamUrl(teamId(source)),
};
