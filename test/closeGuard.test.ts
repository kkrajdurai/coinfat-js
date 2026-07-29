/** Which states are worth interrupting a close for. */

import {describe, expect, it} from "vitest";
import type {CheckoutState} from "../src/core/checkout.js";
import {closeConfirmReason} from "../src/ui/closeGuard.js";
import {invoice, payment} from "./helpers.js";

const state = (over: Partial<CheckoutState> = {}): CheckoutState => ({
  invoice: null,
  wallets: null,
  walletsError: null,
  isLoading: false,
  notFound: false,
  error: null,
  isTerminal: false,
  mutating: false,
  ...over
});

describe("closeConfirmReason", () => {
  it("stays quiet while there is nothing to lose", () => {
    expect(closeConfirmReason(state())).toBeNull();
    expect(closeConfirmReason(state({invoice: invoice()}))).toBeNull();
  });

  it("stays quiet on a terminal invoice, which keeps its active_payment", () => {
    // Warning on the success screen would be the worst place to nag.
    expect(
      closeConfirmReason(
        state({
          invoice: invoice({
            status: "completed",
            active_payment: payment("p1", "btc-net-1")
          }),
          isTerminal: true
        })
      )
    ).toBeNull();
  });

  it("stays quiet when the provider never issued an address", () => {
    // A null address is an error state, not a coin awaiting payment — nothing was
    // handed to the payer, so there is nothing for them to lose.
    expect(
      closeConfirmReason(
        state({
          invoice: invoice({
            active_payment: {...payment("p1", "btc-net-1"), address: null}
          })
        })
      )
    ).toBeNull();
  });

  it("warns once an address is issued, and harder once funds are moving", () => {
    const issued = payment("p1", "btc-net-1");

    expect(
      closeConfirmReason(state({invoice: invoice({active_payment: issued})}))
    ).toBe("awaiting");

    expect(
      closeConfirmReason(
        state({
          invoice: invoice({
            active_payment: {...issued, detected_at: "2026-07-29T10:00:00Z"}
          })
        })
      )
    ).toBe("detected");
  });
});
