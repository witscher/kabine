// The worker side of a module (modules/<id>/worker/index.ts): its routes and the hooks the core calls.
// Guide: docs/dev/modules.md. Data hooks (routes, cron, event data, notifications) only run while the
// module is on; cleanup hooks always run, because data may exist from a time it was on.
import type { Hono } from "hono";
import type { ModuleManifest } from "../shared/module-api";
import type { AppEnv } from "./app";
import type { EventKind, FixtureTable } from "../shared/types";
import type { Actor } from "./auth/actor";
import type { CalendarItem } from "./domain/calendar";
import type { EventContext, EventRow } from "./domain/events";
import type { Param } from "./lib/db";

/** People who no longer take part in an event (declined, removed from the squad). */
export interface ParticipantsLeft {
  event: EventRow;
  ctx: EventContext;
  teamIds: number[];
  personIds: number[];
  /** Accounts that caused the change and need no notification about it. */
  exclude: number[];
}

/**
 * Pairs (event_id, person_id) that no longer take part, as SQL: `${with} ... IN (${select})`.
 * Lets a module delete its rows in the same batch as the core, without loading the pairs first.
 */
export interface DroppedPairs {
  /** Optional `WITH ...` clause the select needs. */
  with?: string;
  /** SELECT returning (event_id, person_id). */
  select: string;
  params: Param[];
}

/**
 * A page of the event overview (GET /events?limit=…) as a module sees it, to add rows of its own (hook eventPage).
 * The module keeps its rows inside the window, so "More events" keeps the time order.
 */
export interface EventPageQuery {
  past: boolean;
  /** Kinds the kind chip lets through; null: all. */
  kinds: EventKind[] | null;
  /** Window of the page, local time: from inclusive, to exclusive. Ends where the core's page ends when it has more. */
  from: string;
  to: string;
  /** Page size the app asked for. */
  limit: number;
  /** The module's own query parameters without the prefix (`fans.games=1` → `{ games: "1" }`), set by the app hook homeList. */
  params: Record<string, string>;
}

/**
 * An event was cancelled, its cancellation withdrawn, or it was moved (start or venue), after the core has told its
 * teams. For people outside the teams, e.g. fans of a game (hook eventChanged).
 */
export interface EventChange {
  change: "cancelled" | "restored" | "moved";
  eventId: number;
  kind: EventKind;
  teamIds: number[];
  /** Start before the change and now, local time (equal unless the start moved). */
  before: string;
  startsAt: string;
  /** Accounts that caused the change and need no notification about it. */
  exclude: number[];
}

/** The personal calendar feed a module adds entries to (hook calendarItems). */
export interface CalendarFeed {
  /** The owner of the calendar link, with the same visibility as in the app. */
  actor: Actor;
  /** Window of the feed, local time. */
  from: string;
  to: string;
  /** Origin for links back into the app. */
  origin: string;
  /** Domain part of the entries' UIDs (`event-<id>@<uidHost>` for an event, as the core writes it). */
  uidHost: string;
}

/** A game as a fixture connector delivers it, already checked and normalised. */
export interface FixtureGame {
  /** Id of the game in the source system (unique within the connector). */
  externalId: string;
  /** Game number as the association prints it, if any. */
  number: string | null;
  /** Local date and time in the club's time zone: YYYY-MM-DD, HH:MM. */
  date: string;
  time: string;
  home: string;
  guest: string;
  /** Hall or pitch; externalId lets several games share one location. */
  venue: { externalId: string; name: string | null; address: string | null } | null;
  homeGoals: number | null;
  guestGoals: number | null;
}

export interface FixtureSchedule {
  /** Games of the team's league (all of them, or only the team's). */
  games: FixtureGame[];
  /** Name of the own team as the source writes it, if the source says (helps to tell home from away). */
  ownTeamHint: string | null;
  /** Entries that could not be read. */
  skipped: number;
  /**
   * League table from the same response, if the source delivers one; the row of the linked team marked `own`.
   * Missing or null: the stored table stays as it is (worker/domain/league-table.ts).
   */
  table?: FixtureTable | null;
}

/** A fetched schedule that cannot be read; the message is shown to the coach. */
export class FixtureFormatError extends Error {}

/** Settings a team stores for its connector, e.g. association, league and team id (JSON in teams.fixture_source). */
export type FixtureSource = Record<string, string | number | null>;

/**
 * Game schedules from an association's system (module kind "fixtures"). Only permitted access:
 * an official API, a public export or the association's permission (docs/dev/connectors.md).
 */
export interface FixtureConnector {
  /** Brand name of the source, not translated ("handball4all"). */
  name: string;
  /**
   * "device": the coach's browser fetches (for sources that block servers but allow CORS), "worker": the
   * server fetches. Either way the server parses and stores.
   */
  fetchFrom: "device" | "worker";
  /** How the response is read before `parse`: JSON (default) or plain text, e.g. an iCal calendar. */
  format?: "json" | "text";
  /** At least this long between two syncs of a team. */
  minIntervalMs: number;
  /**
   * Sync by itself after this many days: when a coach of the team opens the app and the last sync is at least
   * this old, the coach's device syncs once in the background, the same way as "Sync now". Missing: only at
   * the press of a button (worker/domain/coach-hints.ts, src/coach-hints.tsx).
   */
  autoSyncDays?: number;
  /**
   * Also sync by itself after each game: once kick-off plus the age class's playing time plus an hour have passed
   * and the game has no result yet, at most twice per game and three hours apart (worker/domain/fixtures.ts,
   * resultDueGames). Only for sources that deliver results and whose terms allow it.
   */
  autoSyncResults?: boolean;
  /** Texts for the link field in Team → Settings, in the language of the request. */
  linkField(): { label: string; hint: string; placeholder: string };
  /** The team's settings from a link the coach pastes; null if it is not a link of this source. */
  parseLink(input: string): FixtureSource | null;
  /** Short description of a linked source for the coach, e.g. "Association 216, league 555, team 999". */
  describe(source: FixtureSource): string;
  /** What to fetch. */
  request(source: FixtureSource): { url: string; headers?: Record<string, string> };
  /** Reads the fetched JSON (or text, see `format`); throws FixtureFormatError with a readable reason. */
  parse(data: unknown, source: FixtureSource): FixtureSchedule;
  /** Link to the league table at the source, if it has one (shown next to the table from `parse`, or alone). */
  tableUrl?(source: FixtureSource): string | null;
}

export interface WorkerModule {
  manifest: ModuleManifest;
  /** Mounted under /api. Every path must match the manifest's `paths` (test/modules-contract.test.ts). */
  routes?: Hono<AppEnv>;
  /** Hourly run (worker/cron.ts); decide yourself what is due. */
  cron?: (env: Env, now: number) => Promise<unknown>;
  /** Extra data per event in event lists, under `event.modules[<id>]`; leave out events without data. */
  eventSummaries?: (db: D1Database, actor: Actor, rows: EventRow[], ctx: EventContext, now: number) => Promise<Map<number, unknown>>;
  /** Extra data on the event page, under `event.modules[<id>]`; null: nothing to show. */
  eventDetail?: (db: D1Database, actor: Actor, event: EventRow, ctx: EventContext, now: number) => Promise<unknown>;
  /** Extra data for a page of the event overview, under `page.modules[<id>]` (app hook homeList); null: nothing. */
  eventPage?: (db: D1Database, actor: Actor, query: EventPageQuery) => Promise<unknown>;
  /** An event was cancelled, restored or moved; the core has already notified its teams. */
  eventChanged?: (env: Env, change: EventChange) => Promise<void>;
  /**
   * Teams an account follows without belonging to them (the fans module), for other modules that tell such people
   * about games (the home game day). Only while the module is on (worker/modules.ts: moduleFollowedTeams, moduleFollowers).
   */
  follows?: {
    /** Ids of the teams this account follows, without its own. */
    teams(db: D1Database, actor: Actor): Promise<number[]>;
    /** Accounts following any of these teams, one row per account and team (own teams of the account may be among them). */
    accounts(db: D1Database, teamIds: number[]): Promise<{ accountId: number; teamId: number }[]>;
  };
  /** Entries for the personal calendar feed of an account (e.g. what the person chose in the module's own settings). */
  calendarItems?: (db: D1Database, feed: CalendarFeed) => Promise<CalendarItem[]>;
  /** Participants left an event (with notifications if the module sends any). */
  participantsLeft?: (env: Env, change: ParticipantsLeft) => Promise<void>;
  /** Cleanup in the core's batch when participants were dropped without notice (automatic squads, withdrawn stand-ins). */
  participantsDropped?: (db: D1Database, pairs: DroppedPairs) => D1PreparedStatement[];
  /** Cleanup in the core's batch when a person leaves the club (`nowLocal`: keep the past, remove the future). */
  personLeaves?: (db: D1Database, personId: number, nowLocal: string) => D1PreparedStatement[];
  /** Text messages (SMS) to a phone number, for sign-in codes and reminders (worker/domain/texts.ts). */
  texts?: {
    /** Set up and ready to send (e.g. a provider key is stored). */
    available(db: D1Database): Promise<boolean>;
    send(env: Env, to: string, text: string): Promise<void>;
  };
  /** Game schedules from an association's system (manifest kind "fixtures"). */
  fixtures?: FixtureConnector;
  /** Tables of the module in the admin's data export (every table must be listed somewhere, test/export.test.ts). */
  exportTables?: readonly string[];
  /**
   * Tables deliberately left out of the export, e.g. short-lived data the season change deletes anyway (polls), or
   * pictures. Listed so test/export.test.ts knows the choice was made.
   */
  exportExcluded?: readonly string[];
  /** Cleanup in the core's batch when the admin starts a new season (worker/routes/season.ts). */
  seasonChange?: (db: D1Database) => D1PreparedStatement[];
  /**
   * What waits for this account's reaction, added to the number on the app icon (worker/domain/badge.ts). Runs for
   * every push sent, so keep it to one cheap query.
   */
  badgeCount?: (db: D1Database, accountId: number, nowLocal: string) => Promise<number>;
}

export function defineWorkerModule(module: WorkerModule): WorkerModule {
  return module;
}
