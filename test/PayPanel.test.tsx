/**
 * Render smoke tests for the pay panel — a null the JSX did not guard, a required field
 * quietly rendering as nothing. The arithmetic is payment.test.ts.
 */

import {render} from "preact";
import {afterEach, describe, expect, it} from "vitest";
import {CheckoutController} from "../src/core/checkout.js";
import type {StoreInvoicePayment} from "../src/core/types.js";
import {PayPanel} from "../src/ui/PayPanel.js";
import {fakeApi} from "./helpers.js";

const coin = (amount: string) => ({amount, wallet: "btc", symbol: "BTC"});

function payment(over: Partial<StoreInvoicePayment> = {}): StoreInvoicePayment {
  return {
    ulid: "pay_1",
    status: "pending",
    wallet: {
      symbol: "btc",
      scale: 8,
      precision: 8,
      svg_icon: "https://cdn.test/btc.svg"
    },
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
    // Far enough out that the rate lock never elapses mid-test.
    rate_expires_at: new Date(Date.now() + 600_000).toISOString(),
    ...over
  } as unknown as StoreInvoicePayment;
}

let host: HTMLDivElement | null = null;

function mount(
  node: StoreInvoicePayment,
  onChangeCoin?: () => void,
  layout: "wide" | "narrow" = "narrow"
): HTMLDivElement {
  host = document.createElement("div");
  document.body.appendChild(host);

  const controller = new CheckoutController("inv_1", fakeApi({}), {
    pollMs: 999_999
  });

  render(
    <PayPanel
      payment={node}
      controller={controller}
      mutating={false}
      layout={layout}
      onChangeCoin={onChangeCoin}
    />,
    host
  );

  return host;
}

afterEach(() => {
  // Unmount rather than just detaching: RateLock holds a 1s interval.
  if (host) {
    render(null, host);
    host.remove();
    host = null;
  }
});

describe("PayPanel", () => {
  it("shows the amount, the address and a scannable QR", () => {
    const el = mount(payment());

    expect(el.textContent).toContain("0.5 BTC");
    expect(el.textContent).toContain("bc1qexampleaddress");
    expect(el.textContent).toContain("Listening for your payment");

    const qr = el.querySelector<HTMLImageElement>(
      'img[src="https://cdn.test/qr.png"]'
    );
    expect(qr).not.toBeNull();
    // With no alt text the QR is invisible to a screen reader.
    expect(qr?.alt).toContain("BTC");
  });

  it("labels the coin with its network", () => {
    expect(mount(payment()).textContent).toContain("BTC · Bitcoin");
  });

  it("survives a payment with no network and no icon", () => {
    // wallet_network is nullable; the chip must not print "undefined" or throw
    // reading `.name` off null.
    const el = mount(
      payment({
        wallet_network: null,
        wallet: {symbol: "btc", scale: 8, precision: 8}
      } as never)
    );

    expect(el.textContent).toContain("BTC");
    expect(el.textContent).not.toContain("undefined");
    expect(el.querySelector("img[alt='']")).toBeNull();
  });

  it("explains a missing deposit address instead of showing an empty box", () => {
    // The three go null together when the provider has no address provisioned — a
    // real failure, not "no coin picked yet".
    const el = mount(
      payment({address: null, deposit_uri: null, qr_code_url: null})
    );

    expect(el.textContent).toContain("No deposit address is available");
    expect(el.querySelector("img[src*='qr']")).toBeNull();
  });

  it("hides the rate lock once a transfer is detected", () => {
    const el = mount(
      payment({
        detected_at: "2026-07-23T11:00:00Z",
        received_value: coin("0.5"),
        remaining_value: coin("0")
      })
    );

    // Re-quoting would move the amount a payer has already sent against.
    expect(el.textContent).not.toContain("Amount locked");
    expect(el.textContent).not.toContain("Refresh rate");
    expect(el.textContent).toContain("Confirming your payment");
  });

  it("breaks down the amounts once something has arrived", () => {
    const el = mount(
      payment({
        status: "underpaid",
        received_value: coin("0.2"),
        remaining_value: coin("0.3"),
        detected_at: "2026-07-23T11:00:00Z"
      })
    );

    expect(el.textContent).toContain("Send 0.3 BTC more to complete");
    expect(el.textContent).toContain("Remaining");
  });

  it("shows no breakdown table before anything arrives", () => {
    const el = mount(payment());

    // A row of zeroes is noise while the payer has not sent yet.
    expect(el.textContent).not.toContain("Expected");
    expect(el.textContent).toContain("Amount locked");
  });

  it("gates the two-column split on the wide layout", () => {
    const grid = (el: HTMLDivElement) =>
      el.querySelector<HTMLElement>('[class*="grid-cols-1"]')!.className;

    expect(grid(mount(payment(), undefined, "wide"))).toContain(
      "@md:grid-cols"
    );
    expect(grid(mount(payment(), undefined, "narrow"))).not.toContain(
      "@md:grid-cols"
    );
  });

  it("offers change-coin only when a handler is given, and calls it", () => {
    // No handler (the locked, post-detection case in Checkout): no affordance.
    expect(mount(payment()).textContent).not.toContain("Change coin");

    let changed = 0;
    const el = mount(payment(), () => changed++);
    const button = Array.from(el.querySelectorAll("button")).find((node) =>
      node.textContent?.includes("Change coin")
    );

    expect(button).toBeTruthy();
    button?.click();
    expect(changed).toBe(1);
  });
});
