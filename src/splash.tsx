// Start animation with the club logo (or its initials): 2.5 seconds, once a day on first open.
// The app already loads data underneath.
import { useEffect, useState } from "preact/hooks";
import { shouldShowSplash } from "../shared/inactivity";
import { ClubMark, useClub } from "./club";
import { todayLocal } from "./format";

const LAST_SHOWN = "kabine-splash-day";
/** Total duration including fade-out; the build-up ends after about 1.3 s. */
const TOTAL_MS = 2500;

function due(): boolean {
  if (!__SPLASH__) return false;
  if (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
  let last: string | null = null;
  try {
    last = localStorage.getItem(LAST_SHOWN);
  } catch {
    // Private mode: then every time
  }
  return shouldShowSplash(last, todayLocal());
}

function markShown() {
  try {
    localStorage.setItem(LAST_SHOWN, todayLocal());
  } catch {
    // see above
  }
}

export function Splash() {
  const [run, setRun] = useState(due);
  const club = useClub();

  useEffect(() => {
    // The first opening of the day can also be bringing it back from the background
    const onVisible = () => {
      if (document.visibilityState === "visible" && due()) setRun(true);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  useEffect(() => {
    if (!run) return;
    markShown();
    const t = window.setTimeout(() => setRun(false), TOTAL_MS);
    return () => window.clearTimeout(t);
  }, [run]);

  if (!run) return null;
  return (
    <div class="splash" role="img" aria-label={club.name} onClick={() => setRun(false)}>
      <ClubMark class="splash-mark" />
      <div class="splash-word">{club.shortName}</div>
    </div>
  );
}
