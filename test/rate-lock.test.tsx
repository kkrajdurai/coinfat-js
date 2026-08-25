/**
 * Rate-lock expiry, where the pay panel talks back to the controller. Short deadlines
 * against a real 1s tick, so these wait a beat.
 */

import {render} from "preact";
import {afterEach, describe, expect, it} from "vitest";
import {CheckoutController} from "../src/core/checkout.js";
import type {Checkout, StoreInvoicePayment} from "../src/core/types.js";
import {PayPanel} from "../src/ui/PayPanel.js";
import {fakeApi, invoice, sleep} from "./helpers.js";

const coin = (amount: string) => ({amount, wallet: "btc", symbol: "BTC"});

function payment(expiresInMs: number, lockedMsAgo = 0): StoreInvoicePayment {
  return {
    ulid: "pay_1",
    status: "pending",
    wallet: {symbol: "btc", scale: 8, precision: 8},
    wallet_network: {id: "btc-net-1", name: "Bitcoin"},
    address: "bc1qexampleaddress",
    qr_code_url: "https://cdn.test/qr.png",
    expected_value: coin("0.5"),
    received_value: coin("0"),
    overpaid: false,
    overpaid_value: coin("0"),
    remaining_value: coin("0.5"),
    detected_at: null,
    rate_locked_at: new Date(Date.now() - lockedMsAgo).toISOString(),
    rate_expires_at: new Date(Date.now() + expiresInMs).toISOString()
  } as unknown as StoreInvoicePayment;
}

let host: HTMLDivElement | null = null;

afterEach(() => {
  if (host) {
    render(null, host);
    host.remove();
    host = null;
  }
});

function mount(node: StoreInvoicePayment, controller: CheckoutController) {
  host = document.createElement("div");
  document.body.appendChild(host);
  render(
    <PayPanel
      payment={node}
      amount={{amount: "42.50", currency: "USD", scale: 2} as never}
      controller={controller}
      mutating={false}
      payerEmail={null}
      savingEmail={false}
      emailError={null}
      layout="narrow"
    />,
    host
  );
  return host;
}

describe("rate lock", () => {
  it("requotes once when the lock lapses, not on every tick", async () => {
    let requotes = 0;
    const controller = new CheckoutController(
      "inv_1",
      fakeApi({
        requote: async (): Promise<Checkout> => {
          requotes++;
          return invoice();
        }
      }),
      {pollMs: 999_999}
    );

    // Already expired at mount, so the first tick takes it past zero.
    const el = mount(payment(-1_000), controller);
    await sleep(2_600); // ~2 further ticks

    // The countdown keeps ticking at zero; only the first may reach the network.
    expect(requotes).toBe(1);
    expect(el.textContent).toContain("Refresh rate");
  });

  it("fills the bar to the window elapsed, not full on every reload", () => {
    const controller = new CheckoutController("inv_1", fakeApi({}), {
      pollMs: 999_999
    });

    // The lock opened five minutes ago and holds for five more: a payer landing
    // (or reloading) now is halfway through the window, so the bar must read ~50%.
    // The bug this guards: a mount-time denominator makes it 100% on every reload.
    const el = mount(payment(300_000, 300_000), controller);

    const bar = el.querySelector<HTMLDivElement>(".bg-accent-surface");
    expect(bar).not.toBeNull();

    const pct = parseFloat(bar!.style.width);
    expect(pct).toBeGreaterThan(45);
    expect(pct).toBeLessThan(55);
  });

  it("offers no refresh button while the lock still holds", () => {
    const controller = new CheckoutController("inv_1", fakeApi({}), {
      pollMs: 999_999
    });

    const el = mount(payment(600_000), controller);

    // The quoted amount is still good; a refresh invites second-guessing.
    expect(el.textContent).not.toContain("Refresh rate");
    expect(el.textContent).toContain("Amount locked");
  });

  it("lets the payer retry by hand after a failed automatic requote", async () => {
    let requotes = 0;
    const controller = new CheckoutController(
      "inv_1",
      fakeApi({
        requote: async (): Promise<Checkout> => {
          requotes++;
          throw new Error("upstream unavailable");
        }
      }),
      {pollMs: 999_999}
    );

    const el = mount(payment(-1_000), controller);
    await sleep(1_400);
    expect(requotes).toBe(1);

    // The deadline has not moved, so a guard shared with the automatic path would
    // leave this button doing nothing at all.
    const refresh = [...el.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Refresh rate")
    );
    expect(refresh).toBeDefined();
    refresh?.click();
    await sleep(50);

    expect(requotes).toBeGreaterThan(1);
  });
});
