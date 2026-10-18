// Admin export with a privacy notice before downloading (administration, season change).
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { confirmDialog } from "./ui";

export const EXPORT_URL = "/api/admin/export";

/** Shows the notice on handling the data and downloads only after confirmation. */
export async function downloadExport(): Promise<boolean> {
  const ok = await confirmDialog({
    title: t`Notice`,
    message: (
      // Text from the club (10.10.2026)
      <p style={{ textAlign: "left" }}>
        <Trans>
          The file contains personal data of people, including minors. It is only for the club's data backup and must not be passed on. Delete it from your
          computer after 30 days at the latest. The club's backup belongs encrypted in the storage intended for it. If a storage location, for example your
          computer, has become accessible to unauthorised persons through a virus or similar, inform the board immediately.
        </Trans>
      </p>
    ),
    confirmLabel: t`Understood, download`,
  });
  if (!ok) return false;
  const a = document.createElement("a");
  a.href = EXPORT_URL;
  // Not empty: the router intercepts links without a download value. The server sets the file name with the date.
  a.download = "kabine-export.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  return true;
}
