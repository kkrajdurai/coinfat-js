import type {CheckoutState} from "../core/checkout.js";

/** Which warning the payer sees. `detected` is the one with funds in flight. */
export type CloseConfirmReason = "detected" | "awaiting";

/**
 * Whether closing is worth interrupting, and with which copy.
 *
 * Only two states have anything to lose. A terminal invoice is *finished* — closing is
 * the intended action there and Terminal already offers its own — and before a coin is
 * picked there is no address to lose. Confirming on either would nag, worst of all on
 * the success screen.
 *
 * What is at stake is never the money: the invoice outlives the widget and the backend
 * keeps crediting it, so closing costs the payer visibility, not funds. The copy says
 * so, and must keep saying so.
 */
export function closeConfirmReason(
  state: CheckoutState
): CloseConfirmReason | null {
  const payment = state.invoice?.active_payment;

  if (state.isTerminal || !payment) {
    return null;
  }

  if (payment.detected_at) {
    return "detected";
  }

  // A null address is the provider-has-no-address error, not a coin awaiting payment —
  // nothing was ever issued, so there is nothing to lose by closing.
  return payment.address ? "awaiting" : null;
}
