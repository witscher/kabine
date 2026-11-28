// Types for site/stats.mjs (used by test/site-stats.test.ts).
export interface DayCounts { day: string; checks: number; installs: number; versions: Record<string, number> }
type Storage = { get(k: string): Promise<unknown>; put(k: string | Record<string, unknown>, v?: unknown): Promise<void>; delete(k: string[]): Promise<unknown>; list(o: { prefix: string; end?: string; reverse?: boolean; limit?: number }): Promise<Map<string, unknown>> };
export declare const KEEP_DAYS: number;
export declare function kabineVersion(userAgent: string | null | undefined): string | null;
export declare function recordCheck(storage: Storage, check: { key: string | null; version: string; now?: number }): Promise<void>;
export declare function readCounts(storage: Storage, days?: number): Promise<DayCounts[]>;
export declare class KabineInstallStats {}
export declare function handleReleases(request: Request, env: unknown, ctx: { waitUntil(p: Promise<unknown>): void }): Response | Promise<Response>;
export declare function handleStats(request: Request, env: unknown): Promise<Response>;
