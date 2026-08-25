/**
 * Pay-experience regressions, pinned against the shapes a real invoice returns.
 */

import {render} from "preact";
import {afterEach, describe, expect, it, vi} from "vitest";
import {CheckoutApiError} from "../src/core/api.js";
import {CheckoutController} from "../src/core/checkout.js";
import type {Checkout, StoreInvoicePayment} from "../src/core/types.js";
import {Checkout as CheckoutView} from "../src/ui/Checkout.js";
import {paymentAmounts} from "../src/ui/payment.js";
import {createShadowHost} from "../src/widget/mount.js";
import {CheckoutSession} from "../src/widget/session.js";
import {fakeApi, invoice, sleep} from "./helpers.js";

const coin = (amount: string) => ({amount, wallet: "eth", symbol: "ETH"});

/** Shaped from a real POST /checkout/{ulid}/select against test-api.coinfat.com. */
function ethPayment(
  over: Partial<StoreInvoicePayment> = {}
): StoreInvoicePayment {
  return {
    ulid: "01ky7xd7fef5f54ahc38182qnc",
    status: "pending",
    // From the live payload: ETH is scale 18 but precision 8, and amounts arrive at
    // precision. Formatting at scale invents digits the backend never sent.
    wallet: {symbol: "eth", scale: 18, precision: 8, svg_icon: null},
    wallet_network: {id: "eth-net-1", name: "Ethereum"},
    address: "0x000000000000000000000000000000000000dEaD",
    deposit_uri:
      "ethereum:0x000000000000000000000000000000000000dEaD@11155111?value=1323780930141433",
    qr_code_url:
      "https://api.qrserver.com/v1/create-qr-code/?data=ethereum%3A0x50",
    expected_value: coin("0.00132378"),
    received_value: coin("0"),
    overpaid: false,
    overpaid_value: coin("0"),
    remaining_value: coin("0.00132378"),
    detected_at: null,
    rate_locked_at: new Date(Date.now()).toISOString(),
    rate_expires_at: new Date(Date.now() + 600_000).toISOString(),
    ...over
  } as unknown as StoreInvoicePayment;
}

let host: HTMLElement | null = null;

afterEach(() => {
  if (host) {
    render(null, host);
    host.remove();
    host = null;
  }
});

function mountCheckout(controller: CheckoutController): HTMLElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  render(<CheckoutView controller={controller} layout="narrow" />, host);
  return host;
}

async function loaded(payload: Checkout): Promise<HTMLElement> {
  const controller = new CheckoutController(
    "inv_1",
    fakeApi({show: async () => payload}),
    {pollMs: 999_999}
  );
  const el = mountCheckout(controller);
  controller.start();
  await sleep(30);
  return el;
}

describe("amounts at the wallet's precision", () => {
  it("quotes the backend's amount string verbatim", () => {
    // Live value from POST /select, already rounded and trimmed.
    expect(paymentAmounts(ethPayment()).expected).toBe("0.00132378");
  });

  it("quotes the backend's shortfall verbatim, at a precision the payer can send", () => {
    // Derived at precision (8), not scale (18): a payer cannot send those digits.
    const {remaining} = paymentAmounts(
      ethPayment({
        received_value: coin("0.001"),
        remaining_value: coin("0.00032378")
      })
    );

    expect(remaining).toBe("0.00032378");
  });
});

describe("terminal invoices", () => {
  it("shows no deposit address once the invoice is paid", async () => {
    const el = await loaded(
      invoice({status: "completed", active_payment: ethPayment()})
    );

    // The resource keeps active_payment after settlement; rendering the pay panel
    // anyway invites a reloading payer to send a second transfer.
    expect(el.textContent).not.toContain("0x00000000");
    expect(el.textContent).not.toContain("Listening for your payment");
    expect(el.textContent).toContain("Your payment was received");
  });

  it("refuses to requote a settled invoice", async () => {
    let requotes = 0;
    const controller = new CheckoutController(
      "inv_1",
      fakeApi({
        show: async () => invoice({status: "expired"}),
        requote: async () => {
          requotes++;
          return invoice();
        }
      }),
      {pollMs: 999_999}
    );

    controller.start();
    await sleep(30);
    await controller.requote();

    // The backend 422s this, and that error on a finished invoice is noise.
    expect(requotes).toBe(0);
    expect(controller.getState().error).toBeNull();
  });
});

describe("error copy", () => {
  it("shows the server's reason for a 4xx", async () => {
    const controller = new CheckoutController(
      "inv_1",
      fakeApi({
        show: async () => invoice(),
        select: async () => {
          throw new CheckoutApiError(
            "This invoice is no longer accepting payments.",
            422
          );
        }
      }),
      {pollMs: 999_999}
    );

    const el = mountCheckout(controller);
    controller.start();
    await sleep(30);
    await controller.select("eth-net-1");
    await sleep(30);

    // Telling this payer to "check your connection" would be actively misleading.
    expect(el.textContent).toContain("no longer accepting payments");
  });

  it("keeps generic copy for a transport failure", async () => {
    let calls = 0;
    const controller = new CheckoutController(
      "inv_1",
      fakeApi({
        show: async () => {
          // Load once, then fail: the inline banner only exists alongside a rendered
          // invoice. A first-load failure is the full LoadError card instead.
          if (++calls > 1) {
            throw new CheckoutApiError("Failed to fetch", 0);
          }
          return invoice();
        }
      }),
      {pollMs: 20}
    );

    const el = mountCheckout(controller);
    controller.start();
    await sleep(120);

    // status 0 carries no message worth quoting, and it is the case that retries.
    expect(el.textContent).toContain("check your connection");
  });
});

describe("accent contrast", () => {
  it("flips the on-accent text to white for a dark brand colour", () => {
    // The exact example given for brand_color in core/types.ts.
    const mount = createShadowHost({accent: "#1A2B3C"});

    expect(mount.host.style.getPropertyValue("--cf-primary-foreground")).toBe(
      "#ffffff"
    );
    mount.unmount();
  });

  it("keeps dark text on a light accent", () => {
    const mount = createShadowHost({accent: "#ffd166"});

    expect(mount.host.style.getPropertyValue("--cf-primary-foreground")).toBe(
      "#181818"
    );
    mount.unmount();
  });

  it("leaves the default alone for an unparseable accent", () => {
    const mount = createShadowHost({accent: "rebeccapurple"});

    expect(mount.host.style.getPropertyValue("--cf-primary-foreground")).toBe(
      ""
    );
    mount.unmount();
  });
});

describe("modal reopen", () => {
  it("keeps the store's accent on a host rebuilt by open()", async () => {
    const session = new CheckoutSession(
      fakeApi({
        show: async () =>
          invoice({store: {name: "S", brand_color: "#1a2b3c"}} as never)
      }),
      {invoice: "inv_1", display: "modal"}
    );

    const accent = () =>
      document
        .querySelector<HTMLElement>("body > [data-coinfat]")
        ?.style.getPropertyValue("--cf-accent");

    session.open();
    await sleep(20);
    expect(accent()).toBe("#1a2b3c");

    session.close();
    session.open();
    await sleep(20);
    expect(accent()).toBe("#1a2b3c");

    session.destroy();
  });
});

describe("the card's own Close button", () => {
  it("goes through the close guard, not around it", async () => {
    // It reaches `requestClose` via CloseRequestContext. Wired to the raw `onRequestClose`
    // instead, the card's exit walks straight past the warning the backdrop raises.
    const session = new CheckoutSession(
      fakeApi({
        show: async () =>
          invoice({active_payment: ethPayment({detected_at: null})})
      }),
      {invoice: "inv_1", display: "modal"}
    );

    session.open();
    await sleep(30);

    const shadow = () =>
      document.querySelector("body > [data-coinfat]")?.shadowRoot ?? null;
    const close = shadow()!.querySelector<HTMLButtonElement>(
      'button[aria-label="Close"]'
    )!;
    expect(close).toBeTruthy();

    close.click();
    await sleep(10);

    expect(shadow()!.querySelector('[role="alertdialog"]')).toBeTruthy();
    expect(shadow()!.querySelector('[role="dialog"]')).toBeTruthy();

    session.destroy();
  });
});

describe("the success_url redirect", () => {
  it("still happens when the merchant's own onCompleted throws", async () => {
    // Their bug should not strand a payer on a paid invoice. The controller catches the
    // throw, but by then the redirect beside it has already been skipped.
    const assign = vi.fn();
    const original = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {...original, assign}
    });

    try {
      const session = new CheckoutSession(
        fakeApi({
          show: async () =>
            invoice({
              status: "completed",
              success_url: "https://merchant.test/thanks"
            })
        }),
        {
          invoice: "inv_1",
          display: "modal",
          redirectOnComplete: true,
          onCompleted: () => {
            throw new Error("merchant bug");
          }
        }
      );

      session.open();
      await sleep(30);

      expect(assign).toHaveBeenCalledWith("https://merchant.test/thanks");
      session.destroy();
    } finally {
      Object.defineProperty(window, "location", {
        configurable: true,
        value: original
      });
    }
  });
});

describe("a dark brand colour in dark mode", () => {
  const varOf = (mount: {host: HTMLElement}, name: string) =>
    mount.host.style.getPropertyValue(name);

  it("keeps the accent as a fill but lightens it where it is text", () => {
    // #000000 is a plausible brand. As a button fill it must stay black; as a status
    // label on a near-black card it measured 1.15:1 — invisible.
    const mount = createShadowHost({accent: "#000000"});

    expect(varOf(mount, "--cf-accent")).toBe("#000000");
    expect(varOf(mount, "--cf-accent-on-light")).toBe("#000000");
    expect(varOf(mount, "--cf-accent-on-dark")).not.toBe("#000000");
  });

  it("darkens a pale brand for the light card, and leaves it for the dark one", () => {
    // The mirror case. No single colour clears 4.5:1 against both a white and a
    // near-black card — which is the whole reason there are two variants.
    const mount = createShadowHost({accent: "#ffee00"});

    expect(varOf(mount, "--cf-accent-on-dark")).toBe("#ffee00");
    expect(varOf(mount, "--cf-accent-on-light")).not.toBe("#ffee00");
  });

  it("ignores an unparseable accent entirely", () => {
    const mount = createShadowHost({accent: "rebeccapurple"});

    expect(varOf(mount, "--cf-accent-on-dark")).toBe("");
  });
});
