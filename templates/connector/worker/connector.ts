// Game schedule from __VENDOR__. Access: describe the permitted access here (official API, public export or
// the association's permission) and link the terms of use in README.md. Guide: docs/dev/connectors.md.
//
// This template reads an invented JSON format, see ../samples/schedule.json. Replace parseLink, request and
// parse with the real format of the source, then record real (or realistic) samples.
import { t } from "@lingui/core/macro";
import { type FixtureConnector, FixtureFormatError, type FixtureGame } from "../../../worker/module-api";

const vendor = "__VENDOR__";
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

const text = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const goals = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null);

export const connector: FixtureConnector = {
  name: vendor,
  // "worker" when the source allows servers; "device" when only browsers may fetch (CORS)
  fetchFrom: "worker",
  minIntervalMs: 10 * 60_000,
  linkField: () => ({
    label: t`Link to the team's page at ${vendor}`,
    hint: t`Open the team at ${vendor} and paste the link from the address bar.`,
    placeholder: "https://www.__DOMAIN__/teams/…",
  }),
  /** https://www.__DOMAIN__/teams/<team>?league=<league> */
  parseLink: (input) => {
    let url: URL;
    try {
      url = new URL(input.trim());
    } catch {
      return null;
    }
    if (url.hostname !== "www.__DOMAIN__") return null;
    const team = /^\/teams\/(\d{1,10})\/?$/.exec(url.pathname)?.[1];
    const league = url.searchParams.get("league");
    return team && league && /^\d{1,10}$/.test(league) ? { leagueId: league, teamId: team } : null;
  },
  describe: (source) => {
    const leagueId = String(source.leagueId);
    const teamId = String(source.teamId);
    return t`League ${leagueId}, team ${teamId}`;
  },
  request: (source) => ({
    url: `https://api.__DOMAIN__/schedule?league=${encodeURIComponent(String(source.leagueId))}&team=${encodeURIComponent(String(source.teamId))}`,
  }),
  parse: (data, source) => {
    if (typeof data !== "object" || data === null || !Array.isArray((data as { games?: unknown }).games)) throw new FixtureFormatError(t`No game list found`);
    const root = data as { league?: unknown; team?: unknown; games: unknown[] };
    // Data may come from a browser: it must belong to the team's league
    if (String(root.league) !== String(source.leagueId)) throw new FixtureFormatError(t`The data belongs to another league`);
    const games: FixtureGame[] = [];
    let skipped = 0;
    for (const raw of root.games) {
      const g = (raw ?? {}) as Record<string, unknown>;
      const id = text(g.id, 40);
      const date = text(g.date, 10);
      const time = text(g.time, 5);
      const home = text(g.home, 80);
      const guest = text(g.guest, 80);
      if (!id || /[:\s]/.test(id) || !date || !DATE.test(date) || !time || !TIME.test(time) || !home || !guest) {
        skipped++;
        continue;
      }
      const v = (g.venue ?? null) as Record<string, unknown> | null;
      const venueId = v ? text(v.id, 40) : null;
      games.push({
        externalId: id,
        number: text(g.number, 20),
        date,
        time,
        home,
        guest,
        venue: venueId && !/[:\s]/.test(venueId) ? { externalId: venueId, name: text(v!.name, 120), address: text(v!.address, 200) } : null,
        homeGoals: goals(g.homeGoals),
        guestGoals: goals(g.guestGoals),
      });
    }
    return { games, ownTeamHint: text(root.team, 80), skipped };
  },
  tableUrl: (source) => `https://www.__DOMAIN__/leagues/${encodeURIComponent(String(source.leagueId))}`,
};
