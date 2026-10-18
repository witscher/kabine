// Aktualisieren ohne Neustart der App: Ziehen zum Aktualisieren auf den Hauptseiten
// und automatisches Neuladen, wenn man nach einer Weile in die App zurückkehrt.
import { useLocation } from "preact-iso";
import { useEffect, useRef, useState } from "preact/hooks";
import { Icon } from "./icons";
import { refreshVisible } from "./store";

/** Ab so langer Abwesenheit lädt die sichtbare Ansicht beim Zurückkehren neu. */
const RESUME_AFTER_MS = 60_000;
/** Zugweg (nach Dämpfung), ab dem Loslassen neu lädt. */
const THRESHOLD = 70;
const MAX_PULL = 110;

/** Seiten mit eigener Aktualisierung (Chat) oder ohne Daten zum Neuladen. */
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
      const t = e.touches[0]!;
      state.current = { startX: t.clientX, startY: t.clientY, active: false, pull: 0 };
    };
    const onMove = (e: TouchEvent) => {
      const s = state.current;
      if (!s) return;
      const t = e.touches[0]!;
      const dy = t.clientY - s.startY;
      const dx = Math.abs(t.clientX - s.startX);
      if (!s.active) {
        // Nur senkrecht nach unten von ganz oben; seitliches Wischen und Scrollen bleiben unberührt
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
      <span class="sr-only">{busy ? "Wird aktualisiert" : ready ? "Loslassen zum Aktualisieren" : "Zum Aktualisieren ziehen"}</span>
    </div>
  );
}
