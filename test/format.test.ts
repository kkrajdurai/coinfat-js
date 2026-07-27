/**
 * Display formatting. A locale is passed explicitly throughout, or the assertions would
 * depend on whoever is running the suite.
 */

import {describe, expect, it} from "vitest";
import type {Coin, Money} from "../src/core/types.js";
import {formatCoin, formatMoney} from "../src/ui/format.js";

const money = (over: Partial<Money> = {}): Money => ({
  amount: "1450",
  currency: "USD",
  scale: 2,
  ...over
});

describe("formatMoney", () => {
  it("renders with the scale the backend sent", () => {
    expect(formatMoney(money(), "en-US")).toBe("$1,450.00");
  });

  it("honours a zero-decimal currency", () => {
    // JPY has no minor unit: scale 0, and we must not invent two decimal places.
    expect(formatMoney(money({currency: "JPY", scale: 0}), "en-US")).toBe(
      "¥1,450"
    );
  });

  it("renders a well-formed but unrecognised currency code", () => {
    // Intl does not throw here — it prints the code itself, which must not be
    // mistaken for the error path below. The separator is U+00A0, escaped because a
    // non-breaking space is indistinguishable from a plain one in a diff.
    expect(formatMoney(money({amount: "12.5", currency: "XYZ"}), "en-US")).toBe(
      "XYZ\u00A012.50"
    );
  });

  it("falls back to amount + code when Intl rejects the input", () => {
    // A malformed code throws RangeError, and a third-party embed must never take the
    // merchant's page down over a display detail.
    expect(formatMoney(money({currency: "US"}), "en-US")).toBe("1450 US");
    expect(formatMoney(money({currency: ""}), "en-US")).toBe("1450 ");
  });

  it("falls back rather than throwing on an out-of-range scale", () => {
    // Intl caps fraction digits at 100; anything beyond is a RangeError.
    expect(formatMoney(money({scale: 101}), "en-US")).toBe("1450 USD");
  });
});

describe("formatCoin", () => {
  it("renders the amount against its symbol", () => {
    const coin: Coin = {amount: "0.00123", wallet: "btc", symbol: "BTC"};

    // No Intl: crypto amounts arrive exact, and re-formatting risks losing digits.
    expect(formatCoin(coin)).toBe("0.00123 BTC");
  });
});
