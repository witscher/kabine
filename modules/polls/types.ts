// API shapes of the polls module and the payment rules, shared by worker (worker/domain.ts) and app (app/*.tsx).

export type PollKind = "choice" | "schedule" | "order";

export interface PollOption {
  id: number;
  /** Choice: the answer; order: the item; scheduling: empty. */
  label: string;
  /** Scheduling: 'YYYY-MM-DD' or 'YYYY-MM-DDTHH:MM'. */
  startsAt: string | null;
  /** Orders: price in cents. */
  priceCents: number | null;
  /** Orders: sizes (empty: no sizes). */
  sizes: string[];
  /** Orders: product photo, else null. */
  imageUrl: string | null;
}

export interface PollSummary {
  id: number;
  kind: PollKind;
  title: string;
  teamId: number | null;
  teamName: string | null;
  endsAt: string;
  open: boolean;
  /** Own units (you, your children, your family) that have not voted yet. */
  openUnits: number;
  /** Order ignored: no card on the start page, no reminder; still counts as not ordered. */
  ignored: boolean;
  /** Managers only (orders); 0 for others. */
  voted: number;
  total: number;
  canManage: boolean;
}

export interface PollAnswer {
  optionId: number;
  size: string;
  /** Choice 1; scheduling 2 yes, 1 maybe, 0 no; orders the quantity. */
  value: number;
}

/** A unit the account votes for: the person, a child or the family. */
export interface PollUnit {
  unitId: number;
  /** "self": just you; "family": your family (one vote per family); "other": a child, named in `name`. */
  who: "self" | "family" | "other";
  /** Name of the unit for "other" (first name and initial). */
  name: string;
  /** null: not voted yet. */
  answers: PollAnswer[] | null;
  /** One vote per family: who changed it last, if not you. */
  votedBy: string | null;
  updatedAt: string | null;
  /** Orders: order number and bank reference (title and number, no names). */
  orderNo: number | null;
  reference: string | null;
  /** Orders: note for PayPal with the order number and the full names of the players (own family only). */
  paypalNote: string | null;
  /** Orders: amount, confirmed and reported (payments.ts); null for other kinds or before ordering. */
  payment: PaymentAmounts | null;
}

/** How orders are paid, for the whole club (Administration → Polls). Everything optional. */
export interface PollPayment {
  /** paypal.me name */
  paypal: string | null;
  holder: string | null;
  iban: string | null;
  /** ISO 4217 code of prices and payments, "EUR" by default. */
  currency: string;
}

/** Result line: choice and scheduling per option and answer, orders per item and size. */
export interface PollTally {
  optionId: number;
  size: string;
  value: number;
  units: number;
  quantity: number;
  names?: string[];
}

export interface PollOrder {
  unitId: number;
  orderNo: number | null;
  label: string;
  items: { optionId: number; size: string; quantity: number }[];
  totalCents: number;
  /** Fully confirmed as paid. */
  paid: boolean;
  paidCents: number;
  reportedCents: number;
}

export interface PollInfo {
  id: number;
  kind: PollKind;
  title: string;
  description: string | null;
  teamId: number | null;
  teamName: string | null;
  multiple: boolean;
  anonymous: boolean;
  results: "always" | "after";
  perFamily: boolean;
  whoPlayers: boolean;
  whoParents: boolean;
  whoCoaches: boolean;
  endsAt: string;
  open: boolean;
  createdBy: string | null;
  createdAt: string;
  /** Orders: payment details; null for other kinds. */
  payment: PollPayment | null;
  /** Currency of prices (orders). */
  currency: string;
}

export interface PollDetail {
  poll: PollInfo;
  options: PollOption[];
  canManage: boolean;
  /** Creator and admins: edit everything, mark orders as paid, product photos. */
  canEdit: boolean;
  myUnits: PollUnit[];
  /** Units that voted / all units; 0 for participants of orders. */
  voted: number;
  total: number;
  resultsVisible: boolean;
  tallies: PollTally[] | null;
  /** Managers, not anonymous: who has not voted yet. */
  pending: string[] | null;
  /** Managers, orders: the orders per unit. */
  orders: PollOrder[] | null;
}

/** For the poll form: the team's kind and whether it has parents. */
export interface PollTeamInfo {
  name: string;
  kind: "team" | "group";
  parentsEnabled: boolean;
}

// Payments ------------------------------------------------------------------------------------------
// The app cannot know whether someone paid (paypal.me has no callback): the family reports "I have paid", the creator
// (admins as fallback) confirms. A confirmed or reported amount is the order's total at that moment, so after a top-up
// order the rest stays open.

export interface PaymentAmounts {
  totalCents: number;
  /** Confirmed as paid (0: nothing). */
  paidCents: number;
  /** Reported as paid by the family (0: nothing). */
  reportedCents: number;
}

export interface PaymentState extends PaymentAmounts {
  /** Still to pay (after confirmation or report). */
  dueCents: number;
  /** More confirmed than ordered. */
  overCents: number;
  /** Reported, not yet confirmed. */
  awaiting: boolean;
  /** Fully confirmed. */
  settled: boolean;
}

export function paymentState(a: PaymentAmounts): PaymentState {
  const covered = Math.max(a.paidCents, a.reportedCents);
  return {
    ...a,
    dueCents: Math.max(0, a.totalCents - covered),
    overCents: Math.max(0, a.paidCents - a.totalCents),
    awaiting: a.reportedCents > a.paidCents,
    settled: a.paidCents > 0 && a.paidCents >= a.totalCents,
  };
}

/**
 * Bank reference of an order: title and order number, no names (at most 140 characters, SEPA). `no`: the word for the
 * number in the request's language ("No.", "Nr."); "#" is not in the SEPA character set.
 */
export function paymentReference(title: string, orderNo: number, no: string): string {
  const suffix = ` ${no} ${orderNo}`;
  return `${title.slice(0, 140 - suffix.length).trim()}${suffix}`;
}

/** EPC QR code ("GiroCode", version 002, UTF-8) for a SEPA transfer in euros: recipient, IBAN, amount, reference. */
export function epcPayload(holder: string, iban: string, cents: number, reference: string): string {
  return ["BCD", "002", "1", "SCT", "", holder.slice(0, 70), iban, `EUR${(cents / 100).toFixed(2)}`, "", "", reference.slice(0, 140)].join("\n");
}

/** paypal.me name from "name", "paypal.me/name" or "https://www.paypal.com/paypalme/name"; null: none; undefined: not a paypal.me name. */
export function paypalName(input: string | null | undefined): string | null | undefined {
  const s = (input ?? "").trim();
  if (!s) return null;
  const m = /^(?:https?:\/\/)?(?:www\.)?(?:paypal\.me\/|paypal\.com\/paypalme\/)?([A-Za-z0-9]{1,20})\/?$/i.exec(s);
  return m ? m[1]! : undefined;
}

/** IBAN without spaces in capitals if its check digits are right; null: empty; undefined: not a valid IBAN. */
export function normalizeIban(input: string | null | undefined): string | null | undefined {
  const s = (input ?? "").replace(/\s+/g, "").toUpperCase();
  if (!s) return null;
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s)) return undefined;
  const digits = (s.slice(4) + s.slice(0, 4)).replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let rest = 0;
  for (const d of digits) rest = (rest * 10 + Number(d)) % 97;
  return rest === 1 ? s : undefined;
}

/** Currencies offered in the settings (ISO 4217); GiroCode only for EUR. */
export const CURRENCIES = ["EUR", "CHF", "GBP", "USD", "DKK", "SEK", "NOK", "PLN", "CZK"] as const;
