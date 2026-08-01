/**
 * Payment-notice logic for the pay panel, free of Preact so it unit-tests directly.
 * The copy lives in ui/strings — this decides only which notice, and with what numbers.
 *
 * Every amount is quoted by the backend and rendered VERBATIM: it is already rounded to
 * the wallet's precision with trailing zeros stripped, so re-deriving through `Number`
 * could only return the same string or a worse one. `remaining` included — the backend
 * quotes it. The only arithmetic left is `progress`, which is display-only.
 */

import type {StoreInvoicePayment, WalletNetwork} from "../core/types.js";

/**
 * The chain a network settles on, named the way a payer would recognise it.
 *
 * `wallet_network.name` is not that name on a token network. The backend names those
 * after the pair — "USDT (Tron)", "USDC (Polygon)" — so interpolating it verbatim
 * yields "Send only USDT on USDT (Tron)". The chain's own coin carries the plain name
 * ("Tron", "Polygon"), and it is the same `execution_fee_wallet` the network takes its
 * icon from. On a native network there is no fee coin and the network name is already
 * the chain, so it falls through.
 */
export function chainName(network: WalletNetwork): string {
  return network.execution_fee_wallet?.name || network.name;
}

export interface PaymentAmounts {
  symbol: string;
  /** Already rounded and trimmed by the backend — render as-is. */
  expected: string;
  received: string;
  overpaid: string;
  /** Still owed. Never negative — an overpayment is reported separately. */
  remaining: string;
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
 * Which notice to show and the numbers it needs — but not the words, which
 * `noticeMessage` resolves from a string table. `tone` drives styling.
 */
export type PaymentNotice =
  | {kind: "overpaid"; tone: "success"; extra: string; symbol: string}
  | {kind: "underpaid"; tone: "warning"; remaining: string; symbol: string}
  | {kind: "detected"; tone: "info"};

/**
 * The one thing worth telling the payer, or null while nothing has happened. Ordered by
 * what needs acting on: an overpayment is settled, a shortfall needs more funds, a
 * detected payment just needs patience.
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

export interface AddressParts {
  /** Emphasised opening characters. */
  head: string;
  /** Unremarkable middle, first half — trimmed from its END as space runs out. */
  lead: string;
  /** Unremarkable middle, second half — trimmed from its START. */
  trail: string;
  /** Emphasised closing characters. */
  tail: string;
}

/**
 * Split a deposit address into the two ends a payer actually checks and the middle
 * they don't. Nobody reads sixty base32 characters; they compare the first few and
 * the last few against their wallet, so those are the parts worth weighting.
 *
 * The anchor grows a little with the address — 4 characters is proportionate on a
 * 34-character Tron address and lost on a 62-character bech32 one — but stays inside
 * a narrow range, because a shape the payer recognises across coins is worth more
 * than exact proportionality.
 *
 * The middle comes back in two halves so the ellipsis can sit at the CENTRE of the
 * field: each half gives up characters at the same rate, rather than the opening
 * running as far as it fits and the cut landing hard against the closing characters.
 *
 * How much of each half survives is deliberately NOT decided here: it depends on the
 * width the card happens to have, which is a question only CSS can answer.
 */
export function addressParts(address: string): AddressParts {
  const anchor = address.length >= 48 ? 8 : address.length >= 32 ? 6 : 4;

  // Too short to be worth carving up: emphasis over most of the string is just bold
  // text, and there is nothing in the middle to lose.
  if (address.length < anchor * 3) {
    return {head: address, lead: "", trail: "", tail: ""};
  }

  const body = address.slice(anchor, -anchor);
  // One character PAST half, so the opening piece is always strictly the longer of the
  // two. Only that piece carries an ellipsis; the closing one clips, which is safe only
  // while it cannot run out of room first. Split evenly the two are the same width, and
  // which one overflows comes down to a sub-pixel rounding difference — observed in
  // Firefox, where the closing piece clipped a sliver on its own at one width in the
  // sweep. A character off-centre is invisible; a character disappearing is not.
  const half = Math.floor(body.length / 2) + 1;

  return {
    head: address.slice(0, anchor),
    lead: body.slice(0, half),
    trail: body.slice(half),
    tail: address.slice(-anchor)
  };
}
