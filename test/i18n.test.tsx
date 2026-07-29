/**
 * The context wiring, not the copy: a root `strings` override reaches the leaves, and
 * with no provider they fall back to English.
 */

import {render, type ComponentChild} from "preact";
import {afterEach, describe, expect, it} from "vitest";
import {CheckoutController} from "../src/core/checkout.js";
import type {StoreInvoicePayment} from "../src/core/types.js";
import {PayPanel} from "../src/ui/PayPanel.js";
import {I18nProvider} from "../src/ui/strings/context.js";
import {resolveStrings} from "../src/ui/strings/index.js";
import {fakeApi} from "./helpers.js";

const coin = (amount: string) => ({amount, wallet: "btc", symbol: "BTC"});

function payment(over: Partial<StoreInvoicePayment> = {}): StoreInvoicePayment {
  return {
    ulid: "pay_1",
    status: "pending",
    wallet: {symbol: "btc", scale: 8, precision: 8},
    wallet_network: {id: "btc-net-1", name: "Bitcoin"},
    address: "bc1qexampleaddress",
    deposit_uri: "bitcoin:bc1qexampleaddress?amount=0.5",
    qr_code_url: "https://cdn.test/qr.png",
    expected_value: coin("0.5"),
    received_value: coin("0"),
    overpaid: false,
    overpaid_value: coin("0"),
    remaining_value: coin("0.5"),
    detected_at: null,
    rate_expires_at: new Date(Date.now() + 600_000).toISOString(),
    ...over
  } as unknown as StoreInvoicePayment;
}

let host: HTMLDivElement | null = null;

function mount(node: ComponentChild): HTMLDivElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  render(node, host);
  return host;
}

function panel(node: StoreInvoicePayment) {
  const controller = new CheckoutController("inv_1", fakeApi({}), {
    pollMs: 999_999
  });
  return (
    <PayPanel
      payment={node}
      amount={{amount: "42.50", currency: "USD", scale: 2} as never}
      controller={controller}
      mutating={false}
      layout="narrow"
    />
  );
}

afterEach(() => {
  // Unmount rather than detach: RateLock holds a 1s interval.
  if (host) {
    render(null, host);
    host.remove();
    host = null;
  }
});

describe("i18n threading", () => {
  it("renders a merchant override in a leaf component", () => {
    const i18n = resolveStrings(undefined, {
      sendExactly: "Envoyer exactement",
      listening: "En attente de votre paiement…"
    });

    const el = mount(
      <I18nProvider value={i18n}>{panel(payment())}</I18nProvider>
    );

    expect(el.textContent).toContain("Envoyer exactement");
    expect(el.textContent).toContain("En attente de votre paiement");
    // The override must replace the default, not sit beside it.
    expect(el.textContent).not.toContain("Send exactly");
  });

  it("falls back to English when no provider wraps the tree", () => {
    const el = mount(panel(payment()));

    expect(el.textContent).toContain("Send exactly");
    expect(el.textContent).toContain("Listening for your payment");
  });

  it("resolves an overridden interpolation with its arguments", () => {
    const i18n = resolveStrings(undefined, {
      noticeUnderpaid: (amount, symbol) => `Envoyez ${amount} ${symbol} de plus`
    });

    const el = mount(
      <I18nProvider value={i18n}>
        {panel(
          payment({
            status: "underpaid",
            received_value: coin("0.2"),
            remaining_value: coin("0.3"),
            detected_at: "2026-07-23T11:00:00Z"
          })
        )}
      </I18nProvider>
    );

    expect(el.textContent).toContain("Envoyez 0.3 BTC de plus");
  });
});
