// Types for site/src/releases.mjs (used by test/site-releases.test.ts).
import type { ReleaseFeed } from "../../shared/releases";
export declare const SECURITY_MARKER: RegExp;
export declare function releaseDates(changelogTs: string): Record<string, string>;
export declare function releasesJson(changelogMd: string, changelogTs: string): ReleaseFeed;
