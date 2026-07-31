/**
 * Render smoke tests for the pay panel — a null the JSX did not guard, a required field
 * quietly rendering as nothing. The arithmetic is payment.test.ts.
 */

import {render} from "preact";
import {act} from "preact/test-utils";
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
      amount={{amount: "42.50", currency: "USD", scale: 2} as never}
      controller={controller}
      mutating={false}
      layout={layout}
      onChangeCoin={onChangeCoin}
    />,
    host
  );

  return host;
}

function rerender(into: HTMLDivElement, node: StoreInvoicePayment): void {
  render(
    <PayPanel
      payment={node}
      amount={{amount: "42.50", currency: "USD", scale: 2} as never}
      controller={
        new CheckoutController("inv_1", fakeApi({}), {pollMs: 999_999})
      }
      mutating={false}
      layout="narrow"
    />,
    into
  );
}

function mountQr(node = payment()) {
  const el = mount(node);
  const zoom = el.querySelector<HTMLButtonElement>("button[aria-expanded]")!;
  return {el, zoom, img: zoom.querySelector<HTMLImageElement>("img")!};
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

  it("enlarges the QR on click, and puts it back", () => {
    // At size-32 in a narrow modal the QR is small enough that scanning it from a
    // phone is fiddly, and the fallback is retyping a 60-character address.
    const {zoom, img: qr} = mountQr();

    expect(zoom.getAttribute("aria-expanded")).toBe("false");
    expect(qr.className).toContain("size-32");
    // The label sits on the button, which outranks the image's alt — so it has to
    // carry the coin itself or the payer loses which QR this is.
    expect(zoom.getAttribute("aria-label")).toContain("BTC");

    act(() => zoom.click());
    expect(zoom.getAttribute("aria-expanded")).toBe("true");
    expect(qr.className).toContain("size-56");
    // It grows for real. A transform would paint over the coin chip and the amount.
    expect(qr.className).not.toContain("scale-");

    act(() => zoom.click());
    expect(qr.className).toContain("size-32");
  });

  it("swallows Escape while the QR is enlarged", () => {
    // Otherwise the key reaches the modal and starts closing the checkout — a
    // surprising answer to "make this smaller".
    const {el, zoom} = mountQr();
    act(() => zoom.click());

    let reachedModal = false;
    el.addEventListener("keydown", () => (reachedModal = true));
    act(() => {
      zoom.dispatchEvent(
        new KeyboardEvent("keydown", {key: "Escape", bubbles: true})
      );
    });

    expect(zoom.getAttribute("aria-expanded")).toBe("false");
    expect(reachedModal).toBe(false);
  });

  it("lets Escape through when the QR is not enlarged", () => {
    // The payer expects Escape to close the checkout the rest of the time.
    const {el, zoom} = mountQr();

    let reachedModal = false;
    el.addEventListener("keydown", () => (reachedModal = true));
    act(() => {
      zoom.dispatchEvent(
        new KeyboardEvent("keydown", {key: "Escape", bubbles: true})
      );
    });

    expect(reachedModal).toBe(true);
  });

  it("drops the zoom when the coin changes under it", () => {
    const {el, zoom} = mountQr();
    act(() => zoom.click());
    expect(
      el.querySelector("button[aria-expanded]")!.getAttribute("aria-expanded")
    ).toBe("true");

    // A coin switch swaps the image in place; the old zoom must not carry over.
    act(() =>
      rerender(el, payment({qr_code_url: "https://cdn.test/qr-eth.png"}))
    );

    expect(
      el.querySelector("button[aria-expanded]")!.getAttribute("aria-expanded")
    ).toBe("false");
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

  it("warns which coin and chain the address accepts", () => {
    expect(mount(payment()).textContent).toContain("Send only BTC on Bitcoin.");
  });

  it("names the chain, not the pair, for a token payment", () => {
    // The shape the API really sends for USDT-on-Tron: the network is named after the
    // pair, and the chain's plain name is on the fee wallet.
    const el = mount(
      payment({
        wallet: {symbol: "usdt", scale: 6, precision: 6},
        wallet_network: {
          id: "usdt-tron",
          name: "USDT (Tron)",
          execution_fee_wallet: {name: "Tron"}
        }
      } as never)
    );

    expect(el.textContent).toContain("Send only USDT on Tron.");
    expect(el.textContent).not.toContain("on USDT (Tron)");
    // And the chip beside it, which would otherwise say "USDT · USDT (Tron)".
    expect(el.textContent).toContain("USDT · Tron");
  });

  it("drops the chain warning when there is no address to qualify", () => {
    // Both halves of the guard: without an address the warning would be advice about
    // a field that is not on screen, and without a network there is no "only" to name.
    expect(
      mount(payment({address: null, deposit_uri: null, qr_code_url: null}))
        .textContent
    ).not.toContain("Send only");

    expect(mount(payment({wallet_network: null})).textContent).not.toContain(
      "Send only"
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
