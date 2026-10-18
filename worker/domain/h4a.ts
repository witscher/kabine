// Game schedule from handball4all.
//
// The interface is protected against automated access. It is therefore queried
// only from the device of a coach or admin (CORS is allowed), sparingly and
// throttled. The server checks the response format and syncs the games; it never
// calls handball4all itself.

import { t } from "@lingui/core/macro";

export const H4A_ENDPOINT = "https://spo.handball4all.de/service/if_g_json.php";

/** League with table in the handball4all portal (ogId is in the link, the BWHV portal shows every association). */
export function h4aTableUrl(orgId: number, leagueId: number, teamId: number | null): string {
  const team = teamId ? `&tId=${teamId}` : "";
  return `https://www.handball4all.de/home/portal/baden-wuerttembergischer-hv#/league?ogId=${orgId}&lId=${leagueId}${team}`;
}

export function h4aFetchUrl(orgId: number, leagueId: number, teamId: number): string {
  return `${H4A_ENDPOINT}?cmd=ps&og=${orgId}&cl=${leagueId}&ct=${teamId}`;
}

export interface H4aIds {
  orgId: number;
  leagueId: number;
  teamId: number;
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
  return orgId && leagueId && teamId ? { orgId, leagueId, teamId } : null;
}

export interface H4aGame {
  gameId: string;
  gameNo: string | null;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  home: string;
  guest: string;
  gymId: number | null;
  gymName: string | null;
  gymAddress: string | null;
  homeGoals: number | null;
  guestGoals: number | null;
}

export interface H4aSchedule {
  leagueId: string | null;
  leagueName: string | null;
  teams: { teamId: string; teamName: string }[];
  games: H4aGame[];
  skipped: number;
}

export class H4aFormatError extends Error {}

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

export function parseSchedule(data: unknown): H4aSchedule {
  const root = Array.isArray(data) ? data[0] : data;
  if (typeof root !== "object" || root === null) throw new H4aFormatError(t`Response is not an object`);
  const content = (root as Record<string, unknown>).content;
  if (typeof content !== "object" || content === null) throw new H4aFormatError(t`Field content is missing`);
  const c = content as Record<string, unknown>;
  if (!("actualGames" in c) && !("futureGames" in c)) throw new H4aFormatError(t`No game lists found`);

  const head = (root as Record<string, unknown>).head as Record<string, unknown> | undefined;
  const allGroups = [...groups(c.actualGames), ...groups(c.futureGames)];
  const seen = new Set<string>();
  const games: H4aGame[] = [];
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
        gameId,
        gameNo: str(r.gNo),
        date: d,
        time: clock,
        home: home.slice(0, 80),
        guest: guest.slice(0, 80),
        gymId: gymIdRaw && /^\d{1,10}$/.test(gymIdRaw) ? Number(gymIdRaw) : null,
        gymName: str(r.gGymnasiumName)?.slice(0, 120) ?? null,
        gymAddress: [street, [postal, town].filter(Boolean).join(" ")].filter(Boolean).join(", ").slice(0, 200) || null,
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

/**
 * Matchday instead of a single game (F youth and younger): handball4all lists it as
 * a game of the host against the placeholder "Spieltag gF"; all teams of the
 * division take part.
 */
export function isMatchdayName(name: string | null | undefined): boolean {
  return /^Spieltag\b/i.test(name?.trim() ?? "");
}

/** For matchdays: the host (the other side of the placeholder), else null. */
export function matchdayHost(g: Pick<H4aGame, "home" | "guest">): string | null {
  if (isMatchdayName(g.guest)) return g.home;
  if (isMatchdayName(g.home)) return g.guest;
  return null;
}

/** Matchday: home matchday if the own club hosts or it is played in an own hall. */
export function matchdayIsHome(g: H4aGame, hint: string | null, homeGymIds: Set<number>): boolean {
  const host = matchdayHost(g)?.toLowerCase() ?? "";
  const own = hint?.toLowerCase() ?? "";
  if (own && host && (host === own || own.startsWith(host) || host.startsWith(own))) return true;
  return g.gymId != null && homeGymIds.has(g.gymId);
}

/**
 * Which name in the games is the own team? When queried with the team filter
 * it appears in every game.
 */
export function ownTeamName(games: H4aGame[], hint: string | null, homeGymIds: Set<number>): string | null {
  if (!games.length) return null;
  const counts = new Map<string, number>();
  for (const g of games) {
    counts.set(g.home, (counts.get(g.home) ?? 0) + 1);
    if (g.guest !== g.home) counts.set(g.guest, (counts.get(g.guest) ?? 0) + 1);
  }
  const inAll = [...counts.entries()].filter(([, n]) => n === games.length).map(([name]) => name);
  if (inAll.length === 1) return inAll[0]!;
  if (hint) {
    const lower = hint.toLowerCase();
    const match = [...counts.keys()].find((n) => n.toLowerCase() === lower || lower.startsWith(n.toLowerCase()));
    if (match) return match;
  }
  const atHome = games.find((g) => g.gymId != null && homeGymIds.has(g.gymId));
  return atHome?.home ?? null;
}
