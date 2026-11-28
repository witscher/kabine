// Hint at the top of the administration when kabine.dev has a newer release (Me.update, worker/domain/releases.ts).
// Closed per version on this device; a security release cannot be closed.
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useState } from "preact/hooks";
import type { AvailableUpdate } from "../shared/releases";
import { Icon } from "./icons";
import { Notice } from "./ui";

const CLOSED = "kabine-hint-update";

function closedVersion(): string | null {
  try {
    return localStorage.getItem(CLOSED);
  } catch {
    return null;
  }
}

export function UpdateHint({ update }: { update: AvailableUpdate | null }) {
  const [closed, setClosed] = useState(closedVersion);
  if (!update || (!update.security && closed === update.version)) return null;
  const version = update.version;
  const close = () => {
    try {
      localStorage.setItem(CLOSED, version);
    } catch {
      // Private mode: the hint comes back next time
    }
    setClosed(version);
  };
  return (
    <div role={update.security ? "alert" : "status"}>
      <Notice kind={update.security ? "warn" : "yellow"} icon={update.security ? "alert" : "refresh"}>
        <div class="row-gap" style={{ alignItems: "flex-start" }}>
          <span class="main">
            {update.security ? (
              <Trans>
                <strong>Security update: Kabine {version}.</strong> It fixes a security problem; please install it soon.
              </Trans>
            ) : (
              <Trans>
                <strong>Kabine {version} is available.</strong> Install it when it suits the club.
              </Trans>
            )}{" "}
            <a href="/verwaltung/updates">
              <Trans>Show update</Trans>
            </a>
          </span>
          {update.security ? null : (
            <button type="button" class="icon-btn" aria-label={t`Hide hint`} onClick={close} style={{ margin: "-6px -6px 0 0" }}>
              <Icon name="x" size={18} />
            </button>
          )}
        </div>
      </Notice>
    </div>
  );
}
