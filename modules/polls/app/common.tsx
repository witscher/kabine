// Texts and helpers used by several screens of the polls module.
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { intlTag } from "../../../shared/dates";
import { refreshBadge } from "../../../src/badge";
import { longDate, shortDate, time } from "../../../src/format";
import { currentLocale } from "../../../src/i18n";
import { invalidate } from "../../../src/store";
import { Button, Sheet } from "../../../src/ui";
import type { PollKind, PollOption } from "../types";

export const kindLabel = (kind: PollKind): string => (kind === "choice" ? t`Poll` : kind === "schedule" ? t`Find a date` : t`Order`);

/** Status of a vote that is still missing. */
export const openLabel = () => t({ message: "Open", context: "poll status" });

export function endsText(endsAt: string, open: boolean): string {
  const date = shortDate(endsAt);
  const at = time(endsAt);
  return open ? t`runs until ${date}, ${at}` : t`ended ${date}, ${at}`;
}

export function teamText(teamName: string | null): string {
  return teamName ?? t`Whole club`;
}

const money = new Map<string, Intl.NumberFormat>();
/** Amount in the club's currency for orders, in the app's language. */
export function formatMoney(cents: number, currency: string): string {
  const key = `${currentLocale()}|${currency}`;
  let f = money.get(key);
  if (!f) money.set(key, (f = new Intl.NumberFormat(intlTag(currentLocale()), { style: "currency", currency })));
  return f.format(cents / 100);
}

/** A date of a scheduling poll: "Saturday 20 Jun" or "Saturday 20 Jun, 15:00". */
export function slotLabel(o: PollOption): string {
  const s = o.startsAt ?? "";
  return s.length > 10 ? `${longDate(s)}, ${time(s)}` : longDate(`${s}T00:00`);
}

export function optionLabel(o: PollOption): string {
  return o.startsAt ? slotLabel(o) : o.label;
}

/** After a vote or change: lists, the card on the start page and the number on the app icon. */
export function pollsChanged() {
  invalidate("/polls");
  refreshBadge();
}

/** One-time hints per device (localStorage may be blocked: then the hint comes again). */
export function hintSeen(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

export function rememberHint(key: string) {
  try {
    localStorage.setItem(key, "1");
  } catch {
    // private mode: the hint shows again next time
  }
}

export const ORDER_HINT = "kabine-polls-hint-order";
export const IGNORE_HINT = "kabine-polls-hint-ignore";

/** A hint with one button (no cancel), e.g. where to find an order once its card is gone. */
export function useInfoSheet(): [(info: { title: string; message: string }) => void, ComponentChildren] {
  const [info, setInfo] = useState<{ title: string; message: string } | null>(null);
  const sheet = (
    <Sheet open={!!info} onClose={() => setInfo(null)} title={info?.title ?? ""}>
      <div class="stack">
        <p class="muted">{info?.message}</p>
        <Button variant="primary" onClick={() => setInfo(null)}>
          <Trans>Got it</Trans>
        </Button>
      </div>
    </Sheet>
  );
  return [setInfo, sheet];
}
