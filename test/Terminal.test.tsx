/**
 * Terminal states route on `invoice.status` and link to the store when a url is set.
 * Rendered without a provider, so copy comes from the default English table.
 */

import {render} from "preact";
import {afterEach, describe, expect, it} from "vitest";
import type {Checkout} from "../src/core/types.js";
import {Terminal} from "../src/ui/Terminal.js";
import {invoice} from "./helpers.js";

let host: HTMLDivElement | null = null;

function mount(over: Partial<Checkout>): HTMLDivElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  render(<Terminal invoice={invoice(over)} />, host);
  return host;
}

const link = () => host!.querySelector("a");

afterEach(() => {
  if (host) {
    render(null, host);
    host.remove();
    host = null;
  }
});

describe("Terminal", () => {
  it("completed: success mark, message, and Continue → success_url", () => {
    const el = mount({
      status: "completed",
      success_url: "https://store.test/done"
    });

    expect(el.textContent).toContain("Your payment was received");
    expect(el.textContent).toContain("$10.00");
    // The animated check, not a static status line.
    expect(el.querySelector(".cf-check-draw")).not.toBeNull();
    expect(link()?.textContent).toContain("Continue");
    expect(link()?.getAttribute("href")).toBe("https://store.test/done");
  });

  it("expired: message and Return to store → cancel_url, no amount", () => {
    const el = mount({
      status: "expired",
      cancel_url: "https://store.test/back"
    });

    expect(el.textContent).toContain("This payment link has expired");
    expect(el.textContent).not.toContain("$10.00");
    expect(link()?.textContent).toContain("Return to store");
    expect(link()?.getAttribute("href")).toBe("https://store.test/back");
  });

  it("canceled: message and Return to store → cancel_url", () => {
    const el = mount({
      status: "canceled",
      cancel_url: "https://store.test/back"
    });

    expect(el.textContent).toContain("This invoice was canceled");
    expect(link()?.getAttribute("href")).toBe("https://store.test/back");
  });

  it("omits the action link when the invoice carries no url", () => {
    const el = mount({status: "completed", success_url: null});

    expect(el.textContent).toContain("Your payment was received");
    expect(link()).toBeNull();
  });
});
