// The worker side of a module (modules/<id>/worker/index.ts): its routes and the hooks the core calls.
// Guide: docs/modules.md. Data hooks (routes, cron, event data, notifications) only run while the
// module is on; cleanup hooks always run, because data may exist from a time it was on.
import type { Hono } from "hono";
import type { ModuleManifest } from "../shared/module-api";
import type { AppEnv } from "./app";
import type { Actor } from "./auth/actor";
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
}

/** A fetched schedule that cannot be read; the message is shown to the coach. */
export class FixtureFormatError extends Error {}

/** Settings a team stores for its connector, e.g. association, league and team id (JSON in teams.fixture_source). */
export type FixtureSource = Record<string, string | number | null>;

/**
 * Game schedules from an association's system (module kind "fixtures"). Only permitted access:
 * an official API, a public export or the association's permission (docs/connectors.md).
 */
export interface FixtureConnector {
  /** Brand name of the source, not translated ("handball4all"). */
  name: string;
  /**
   * "device": the coach's browser fetches (for sources that block servers but allow CORS), "worker": the
   * server fetches. Either way the server parses and stores.
   */
  fetchFrom: "device" | "worker";
  /** At least this long between two syncs of a team. */
  minIntervalMs: number;
  /** Texts for the link field in Team → Settings, in the language of the request. */
  linkField(): { label: string; hint: string; placeholder: string };
  /** The team's settings from a link the coach pastes; null if it is not a link of this source. */
  parseLink(input: string): FixtureSource | null;
  /** Short description of a linked source for the coach, e.g. "Association 216, league 555, team 999". */
  describe(source: FixtureSource): string;
  /** What to fetch. */
  request(source: FixtureSource): { url: string; headers?: Record<string, string> };
  /** Reads the fetched JSON; throws FixtureFormatError with a readable reason. */
  parse(data: unknown, source: FixtureSource): FixtureSchedule;
  /** League table for the game view, if the source has one. */
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
}

export function defineWorkerModule(module: WorkerModule): WorkerModule {
  return module;
}
