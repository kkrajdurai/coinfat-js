/**
 * Payment-notice logic for the pay panel, free of Preact so it unit-tests directly.
 * The notice copy lives in ui/strings — this decides only which notice and with what
 * numbers.
 *
 * Every amount is quoted by the backend and rendered VERBATIM: `JsonSerialize::coin()`
 * has already rounded to the wallet's precision and stripped trailing zeros, so
 * re-deriving anything through `Number` could only return the same string, or a worse
 * one. `remaining` used to be the exception — the client subtracted `received` from
 * `expected` itself — but the backend now quotes it (`payment.remaining_value`,
 * floored at zero within the tolerance band), so the only arithmetic left is the
 * `progress` percentage, which is display-only.
 */

import type {StoreInvoicePayment} from "../core/types.js";

export interface PaymentAmounts {
  symbol: string;
  /** Already rounded and trimmed by the backend — render as-is. */
  expected: string;
  received: string;
  overpaid: string;
  /**
   * Still owed, quoted by the backend (`payment.remaining_value`). Never negative —
   * an overpayment is reported separately.
   */
  remaining: string;
  /** True while the payer still owes something, for branching. */
  owes: boolean;
  /** Whether anything has arrived at all. */
  started: boolean;
  /** How much of the expected amount has arrived, 0-100. */
  progress: number;
}

export function paymentAmounts(payment: StoreInvoicePayment): PaymentAmounts {
  const expected = Number(payment.expected_value.amount);
  const received = Number(payment.received_value.amount);
  const remaining = payment.remaining_value.amount;

  return {
    symbol: payment.wallet.symbol.toUpperCase(),
    expected: payment.expected_value.amount,
    received: payment.received_value.amount,
    overpaid: payment.overpaid_value.amount,
    remaining,
    owes: Number(remaining) > 0,
    started: received > 0,
    progress: expected > 0 ? Math.min(100, (received / expected) * 100) : 0
  };
}

export type NoticeTone = "success" | "warning" | "info";

/**
 * Which notice to show, plus the numbers it needs — but not the words. The copy is
 * resolved from a string table by `noticeMessage` (ui/strings), so the logic here
 * stays locale-agnostic and unit-testable. `tone` drives styling.
 */
export type PaymentNotice =
  | {kind: "overpaid"; tone: "success"; extra: string; symbol: string}
  | {kind: "underpaid"; tone: "warning"; remaining: string; symbol: string}
  | {kind: "detected"; tone: "info"};

/**
 * The one thing worth telling the payer about their transfer, or null while nothing
 * has happened. Ordered by what needs acting on: an overpayment is settled, a
 * shortfall needs more funds, a detected payment just needs patience.
 */
export function paymentNotice(
  payment: StoreInvoicePayment
): PaymentNotice | null {
  const {symbol, remaining, overpaid, owes} = paymentAmounts(payment);

  if (payment.overpaid && Number(overpaid) > 0) {
    return {kind: "overpaid", tone: "success", extra: overpaid, symbol};
  }

  if (payment.status === "underpaid" && owes) {
    return {kind: "underpaid", tone: "warning", remaining, symbol};
  }

  if (payment.detected_at) {
    return {kind: "detected", tone: "info"};
  }

  return null;
}

/** Milliseconds as "m:ss", clamped at zero so an elapsed lock never counts up. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** Milliseconds until `iso`, or 0 once it has passed (or if it cannot be parsed). */
export function remainingUntil(iso: string, now = Date.now()): number {
  const target = new Date(iso).getTime();
  return Number.isFinite(target) ? Math.max(0, target - now) : 0;
}
