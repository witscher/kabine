// Refreshing without restarting the app: pull to refresh on the main pages
// and automatic reload when returning to the app after a while.
import { t } from "@lingui/core/macro";
import { useLocation } from "preact-iso";
import { useEffect, useRef, useState } from "preact/hooks";
import { Icon } from "./icons";
import { refreshVisible } from "./store";

/** After this long away, the visible view reloads on return. */
const RESUME_AFTER_MS = 60_000;
/** Pull distance (after damping) from which releasing reloads. */
const THRESHOLD = 70;
const MAX_PULL = 110;

/** Pages with their own refresh (chat) or without data to reload. */
const EXCLUDED = [/^\/chat/, /^\/einladung/, /^\/einrichtung/, /^\/email/, /^\/datenschutz/, /^\/kihasl/];

export function ResumeRefresh() {
  useEffect(() => {
    let hiddenAt: number | null = null;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") hiddenAt = Date.now();
      else if (hiddenAt != null && Date.now() - hiddenAt >= RESUME_AFTER_MS) {
        hiddenAt = null;
        void refreshVisible();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);
  return null;
}

export function PullToRefresh() {
  const { path } = useLocation();
  const [pull, setPull] = useState(0);
  const [busy, setBusy] = useState(false);
  const state = useRef<{ startX: number; startY: number; active: boolean; pull: number } | null>(null);
  const enabled = !EXCLUDED.some((r) => r.test(path));

  useEffect(() => {
    if (!enabled) return;
    const onStart = (e: TouchEvent) => {
      if (busy || e.touches.length !== 1 || window.scrollY > 0 || document.querySelector("dialog[open]")) {
        state.current = null;
        return;
      }
      const touch = e.touches[0]!;
      state.current = { startX: touch.clientX, startY: touch.clientY, active: false, pull: 0 };
    };
    const onMove = (e: TouchEvent) => {
      const s = state.current;
      if (!s) return;
      const touch = e.touches[0]!;
      const dy = touch.clientY - s.startY;
      const dx = Math.abs(touch.clientX - s.startX);
      if (!s.active) {
        // Only straight down from the very top; sideways swiping and scrolling stay untouched
        if (dy < 8 || dx > dy || window.scrollY > 0) {
          if (dy < -8 || dx > 12) state.current = null;
          return;
        }
        s.active = true;
      }
      e.preventDefault();
      s.pull = Math.min(MAX_PULL, (dy - 8) * 0.5);
      setPull(s.pull);
    };
    const onEnd = () => {
      const s = state.current;
      state.current = null;
      if (!s?.active) return;
      if (s.pull >= THRESHOLD) {
        setBusy(true);
        setPull(THRESHOLD);
        void refreshVisible().finally(() => {
          setBusy(false);
          setPull(0);
        });
      } else {
        setPull(0);
      }
    };
    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onEnd);
    window.addEventListener("touchcancel", onEnd);
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
    };
  }, [enabled, busy]);

  if (!enabled || (pull === 0 && !busy)) return null;
  const ready = pull >= THRESHOLD;
  return (
    <div class={`ptr ${busy ? "busy" : ""} ${ready ? "ready" : ""}`} style={{ transform: `translate(-50%, ${pull - 44}px)` }} role="status" aria-live="polite">
      <span class="ptr-icon" style={{ transform: busy ? undefined : `rotate(${pull * 3}deg)` }}>
        <Icon name="refresh" size={20} />
      </span>
      <span class="sr-only">{busy ? t`Refreshing` : ready ? t`Release to refresh` : t`Pull to refresh`}</span>
    </div>
  );
}
