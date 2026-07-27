/**
 * The drop-in button matches the store's brand_color: it paints before the modal
 * fetches anything, so it does a one-shot `show` and recolours — unless the merchant
 * fixed the accent, in which case it never fetches.
 */

import {afterEach, describe, expect, it} from "vitest";
import type {Checkout} from "../src/core/types.js";
import {CheckoutButton} from "../src/widget/button.js";
import {fakeApi, invoice, sleep} from "./helpers.js";

let target: HTMLElement | null = null;

const branded = (hex: string) =>
  invoice({
    store: {name: "S", brand_color: hex}
  } as unknown as Partial<Checkout>);

function accentOf(): string {
  const host = target!.querySelector<HTMLElement>("[data-coinfat]");
  return host!.style.getPropertyValue("--cf-accent");
}

afterEach(() => {
  target?.remove();
  target = null;
});

describe("CheckoutButton", () => {
  it("recolours to the store's brand_color", async () => {
    target = document.createElement("div");
    document.body.appendChild(target);

    const button = new CheckoutButton(
      fakeApi({show: async () => branded("#1a2b3c")}),
      {invoice: "inv_1", mount: target}
    );
    await sleep(10); // the one-shot brand fetch resolves

    expect(accentOf()).toBe("#1a2b3c");
    button.destroy();
  });

  it("lets a checkout-level theme.accent win too, matching the modal it opens", async () => {
    // `openCheckout` resolves the modal theme as `checkout?.theme ?? theme`, so a
    // checkout-level accent must claim the button too, or a brand-coloured button
    // opens a merchant-accented modal.
    target = document.createElement("div");
    document.body.appendChild(target);

    let shows = 0;
    const button = new CheckoutButton(
      fakeApi({
        show: async () => {
          shows++;
          return branded("#1a2b3c");
        }
      }),
      {
        invoice: "inv_1",
        mount: target,
        checkout: {theme: {accent: "#00ff00"}}
      }
    );
    await sleep(10);

    expect(accentOf()).toBe("#00ff00");
    expect(shows).toBe(0);
    button.destroy();
  });

  it("keeps the default accent when the brand lookup fails", async () => {
    target = document.createElement("div");
    document.body.appendChild(target);

    const button = new CheckoutButton(
      fakeApi({show: async () => Promise.reject(new Error("boom"))}),
      {invoice: "inv_1", mount: target}
    );
    await sleep(10);

    // Best-effort: a rejection must neither set an accent nor escape as unhandled.
    expect(accentOf()).toBe("");
    button.destroy();
  });

  it("does not apply the accent when destroyed mid-flight", async () => {
    target = document.createElement("div");
    document.body.appendChild(target);

    const button = new CheckoutButton(
      fakeApi({
        show: async () => {
          await sleep(20);
          return branded("#1a2b3c");
        }
      }),
      {invoice: "inv_1", mount: target}
    );

    button.destroy(); // aborts, and drops the mount before the fetch settles
    await sleep(40);

    expect(target.querySelector("[data-coinfat]")).toBeNull();
  });

  it("lets a merchant theme.accent win, without fetching the brand colour", async () => {
    target = document.createElement("div");
    document.body.appendChild(target);

    let shows = 0;
    const button = new CheckoutButton(
      fakeApi({
        show: async () => {
          shows++;
          return branded("#1a2b3c");
        }
      }),
      {invoice: "inv_1", mount: target, theme: {accent: "#00ff00"}}
    );
    await sleep(10);

    expect(accentOf()).toBe("#00ff00");
    expect(shows).toBe(0); // fixed accent → no brand lookup
    button.destroy();
  });
});
