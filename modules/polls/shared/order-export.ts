// Quantities of an order and its export as an Excel file, for the creator, coaches and admins (modules/polls/README.md).
// Built in the browser from the poll view managers already get (PollDetail.orders), nothing goes to a server or a
// third party. Three sheets: quantities per item and size (to order from the supplier), orders per unit with the
// payment state, and one line per item (for filtering).
import { t } from "@lingui/core/macro";
import type { PollDetail, PollOption } from "../types";
import type { XlsxCell, XlsxSheet } from "./xlsx";

export interface QuantityLine {
  option: PollOption;
  /** "" for items without sizes. */
  size: string;
  quantity: number;
}

/** Quantities per item and size, only what was ordered, in the order of the items and their sizes. */
export function orderQuantities(detail: Pick<PollDetail, "options" | "orders">): QuantityLine[] {
  const qty = new Map<string, number>();
  for (const o of detail.orders ?? []) for (const i of o.items) qty.set(`${i.optionId}|${i.size}`, (qty.get(`${i.optionId}|${i.size}`) ?? 0) + i.quantity);
  return detail.options.flatMap((option) =>
    (option.sizes.length ? option.sizes : [""]).map((size) => ({ option, size, quantity: qty.get(`${option.id}|${size}`) ?? 0 })).filter((l) => l.quantity > 0),
  );
}

/** Excel number format for amounts in the poll's currency, e.g. `#,##0.00 "€"`. */
export function moneyFormat(currency: string, locale: string): string {
  let symbol = currency;
  try {
    symbol = new Intl.NumberFormat(locale, { style: "currency", currency }).formatToParts(0).find((p) => p.type === "currency")?.value ?? currency;
  } catch {
    // Unknown currency code: show the code
  }
  return `#,##0.00 "${symbol.replace(/"/g, "")}"`;
}

const cents = (value: number): XlsxCell => ({ cents: value });

export function orderSheets(detail: Pick<PollDetail, "options" | "orders">): XlsxSheet[] {
  // "Order nothing" only fills the list: leave those units out
  const orders = (detail.orders ?? []).filter((o) => o.items.length);
  const byId = new Map(detail.options.map((o) => [o.id, o]));
  const itemName = (id: number) => byId.get(id)?.label ?? "?";
  const price = (id: number) => byId.get(id)?.priceCents ?? 0;
  const lines = orderQuantities(detail);
  const total = lines.reduce((s, l) => s + l.quantity * (l.option.priceCents ?? 0), 0);
  const no = t({ message: "No.", comment: "Order number in a bank reference, e.g. 'Club kit No. 17'" });
  return [
    {
      name: t({ message: "Quantities", comment: "Sheet of the order export: quantities per item and size" }),
      widths: [28, 12, 10, 14, 14],
      rows: [
        [t`Item`, t`Size`, t`Quantity`, t`Unit price`, t`Amount`],
        ...lines.map((l) => [l.option.label, l.size, l.quantity, cents(l.option.priceCents ?? 0), cents(l.quantity * (l.option.priceCents ?? 0))]),
        [t`Total`, "", lines.reduce((s, l) => s + l.quantity, 0), null, cents(total)],
      ],
    },
    {
      name: t({ message: "Orders", comment: "Sheet of the order export: one row per person or family" }),
      widths: [8, 40, 50, 12, 12, 12, 12],
      rows: [
        [no, t`Name`, t`Ordered`, t`Amount`, t({ message: "Paid", context: "amount" }), t({ message: "Reported", context: "amount" }), t({ message: "Open", context: "amount" })],
        ...orders.map((o) => [
          o.orderNo,
          o.label,
          o.items.map((i) => `${i.quantity}× ${itemName(i.optionId)}${i.size ? ` ${i.size}` : ""}`).join(", "),
          cents(o.totalCents),
          cents(Math.min(o.paidCents, o.totalCents)),
          cents(o.reportedCents),
          cents(Math.max(0, o.totalCents - o.paidCents)),
        ]),
      ],
    },
    {
      name: t({ message: "Lines", comment: "Sheet of the order export: one row per item of an order, for filtering" }),
      widths: [8, 40, 28, 12, 10, 14, 14],
      rows: [
        [no, t`Name`, t`Item`, t`Size`, t`Quantity`, t`Unit price`, t`Amount`],
        ...orders.flatMap((o) => o.items.map((i) => [o.orderNo, o.label, itemName(i.optionId), i.size, i.quantity, cents(price(i.optionId)), cents(i.quantity * price(i.optionId))])),
      ],
    },
  ];
}

const SPELLED: Record<string, string> = { ä: "ae", ö: "oe", ü: "ue", Ä: "Ae", Ö: "Oe", Ü: "Ue", ß: "ss" };

/** Printable ASCII only: umlauts spelled out, accents dropped, characters file systems refuse replaced. */
function asciiName(s: string): string {
  return s
    .replace(/[äöüÄÖÜß]/g, (c) => SPELLED[c]!)
    .normalize("NFKD")
    .replace(/[^\x20-\x7e]/g, "")
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * "Order Club kit 2026-11-23.xlsx", ASCII only: Chromium drops a download name with other characters and saves the
 * file as "download".
 */
export function orderFilename(title: string, today: string): string {
  const prefix = asciiName(t`Order`) || "Order";
  return `${prefix} ${asciiName(title).slice(0, 60) || "Poll"} ${today}.xlsx`.replace(/\s+/g, " ");
}
