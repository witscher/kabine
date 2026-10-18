// Game schedule from handball4all (German handball associations).
//
// The interface is protected against automated access. It is therefore queried
// only from the device of a coach or admin (CORS is allowed), sparingly and
// throttled. The server checks the response format and syncs the games; it never
// calls handball4all itself.

import { t } from "@lingui/core/macro";
import { type FixtureConnector, FixtureFormatError, type FixtureGame, type FixtureSchedule, type FixtureSource } from "../../../worker/module-api";

export const H4A_ENDPOINT = "https://spo.handball4all.de/service/if_g_json.php";

/** Portal used when the team's link named none; every portal shows every association (ogId). */
const DEFAULT_PORTAL = "baden-wuerttembergischer-hv";

/** League with table in the handball4all portal of the association the coach linked. */
export function h4aTableUrl(orgId: number, leagueId: number, teamId: number | null, portal: string | null = null): string {
  const team = teamId ? `&tId=${teamId}` : "";
  return `https://www.handball4all.de/home/portal/${portal ?? DEFAULT_PORTAL}#/league?ogId=${orgId}&lId=${leagueId}${team}`;
}

export function h4aFetchUrl(orgId: number, leagueId: number, teamId: number): string {
  return `${H4A_ENDPOINT}?cmd=ps&og=${orgId}&cl=${leagueId}&ct=${teamId}`;
}

export interface H4aIds {
  orgId: number;
  leagueId: number;
  teamId: number;
  /** Association portal from the link (…/home/portal/<portal>#/…), if any. */
  portal: string | null;
}

/**
 * Reads association, league and team from a portal link
 * (…/portal/…#/league?ogId=216&lId=164621&tId=1489086) or an API link.
 */
export function parsePortalUrl(input: string): H4aIds | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (!/(^|\.)handball4all\.de$/.test(url.hostname)) return null;
  const params = new URLSearchParams(url.search);
  const hashQuery = url.hash.includes("?") ? url.hash.slice(url.hash.indexOf("?") + 1) : "";
  for (const [k, v] of new URLSearchParams(hashQuery)) params.set(k, v);
  const num = (...keys: string[]) => {
    for (const k of keys) {
      const v = params.get(k);
      if (v && /^\d{1,10}$/.test(v)) return Number(v);
    }
    return null;
  };
  const orgId = num("ogId", "og");
  const leagueId = num("lId", "cl");
  const teamId = num("tId", "ct");
  const portal = /^\/home\/portal\/([a-z0-9-]{2,60})\/?$/.exec(url.pathname)?.[1] ?? null;
  return orgId && leagueId && teamId ? { orgId, leagueId, teamId, portal } : null;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : typeof v === "number" ? String(v) : null);

function goals(v: unknown): number | null {
  const s = str(v);
  return s && /^\d{1,3}$/.test(s) ? Number(s) : null;
}

function date(v: unknown): string | null {
  const m = /^(\d{2})\.(\d{2})\.(\d{2}|\d{4})$/.exec(str(v) ?? "");
  if (!m) return null;
  const year = m[3]!.length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  return `${year}-${m[2]}-${m[1]}`;
}

function time(v: unknown): string | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(str(v) ?? "");
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
  return `${m[1]!.padStart(2, "0")}:${m[2]}`;
}

function groups(v: unknown): Record<string, unknown>[] {
  if (Array.isArray(v)) return v.filter((x): x is Record<string, unknown> => typeof x === "object" && x !== null);
  if (typeof v === "object" && v !== null) return [v as Record<string, unknown>];
  return [];
}

/** The raw schedule of handball4all, with the league and the team list it names. */
export function parseSchedule(data: unknown): { leagueId: string | null; leagueName: string | null; teams: { teamId: string; teamName: string }[]; games: FixtureGame[]; skipped: number } {
  const root = Array.isArray(data) ? data[0] : data;
  if (typeof root !== "object" || root === null) throw new FixtureFormatError(t`Response is not an object`);
  const content = (root as Record<string, unknown>).content;
  if (typeof content !== "object" || content === null) throw new FixtureFormatError(t`Field content is missing`);
  const c = content as Record<string, unknown>;
  if (!("actualGames" in c) && !("futureGames" in c)) throw new FixtureFormatError(t`No game lists found`);

  const head = (root as Record<string, unknown>).head as Record<string, unknown> | undefined;
  const allGroups = [...groups(c.actualGames), ...groups(c.futureGames)];
  const seen = new Set<string>();
  const games: FixtureGame[] = [];
  let skipped = 0;
  let leagueId: string | null = null;

  for (const g of allGroups) {
    leagueId ??= str(g.gClassID);
    const list = Array.isArray(g.games) ? g.games : [];
    for (const raw of list) {
      if (typeof raw !== "object" || raw === null) continue;
      const r = raw as Record<string, unknown>;
      const gameId = str(r.gID);
      const d = date(r.gDate);
      const clock = time(r.gTime);
      const home = str(r.gHomeTeam);
      const guest = str(r.gGuestTeam);
      if (!gameId || !/^\d{1,12}$/.test(gameId) || !d || !home || !guest) {
        skipped++;
        continue;
      }
      if (!clock) {
        skipped++;
        continue;
      }
      if (seen.has(gameId)) continue;
      seen.add(gameId);
      const gymIdRaw = str(r.gGymnasiumID);
      const street = str(r.gGymnasiumStreet);
      const postal = str(r.gGymnasiumPostal);
      const town = str(r.gGymnasiumTown);
      games.push({
        externalId: gameId,
        number: str(r.gNo),
        date: d,
        time: clock,
        home: home.slice(0, 80),
        guest: guest.slice(0, 80),
        venue:
          gymIdRaw && /^\d{1,10}$/.test(gymIdRaw)
            ? {
                externalId: gymIdRaw,
                name: str(r.gGymnasiumName)?.slice(0, 120) ?? null,
                address: [street, [postal, town].filter(Boolean).join(" ")].filter(Boolean).join(", ").slice(0, 200) || null,
              }
            : null,
        homeGoals: goals(r.gHomeGoals),
        guestGoals: goals(r.gGuestGoals),
      });
    }
  }

  const teams = Array.isArray(c.teamsList)
    ? (c.teamsList as unknown[]).flatMap((entry) => {
        const o = entry as Record<string, unknown>;
        const id = str(o?.teamID);
        const name = str(o?.teamName);
        return id && name ? [{ teamId: id, teamName: name }] : [];
      })
    : [];

  return { leagueId, leagueName: str(head?.name), teams, games, skipped };
}

const ids = (source: FixtureSource) => ({
  orgId: Number(source.orgId),
  leagueId: Number(source.leagueId),
  teamId: Number(source.teamId),
  portal: typeof source.portal === "string" ? source.portal : null,
});

export const handball4all: FixtureConnector = {
  name: "handball4all",
  fetchFrom: "device",
  // Fair use: at the push of a button, at most every 10 minutes per team
  minIntervalMs: 10 * 60_000,
  linkField: () => ({
    label: t`Link from the handball4all portal`,
    hint: t`Open the team in the portal and paste the link from the address bar. It contains ogId, lId and tId.`,
    placeholder: "https://www.handball4all.de/home/portal/…#/league?ogId=…",
  }),
  parseLink: (input) => {
    const found = parsePortalUrl(input);
    return found ? { ...found } : null;
  },
  describe: (source) => {
    const { orgId, leagueId, teamId } = ids(source);
    return t`Association ${orgId}, league ${leagueId}, team ${teamId}`;
  },
  request: (source) => {
    const { orgId, leagueId, teamId } = ids(source);
    return { url: h4aFetchUrl(orgId, leagueId, teamId) };
  },
  parse: (data, source): FixtureSchedule => {
    const schedule = parseSchedule(data);
    // The schedule comes from the coach's browser and is not trusted: it must name the team's league
    if (schedule.leagueId !== String(ids(source).leagueId)) {
      throw new FixtureFormatError(schedule.leagueId ? t`The data belongs to another league` : t`The data names no league`);
    }
    const hint = schedule.teams.find((x) => x.teamId === String(ids(source).teamId))?.teamName ?? null;
    return { games: schedule.games, ownTeamHint: hint, skipped: schedule.skipped };
  },
  tableUrl: (source) => {
    const { orgId, leagueId, teamId, portal } = ids(source);
    return h4aTableUrl(orgId, leagueId, teamId, portal);
  },
};
