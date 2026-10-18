// Auf Staging immer sichtbar: Hier liegen Kopien echter Daten, damit niemand
// das Testsystem mit der richtigen App verwechselt.
import { useEffect, useState } from "preact/hooks";

export function EnvBanner() {
  const [env, setEnv] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/health", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { env?: string } | null) => setEnv(d?.env ?? null))
      .catch(() => undefined);
  }, []);
  if (env !== "staging") return null;
  return (
    <div class="env-banner" role="note">
      Staging · Testsystem mit kopierten Daten
    </div>
  );
}
