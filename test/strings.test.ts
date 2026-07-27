/**
 * Locale resolution: which table a `locale` picks, how a partial override layers on,
 * and how a notice descriptor turns into copy.
 */

import {describe, expect, it} from "vitest";
import type {PaymentNotice} from "../src/ui/payment.js";
import type {CheckoutStringsOverride} from "../src/ui/strings/index.js";
import {en, noticeMessage, resolveStrings} from "../src/ui/strings/index.js";

describe("resolveStrings", () => {
  it("defaults to English with no locale", () => {
    const {locale, strings} = resolveStrings();
    expect(strings).toBe(en);
    // Undefined, not "en": Intl then formats in the runtime default, unchanged.
    expect(locale).toBeUndefined();
  });

  it("falls back to English for an unbundled locale, but keeps the tag for Intl", () => {
    const {locale, strings} = resolveStrings("fr-FR");
    expect(strings.sendExactly).toBe(en.sendExactly);
    expect(locale).toBe("fr-FR");
  });

  it("matches a table by base language when the region is unknown", () => {
    // en-GB has no table of its own; the base `en` answers for it.
    expect(resolveStrings("en-GB").strings).toBe(en);
  });

  it("layers a partial override over the resolved table without dropping keys", () => {
    const {strings} = resolveStrings("en", {
      sendExactly: "Envoyer exactement"
    });

    expect(strings.sendExactly).toBe("Envoyer exactement");
    // Every unspecified key still resolves — a partial table never yields undefined.
    expect(strings.close).toBe(en.close);
    expect(strings.copyAmount("0.5 BTC")).toBe("Copy the amount, 0.5 BTC");
  });

  it("deep-merges a partial `status` override so omitted labels survive", () => {
    // The resolver deep-merges, so untranslated statuses keep their English rather
    // than going undefined.
    const {strings} = resolveStrings("en", {status: {pending: "En attente"}});

    expect(strings.status.pending).toBe("En attente");
    expect(strings.status.completed).toBe(en.status.completed);
    expect(strings.status.canceled).toBe(en.status.canceled);
  });

  it("lets an override supply its own interpolation", () => {
    const {strings} = resolveStrings(undefined, {
      noticeUnderpaid: (amount, symbol) => `Envoyez ${amount} ${symbol}`
    });

    expect(strings.noticeUnderpaid("0.3", "BTC")).toBe("Envoyez 0.3 BTC");
  });

  it("ignores an `undefined`-valued override instead of blanking the key", () => {
    // An untyped caller can pass {copyAmount: undefined}; a raw spread would blank it,
    // and the view then calls the now-undefined interpolation function.
    const override = {
      copyAmount: undefined,
      sendExactly: undefined
    } as CheckoutStringsOverride;
    const {strings} = resolveStrings("en", override);

    expect(strings.sendExactly).toBe(en.sendExactly);
    expect(strings.copyAmount("0.5 BTC")).toBe("Copy the amount, 0.5 BTC");
  });

  it("ignores an `undefined` inside the nested status table too", () => {
    // The same hazard one level down, where a blanked label renders an empty chip.
    const {strings} = resolveStrings("en", {
      status: {pending: undefined}
    } as CheckoutStringsOverride);

    expect(strings.status.pending).toBe(en.status.pending);
  });

  it("normalises a blank locale to undefined so Intl gets no empty tag", () => {
    // "" survives negotiation but makes Intl.NumberFormat("") throw, dropping the
    // currency symbol.
    expect(resolveStrings("   ").locale).toBeUndefined();
    expect(resolveStrings("").strings).toBe(en);
  });
});

describe("noticeMessage", () => {
  it("resolves each notice kind against the table", () => {
    const underpaid: PaymentNotice = {
      kind: "underpaid",
      tone: "warning",
      remaining: "0.3",
      symbol: "BTC"
    };
    const overpaid: PaymentNotice = {
      kind: "overpaid",
      tone: "success",
      extra: "0.2",
      symbol: "BTC"
    };

    expect(noticeMessage(underpaid, en)).toBe(
      "Partial payment received. Send 0.3 BTC more to complete."
    );
    expect(noticeMessage(overpaid, en)).toContain("0.2 BTC extra");
    expect(noticeMessage({kind: "detected", tone: "info"}, en)).toBe(
      en.noticeDetected
    );
  });
});
