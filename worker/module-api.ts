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
  /** Tables of the module in the admin's data export (every table must be listed somewhere, test/export.test.ts). */
  exportTables?: readonly string[];
}

export function defineWorkerModule(module: WorkerModule): WorkerModule {
  return module;
}
