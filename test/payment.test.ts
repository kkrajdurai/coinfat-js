/** The pay panel's amount arithmetic and notice choice, without a renderer. */

import {describe, expect, it} from "vitest";
import type {StoreInvoicePayment} from "../src/core/types.js";
import {
  formatDuration,
  paymentAmounts,
  paymentNotice,
  remainingUntil
} from "../src/ui/payment.js";

const coin = (amount: string) => ({amount, wallet: "btc", symbol: "BTC"});

function payment(over: Partial<StoreInvoicePayment> = {}): StoreInvoicePayment {
  return {
    ulid: "pay_1",
    status: "pending",
    wallet: {symbol: "btc", scale: 8, precision: 8},
    wallet_network: {id: "btc-net-1", name: "Bitcoin"},
    address: "bc1qexample",
    expected_value: coin("0.5"),
    received_value: coin("0"),
    overpaid: false,
    overpaid_value: coin("0"),
    remaining_value: coin("0.5"),
    detected_at: null,
    rate_expires_at: "2026-07-23T12:00:00Z",
    ...over
  } as unknown as StoreInvoicePayment;
}

describe("paymentAmounts", () => {
  it("renders the backend's remaining verbatim, owing when it is positive", () => {
    const amounts = paymentAmounts(
      payment({received_value: coin("0.3"), remaining_value: coin("0.2")})
    );

    expect(amounts.remaining).toBe("0.2");
    expect(amounts.owes).toBe(true);
  });

  it("owes nothing once the backend floors remaining to zero", () => {
    // Settled within the tolerance band, or overpaid — the backend quotes zero and
    // the panel does not tell the payer to send more.
    const amounts = paymentAmounts(
      payment({received_value: coin("0.7"), remaining_value: coin("0")})
    );

    expect(amounts.remaining).toBe("0");
    expect(amounts.owes).toBe(false);
    expect(amounts.progress).toBe(100);
  });

  it("passes the backend's own strings straight through", () => {
    const amounts = paymentAmounts(
      payment({expected_value: coin("0.00105949"), received_value: coin("0")})
    );

    expect(amounts.expected).toBe("0.00105949");
    expect(amounts.received).toBe("0");
  });

  it("reports progress against the expected amount", () => {
    const amounts = paymentAmounts(
      payment({expected_value: coin("0.5"), received_value: coin("0.25")})
    );

    expect(amounts.progress).toBe(50);
    expect(amounts.started).toBe(true);
    expect(amounts.symbol).toBe("BTC");
  });

  it("does not divide by zero on a zero-value invoice", () => {
    const amounts = paymentAmounts(payment({expected_value: coin("0")}));

    expect(amounts.progress).toBe(0);
  });
});

describe("paymentNotice", () => {
  it("says nothing while no transfer has arrived", () => {
    expect(paymentNotice(payment())).toBeNull();
  });

  it("names the shortfall on an underpayment", () => {
    const notice = paymentNotice(
      payment({
        status: "underpaid",
        received_value: coin("0.2"),
        remaining_value: coin("0.3"),
        detected_at: "2026-07-23T11:00:00Z"
      })
    );

    // The descriptor carries the number: "partial payment" alone leaves the payer
    // doing fee-adjusted arithmetic.
    expect(notice).toEqual({
      kind: "underpaid",
      tone: "warning",
      remaining: "0.3",
      symbol: "BTC"
    });
  });

  it("reports an overpayment as settled, not as a problem", () => {
    const notice = paymentNotice(
      payment({
        received_value: coin("0.7"),
        overpaid: true,
        overpaid_value: coin("0.2"),
        detected_at: "2026-07-23T11:00:00Z"
      })
    );

    expect(notice).toMatchObject({
      kind: "overpaid",
      tone: "success",
      extra: "0.2",
      symbol: "BTC"
    });
  });

  it("prefers the overpayment message over the confirming one", () => {
    // Both conditions hold at once; the payer cares that they are done.
    const notice = paymentNotice(
      payment({
        status: "underpaid",
        received_value: coin("0.7"),
        overpaid: true,
        overpaid_value: coin("0.2"),
        detected_at: "2026-07-23T11:00:00Z"
      })
    );

    expect(notice?.tone).toBe("success");
  });

  it("falls back to confirming once something is detected", () => {
    const notice = paymentNotice(
      payment({
        received_value: coin("0.5"),
        detected_at: "2026-07-23T11:00:00Z"
      })
    );

    expect(notice).toEqual({kind: "detected", tone: "info"});
  });
});

describe("countdown", () => {
  it("formats as m:ss with a padded seconds field", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(9_000)).toBe("0:09");
    expect(formatDuration(65_000)).toBe("1:05");
    expect(formatDuration(600_000)).toBe("10:00");
  });

  it("clamps at zero so an elapsed lock never counts upward", () => {
    expect(formatDuration(-5_000)).toBe("0:00");
    expect(
      remainingUntil("2026-07-23T12:00:00Z", Date.parse("2026-07-23T12:05:00Z"))
    ).toBe(0);
  });

  it("measures the gap to the target", () => {
    expect(
      remainingUntil("2026-07-23T12:00:00Z", Date.parse("2026-07-23T11:58:30Z"))
    ).toBe(90_000);
  });

  it("treats an unparseable deadline as already elapsed", () => {
    // Better to requote immediately than to render "NaN:NaN" forever.
    expect(remainingUntil("not a date")).toBe(0);
  });
});
