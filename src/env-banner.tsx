// Always visible on staging: copies of real data live here, so nobody
// confuses the test system with the real app.
import { Trans } from "@lingui/react/macro";
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
      <Trans>Staging · test system with copied data</Trans>
    </div>
  );
}
