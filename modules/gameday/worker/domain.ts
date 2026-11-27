// Home game day (modules/gameday/README.md): a day on which at least N teams of the club play at home. Everyone
// involved (own and children's teams, followed teams, helper duties that day) gets one push the day before, a card on
// home and the page of the day. Days come from the cache per Worker instance (worker/lib/cache.ts, version "duties",
// which migration 202611230400_gameday_sent.sql also bumps on cancellations), so the list on home reads nothing for
// people without a home game day ahead.
import { plural, select, t } from "@lingui/core/macro";
import type { Actor } from "../../../worker/auth/actor";
import { isModuleOn } from "../../../worker/domain/club";
import { cachedRoster, cachedTeamInfo, type TeamInfo } from "../../../worker/domain/events";
import { enqueuePushEach, type PushPayload } from "../../../worker/domain/notify";
import { currentLocale } from "../../../worker/i18n";
import { type CacheVersions, cacheVersions, fromCache } from "../../../worker/lib/cache";
import { all, list, run } from "../../../worker/lib/db";
import { addDays, addMinutesLocal, nowLocal, toLocal, todayLocal } from "../../../worker/lib/time";
import { moduleFollowedTeams, moduleFollowers } from "../../../worker/modules";
import { GAMEDAY_HOURS, type GamedayCard, type GamedayHour, type GamedaySettings } from "../types";

const SETTINGS_KEY = "gameday";
export const GAMEDAY_DEFAULTS: GamedaySettings = { enabled: true, minTeams: 5, hour: 18, mascotVersion: null };
/** The card on home shows this many days ahead. */
export const CARD_DAYS = 3;
/** On the day itself the card stays until this long after the last kick-off. */
const CARD_AFTER_LAST_MINUTES = 120;
/** A missed hourly run (maintenance, update) catches up within this many hours, never late at night. */
const CATCH_UP_HOURS = 3;

// Settings ----------------------------------------------------------------------------------------

export function loadSettings(db: D1Database, versions: CacheVersions): Promise<GamedaySettings> {
  return fromCache(versions, "ref", "gameday-settings", async () => {
    const rows = await all<{ value: string }>(db, "SELECT value FROM app_meta WHERE key = ?", SETTINGS_KEY);
    return parseSettings(rows[0]?.value ?? null);
  });
}

function parseSettings(value: string | null): GamedaySettings {
  let stored: Partial<GamedaySettings> = {};
  try {
    stored = value ? (JSON.parse(value) as Partial<GamedaySettings>) : {};
  } catch {
    // A broken value counts as not set
  }
  return {
    enabled: typeof stored.enabled === "boolean" ? stored.enabled : GAMEDAY_DEFAULTS.enabled,
    minTeams: Number.isInteger(stored.minTeams) && stored.minTeams! >= 2 && stored.minTeams! <= 20 ? stored.minTeams! : GAMEDAY_DEFAULTS.minTeams,
    hour: (GAMEDAY_HOURS as readonly number[]).includes(stored.hour as number) ? (stored.hour as GamedayHour) : GAMEDAY_DEFAULTS.hour,
    mascotVersion: typeof stored.mascotVersion === "number" ? stored.mascotVersion : null,
  };
}

/** Saves the settings; the trigger on app_meta bumps the cache version "ref". */
export async function saveSettings(db: D1Database, next: GamedaySettings): Promise<void> {
  await run(db, "INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", SETTINGS_KEY, JSON.stringify(next));
}

// Days --------------------------------------------------------------------------------------------

export interface HomeGame {
  id: number;
  startsAt: string;
  teamId: number;
  hall: string | null;
}

export interface Gameday {
  date: string;
  /** Home games of the day that take place, one per game and team, by kick-off. */
  games: HomeGame[];
  teamIds: number[];
  /** The venue with the most games. */
  hall: string | null;
  first: string;
  last: string;
}

/**
 * Home games of teams (not groups) from today on that take place, from the cache. Reads the club's upcoming games once
 * per version (index events_kind_starts); the day rule then needs no further query.
 */
function homeGamesFrom(db: D1Database, versions: CacheVersions, today: string): Promise<HomeGame[]> {
  return fromCache(versions, "duties", `gameday-home:${today}`, async () =>
    (
      await all<{ id: number; starts_at: string; team_id: number; hall: string | null }>(
        db,
        `SELECT e.id, e.starts_at, et.team_id, l.name AS hall
           FROM events e JOIN event_teams et ON et.event_id = e.id JOIN teams t ON t.id = et.team_id AND t.kind = 'team'
           LEFT JOIN locations l ON l.id = e.location_id
          WHERE e.kind = 'game' AND e.is_home = 1 AND e.cancelled_at IS NULL AND e.starts_at >= ?
          ORDER BY e.starts_at, e.id, et.team_id`,
        `${today}T00:00`,
      )
    ).map((r) => ({ id: r.id, startsAt: r.starts_at, teamId: r.team_id, hall: r.hall })),
  );
}

/** The day rule: days with home games of at least `minTeams` different teams. */
export function gamedaysOf(games: readonly HomeGame[], minTeams: number): Gameday[] {
  const byDay = new Map<string, HomeGame[]>();
  for (const g of games) {
    const day = g.startsAt.slice(0, 10);
    byDay.set(day, [...(byDay.get(day) ?? []), g]);
  }
  const out: Gameday[] = [];
  for (const [date, list] of byDay) {
    const teamIds = [...new Set(list.map((g) => g.teamId))];
    if (teamIds.length < minTeams) continue;
    const halls = new Map<string, number>();
    for (const g of list) if (g.hall) halls.set(g.hall, (halls.get(g.hall) ?? 0) + 1);
    const hall = [...halls].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
    out.push({ date, games: list, teamIds, hall, first: list[0]!.startsAt, last: list.at(-1)!.startsAt });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** Home game days from today on (club time). */
export async function gamedaysFrom(db: D1Database, versions: CacheVersions, today: string, minTeams: number): Promise<Gameday[]> {
  return gamedaysOf(await homeGamesFrom(db, versions, today), minTeams);
}

/** One day, or null if it is no home game day. */
export async function loadGameday(db: D1Database, versions: CacheVersions, date: string, minTeams: number, today = todayLocal()): Promise<Gameday | null> {
  if (date < today) return null;
  return (await gamedaysFrom(db, versions, today, minTeams)).find((d) => d.date === date) ?? null;
}

// Who is involved ---------------------------------------------------------------------------------

/** Teams whose events one sees anyway: one's own (any role) and the children's where parents are involved. */
export function ownTeamIds(actor: Actor): number[] {
  const ids = new Set(actor.memberships.map((m) => m.teamId));
  for (const ms of actor.childMemberships.values()) for (const m of ms) if (m.parentsEnabled) ids.add(m.teamId);
  return [...ids];
}

export interface Involvement {
  own: number[];
  fan: number[];
  duty: boolean;
}

/**
 * How the person (or a child) is involved on these days: own or followed teams play, or a helper duty. Followed teams
 * through the fans module (hook follows, only while it is on), duties in one query for the days not settled by teams.
 */
export async function involvement(db: D1Database, actor: Actor, days: Gameday[]): Promise<Map<string, Involvement>> {
  const out = new Map<string, Involvement>();
  if (!days.length) return out;
  const own = new Set(ownTeamIds(actor));
  const followed = new Set((await moduleFollowedTeams(db, actor)).filter((id) => !own.has(id)));
  for (const d of days) out.set(d.date, { own: d.teamIds.filter((id) => own.has(id)), fan: d.teamIds.filter((id) => followed.has(id)), duty: false });
  const open = days.filter((d) => !out.get(d.date)!.own.length && !out.get(d.date)!.fan.length).map((d) => d.date);
  if (open.length && isModuleOn("duties")) {
    for (const date of await dutyDays(db, [actor.personId, ...actor.children.map((c) => c.id)], open)) out.get(date)!.duty = true;
  }
  return out;
}

/** Days among `days` on which these persons have a helper duty (themselves or for a child). Starts at the persons. */
export async function dutyDays(db: D1Database, personIds: number[], days: string[]): Promise<string[]> {
  const sorted = [...days].sort();
  const rows = await all<{ date: string }>(
    db,
    `SELECT DISTINCT substr(e.starts_at, 1, 10) AS date
       FROM duties d JOIN events e ON e.id = d.event_id
      WHERE (d.person_id IN (SELECT value FROM json_each(?1)) OR d.child_id IN (SELECT value FROM json_each(?1)))
        AND e.starts_at >= ?2 AND e.starts_at < ?3 AND e.cancelled_at IS NULL
        AND substr(e.starts_at, 1, 10) IN (SELECT value FROM json_each(?4))`,
    list(personIds),
    `${sorted[0]}T00:00`,
    `${addDays(sorted.at(-1)!, 1)}T00:00`,
    list(sorted),
  );
  return rows.map((r) => r.date);
}

const involved = (i: Involvement | undefined) => !!i && (i.own.length > 0 || i.fan.length > 0 || i.duty);

/** The card: own and followed games of the day, each with the first kick-off of the team. */
export function cardOf(gd: Gameday, inv: Involvement, teams: Map<number, TeamInfo>): GamedayCard {
  const firstOf = new Map<number, HomeGame>();
  for (const g of gd.games) if (!firstOf.has(g.teamId)) firstOf.set(g.teamId, g);
  const mine = [...inv.own.map((id) => ({ id, fan: false })), ...inv.fan.map((id) => ({ id, fan: true }))]
    .map(({ id, fan }) => ({ g: firstOf.get(id), team: teams.get(id), fan }))
    .filter((x): x is { g: HomeGame; team: TeamInfo; fan: boolean } => !!x.g && !!x.team)
    .sort((a, b) => a.g.startsAt.localeCompare(b.g.startsAt) || a.team.name.localeCompare(b.team.name))
    .map(({ g, team, fan }) => ({ eventId: g.id, startsAt: g.startsAt, team: team.name, fan, liveMinutes: team.game_minutes }));
  return { date: gd.date, teams: gd.teamIds.length, hall: gd.hall, first: gd.first, last: gd.last, mine };
}

/**
 * The person's part of the list on home: the card for the first day they are involved in within the next days (on the
 * day itself until two hours after the last kick-off), and later days within the page's window as small tiles.
 * Reads nothing from D1 while no home game day lies ahead.
 */
export async function homeData(
  db: D1Database,
  actor: Actor,
  window: { to: string },
  now = Date.now(),
): Promise<{ card: GamedayCard | null; later: { date: string; startsAt: string }[]; settings: GamedaySettings } | null> {
  const settings = await loadSettings(db, actor.versions);
  const today = todayLocal(now);
  const nowL = nowLocal(now);
  const cardUntil = addDays(today, CARD_DAYS);
  const days = (await gamedaysFrom(db, actor.versions, today, settings.minTeams)).filter(
    (d) => (d.date <= cardUntil || d.first < window.to) && (d.date !== today || addMinutesLocal(d.last, CARD_AFTER_LAST_MINUTES) > nowL),
  );
  if (!days.length) return null;
  const inv = await involvement(db, actor, days);
  const cardDay = days.find((d) => d.date <= cardUntil && involved(inv.get(d.date)));
  const teams = cardDay ? new Map((await cachedTeamInfo(db, actor.versions)).map((tm) => [tm.id, tm])) : null;
  const card = cardDay ? cardOf(cardDay, inv.get(cardDay.date)!, teams!) : null;
  // At the kick-off of the first home game; the card's day is not repeated
  const later = days
    .filter((d) => d.date > today && d.date !== card?.date && d.first < window.to && involved(inv.get(d.date)))
    .map((d) => ({ date: d.date, startsAt: d.first }));
  if (!card && !later.length) return null;
  return { card, later, settings };
}

// The push the day before -------------------------------------------------------------------------

/** Why an account gets the push; the text names the most personal reason. */
export interface GamedayReason {
  /** The account's own person plays (first own game). */
  self: { time: string; team: string } | null;
  /** Children who play. */
  children: { name: string; time: string; team: string }[];
  /** Own, children's or followed teams that play without the person or the child (coach, not nominated, fan). */
  teams: { time: string; team: string }[];
  /** Start of the earliest helper duty that day. */
  duty: string | null;
}

/**
 * Every account involved on the day with its reasons: players, helpers, coaches and staff of the playing teams, the
 * parents of their players where parents are involved, the fans of these teams (fans module) and whoever has a helper
 * duty that day (duties module). Not: inactive or former persons, disabled accounts, the topic "gameday" switched off.
 * Teams, rosters and parent links come from the cache.
 */
export async function recipients(db: D1Database, gd: Gameday, versions?: CacheVersions): Promise<Map<number, GamedayReason>> {
  const v = versions ?? (await cacheVersions(db));
  const [teams, roster, guardianships] = await Promise.all([
    cachedTeamInfo(db, v),
    cachedRoster(db, v),
    fromCache(v, "roster", "guardianships", () => all<{ guardian_id: number; child_id: number }>(db, "SELECT guardian_id, child_id FROM guardianships")),
  ]);
  const team = new Map(teams.map((tm) => [tm.id, tm]));
  const firstOf = new Map<number, HomeGame>();
  for (const g of gd.games) if (!firstOf.has(g.teamId)) firstOf.set(g.teamId, g);
  const gameIds = [...new Set(gd.games.map((g) => g.id))];
  const from = `${gd.date}T00:00`;
  const to = `${addDays(gd.date, 1)}T00:00`;

  const [leaders, squads, followers, duties] = await Promise.all([
    all<{ person_id: number; team_id: number }>(
      db,
      `SELECT tm.person_id, tm.team_id FROM team_memberships tm JOIN persons p ON p.id = tm.person_id AND p.is_former = 0 AND p.is_active = 1
        WHERE tm.team_id IN (SELECT value FROM json_each(?)) AND tm.role IN ('coach', 'staff')`,
      list(gd.teamIds),
    ),
    // Who plays: before the squad everyone, afterwards the nominated (with "whole team at games" everyone)
    all<{ event_id: number; published: number; person_id: number | null }>(
      db,
      `SELECT e.id AS event_id, e.squad_published_at IS NOT NULL AS published, n.person_id
         FROM events e LEFT JOIN nominations n ON n.event_id = e.id AND e.squad_published_at IS NOT NULL
        WHERE e.id IN (SELECT value FROM json_each(?))`,
      list(gameIds),
    ),
    moduleFollowers(db, gd.teamIds),
    isModuleOn("duties")
      ? all<{ person_id: number; starts_at: string }>(
          db,
          `SELECT d.person_id, MIN(ed.starts_at) AS starts_at
             FROM events e JOIN duties d ON d.event_id = e.id JOIN event_duties ed ON ed.id = d.event_duty_id
            WHERE e.kind IN ('game', 'special') AND e.starts_at >= ?1 AND e.starts_at < ?2 AND e.cancelled_at IS NULL AND d.person_id IS NOT NULL
            GROUP BY d.person_id`,
          from,
          to,
        )
      : Promise.resolve([]),
  ]);
  const published = new Set(squads.filter((s) => s.published).map((s) => s.event_id));
  const nominated = new Set(squads.filter((s) => s.person_id != null).map((s) => `${s.event_id}:${s.person_id}`));
  const plays = (g: HomeGame, personId: number) =>
    !published.has(g.id) || team.get(g.teamId)?.game_all_players === 1 || nominated.has(`${g.id}:${personId}`);
  const entry = (g: HomeGame) => ({ time: g.startsAt.slice(11, 16), team: team.get(g.teamId)?.name ?? "" });

  // Per person first: what they do themselves; then per account (own person, children, follows)
  const players = roster.filter((m) => m.is_active === 1 && firstOf.has(m.team_id));
  const childrenOf = new Map<number, number[]>();
  for (const g of guardianships) childrenOf.set(g.guardian_id, [...(childrenOf.get(g.guardian_id) ?? []), g.child_id]);
  const childPlayers = new Set(players.filter((m) => team.get(m.team_id)?.parents_enabled === 1).map((m) => m.person_id));
  const guardiansOfPlayers = [...childrenOf].filter(([, kids]) => kids.some((k) => childPlayers.has(k))).map(([g]) => g);
  const personIds = [...new Set([...players.map((m) => m.person_id), ...leaders.map((l) => l.person_id), ...guardiansOfPlayers, ...duties.map((d) => d.person_id)])];
  const followerAccounts = [...new Set(followers.map((f) => f.accountId))];
  if (!personIds.length && !followerAccounts.length) return new Map();
  const accounts = await all<{ id: number; person_id: number }>(
    db,
    `SELECT a.id, a.person_id FROM accounts a JOIN persons p ON p.id = a.person_id AND p.is_former = 0
      WHERE a.disabled_at IS NULL AND (a.person_id IN (SELECT value FROM json_each(?1)) OR a.id IN (SELECT value FROM json_each(?2)))
        AND NOT EXISTS (SELECT 1 FROM notification_settings ns
                         WHERE ns.account_id = a.id AND ns.person_id = a.person_id AND ns.topic = 'gameday' AND ns.enabled = 0)`,
    list(personIds),
    list(followerAccounts),
  );

  const out = new Map<number, GamedayReason>();
  for (const a of accounts) {
    const r: GamedayReason = { self: null, children: [], teams: [], duty: null };
    const addTeam = (g: HomeGame) => {
      const e = entry(g);
      if (!r.teams.some((x) => x.team === e.team) && r.self?.team !== e.team && !r.children.some((c) => c.team === e.team)) r.teams.push(e);
    };
    const own = players.filter((m) => m.person_id === a.person_id).map((m) => firstOf.get(m.team_id)!);
    const mine = own.filter((g) => plays(g, a.person_id)).sort((x, y) => x.startsAt.localeCompare(y.startsAt));
    if (mine[0]) r.self = entry(mine[0]);
    for (const kid of childrenOf.get(a.person_id) ?? []) {
      const rows = players.filter((m) => m.person_id === kid && team.get(m.team_id)?.parents_enabled === 1);
      const playing = rows.map((m) => firstOf.get(m.team_id)!).filter((g) => plays(g, kid)).sort((x, y) => x.startsAt.localeCompare(y.startsAt));
      if (playing[0]) r.children.push({ name: rows[0]!.first_name, ...entry(playing[0]) });
    }
    for (const g of own) addTeam(g);
    for (const kid of childrenOf.get(a.person_id) ?? [])
      for (const m of players) if (m.person_id === kid && team.get(m.team_id)?.parents_enabled === 1) addTeam(firstOf.get(m.team_id)!);
    for (const l of leaders) if (l.person_id === a.person_id) addTeam(firstOf.get(l.team_id)!);
    for (const f of followers) if (f.accountId === a.id) addTeam(firstOf.get(f.teamId)!);
    r.duty = duties.find((d) => d.person_id === a.person_id)?.starts_at ?? null;
    r.children.sort((x, y) => x.time.localeCompare(y.time) || x.name.localeCompare(y.name));
    r.teams.sort((x, y) => x.time.localeCompare(y.time) || x.team.localeCompare(y.team));
    if (r.self || r.children.length || r.teams.length || r.duty) out.set(a.id, r);
  }
  return out;
}

const listOf = (parts: string[]) => new Intl.ListFormat(currentLocale(), { type: "conjunction" }).format(parts);

/** The text of the push for one account, in the current language (enqueuePushEach renders it per recipient). */
export function gamedayPush(gd: Gameday, r: GamedayReason): PushPayload {
  const count = gd.teamIds.length;
  const hall = gd.hall;
  const intro = hall ? plural(count, { other: `# teams play at home in ${hall}` }) : plural(count, { other: "# teams play at home" });
  const form = r.self ? "self" : r.children.length === 1 ? "child" : r.children.length ? "children" : r.teams.length === 1 ? "team" : r.teams.length ? "teams" : "duty";
  const time = r.self?.time ?? r.children[0]?.time ?? r.teams[0]?.time ?? r.duty?.slice(11, 16) ?? "";
  const team = r.self?.team ?? r.children[0]?.team ?? r.teams[0]?.team ?? "";
  const name = r.children[0]?.name ?? "";
  const kids = listOf(
    r.children.slice(0, 3).map((c) => {
      const { name, team, time } = c;
      return t`${name} (${team}) at ${time}`;
    }),
  );
  const several = listOf(
    r.teams.slice(0, 2).map((x) => {
      const { team, time } = x;
      return t`the ${team} at ${time}`;
    }),
  );
  const detail = select(form, {
    self: `you play at ${time} (${team})`,
    child: `${name} plays at ${time} (${team})`,
    children: `${kids} play`,
    team: `the ${team} play at ${time}`,
    teams: `${several} play`,
    other: `your helper duty starts at ${time}`,
  });
  return {
    title: t`Tomorrow is home game day!`,
    body: t`${intro}, ${detail}. Come early or stay longer, the others are glad about every fan.`,
    url: `/heimspieltag/${gd.date}`,
    tag: `gameday-${gd.date}`,
  };
}

/**
 * Hourly: at the configured hour of the day before (club time), once per day, the push to everyone involved. A run
 * missed by maintenance catches up within three hours. Returns the number of accounts with a device reached.
 */
export async function sendGamedayNotice(env: Env, now = Date.now()): Promise<number> {
  const versions = await cacheVersions(env.DB);
  const s = await loadSettings(env.DB, versions);
  const hour = Number(toLocal(now).slice(11, 13));
  if (!s.enabled || hour < s.hour || hour >= s.hour + CATCH_UP_HOURS) return 0;
  const today = todayLocal(now);
  const gd = await loadGameday(env.DB, versions, addDays(today, 1), s.minTeams, today);
  if (!gd) return 0;
  // Claimed before sending: a second run (or a retry after an error) sends nothing again
  const claimed = await run(env.DB, "INSERT OR IGNORE INTO gameday_sent (day) VALUES (?)", gd.date);
  if (!claimed.meta.changes) return 0;
  await run(env.DB, "DELETE FROM gameday_sent WHERE day < ?", addDays(today, -7));
  const reasons = await recipients(env.DB, gd, versions);
  return enqueuePushEach(env, [...reasons.keys()], (account) => gamedayPush(gd, reasons.get(account)!));
}
