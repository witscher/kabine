// Club profile (name, colours, logo) for the whole app. Loaded once at start, cached on the
// device so the first paint and offline use show the right club.
import { useEffect, useState } from "preact/hooks";
import { type ClubProfile, clubAbbr, DEFAULT_CLUB, DEFAULT_MODULES, type ModuleId, moduleOn } from "../shared/club";

const CACHE_KEY = "kabine-club";

function readCached(): ClubProfile | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw) as Partial<ClubProfile>;
    return { ...DEFAULT_CLUB, ...stored, modules: { ...DEFAULT_MODULES, ...stored.modules } };
  } catch {
    return null;
  }
}

const cached = typeof localStorage !== "undefined" ? readCached() : null;
let current: ClubProfile = cached ?? DEFAULT_CLUB;

/** Profile from the last visit, if any (language before the first request). */
export function cachedClub(): ClubProfile | null {
  return cached;
}
const listeners = new Set<() => void>();

/** Club colours as CSS variables and browser theme colour. */
function apply(club: ClubProfile) {
  if (typeof document === "undefined") return;
  const root = document.documentElement.style;
  root.setProperty("--black", club.colors.primary);
  root.setProperty("--yellow", club.colors.accent);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", club.colors.primary);
}

apply(current);

export function setClub(club: ClubProfile) {
  current = club;
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(club));
  } catch {
    // private mode: only for this visit
  }
  apply(club);
  for (const l of listeners) l();
}

export async function loadClub(): Promise<void> {
  try {
    const res = await fetch("/api/club", { credentials: "same-origin" });
    if (res.ok) setClub((await res.json()) as ClubProfile);
  } catch {
    // offline: keep the cached profile
  }
}

/** Current club profile, re-renders when it changes. */
export function useClub(): ClubProfile {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  return current;
}

/** Short club name outside components (document title, share texts). */
export function clubName(): string {
  return current.shortName;
}

export function clubLogoUrl(club: ClubProfile = current): string | null {
  return club.logoVersion ? `/api/club/logo?v=${club.logoVersion}` : null;
}

/** Club logo or, without one, the initials on the accent colour. */
export function ClubMark({ class: cls = "logo-mark" }: { class?: string }) {
  const club = useClub();
  const logo = clubLogoUrl(club);
  return (
    <div class={cls} aria-hidden="true">
      {logo ? <img src={logo} alt="" /> : clubAbbr(club)}
    </div>
  );
}

/** IANA time zone of the club, for dates and "now". */
export function clubTimeZone(): string {
  return current.timeZone;
}

/** Is a module of the club on? Re-renders when the profile changes. */
export function useModule(id: ModuleId): boolean {
  return moduleOn(useClub(), id);
}
