// Cache per Worker instance for data that rarely changes (docs/dev/decisions.md, "Read load").
// Every use reads the version numbers (one small query, mostly in the same batch as other queries); only when one
// has changed is the data loaded again. Triggers in the database bump the versions on every change
// (migrations/202611191400_core_cache-versions.sql), also on changes made directly in D1, so the cache never
// returns a stale state. Sessions and permissions are not cached.
import { all } from "./db";

export type CacheName = "ref" | "roster" | "duties";
export type CacheVersions = Record<CacheName, number>;

/** Query for the versions, to put into a db.batch together with other queries. */
export const CACHE_VERSIONS_SQL = "SELECT name, version FROM cache_versions";

const store = new Map<string, { version: number; value: unknown }>();

/** Versions from the rows of CACHE_VERSIONS_SQL; -1 for a missing one (then nothing is cached). */
export function toVersions(rows: readonly { name: string; version: number }[]): CacheVersions {
  const out: CacheVersions = { ref: -1, roster: -1, duties: -1 };
  for (const r of rows) if (r.name in out) out[r.name as CacheName] = r.version;
  return out;
}

export async function cacheVersions(db: D1Database): Promise<CacheVersions> {
  return toVersions(await all<{ name: string; version: number }>(db, CACHE_VERSIONS_SQL));
}

/**
 * The value from the cache if it matches the current version, else loaded again. If something changes between
 * reading the version and loading, the stored state no longer matches next time and is loaded again.
 * Without a version (-1) nothing is cached.
 */
export async function fromCache<T>(versions: CacheVersions, name: CacheName, key: string, load: () => Promise<T>): Promise<T> {
  const version = versions[name];
  const id = `${name}:${key}`;
  const hit = store.get(id);
  if (version >= 0 && hit && hit.version === version) return hit.value as T;
  // Frozen: many requests share the stored state, none may change it
  const value = freeze(await load());
  if (version >= 0) store.set(id, { version, value });
  return value;
}

function freeze<T>(value: T): T {
  if (Array.isArray(value)) for (const v of value) if (v && typeof v === "object") Object.freeze(v);
  return Object.freeze(value);
}

export async function cached<T>(db: D1Database, name: CacheName, key: string, load: () => Promise<T>): Promise<T> {
  return fromCache(await cacheVersions(db), name, key, load);
}
