/**
 * Merchant lifecycle callbacks. They live on the controller rather than the view
 * precisely so a modal reopen cannot replay them.
 */

import {describe, expect, it} from "vitest";
import {CheckoutController} from "../src/core/checkout.js";
import type {CheckoutCallbacks} from "../src/core/options.js";
import {fakeApi, invoice, payment, sleep} from "./helpers.js";

const NEVER_POLL = {pollMs: 999_999};

describe("lifecycle callbacks", () => {
  it("fires onReady and onCompleted once across modal reopens", async () => {
    let ready = 0;
    let completed = 0;
    const callbacks: CheckoutCallbacks = {
      onReady: () => ready++,
      onCompleted: () => completed++
    };

    const engine = new CheckoutController(
      "inv_1",
      fakeApi({show: async () => invoice({status: "completed"})}),
      {...NEVER_POLL, callbacks}
    );

    for (let open = 0; open < 3; open++) {
      engine.start();
      await sleep(30);
      engine.stop();
    }

    // With the bookkeeping in a component ref this was 3/3, and every extra
    // onCompleted re-runs the opt-in success_url redirect.
    expect({ready, completed}).toEqual({ready: 1, completed: 1});
  });

  it("reports a network switch inside one coin", async () => {
    let selected = 0;

    // The backend keeps ONE payment row per coin and re-points its selected
    // network, so the ulid is identical either side of the switch.
    const engine = new CheckoutController(
      "inv_1",
      fakeApi({
        show: async () => invoice({active_payment: payment("p1", "btc-net-1")}),
        select: async () =>
          invoice({active_payment: payment("p1", "btc-net-2")})
      }),
      {...NEVER_POLL, callbacks: {onCoinSelected: () => selected++}}
    );

    engine.start();
    await sleep(30);
    await engine.select("btc-net-2");
    await sleep(30);
    engine.stop();

    expect(selected).toBe(1);
  });

  it("does not report a pay_with preselection as a payer choice", async () => {
    let selected = 0;

    // The merchant fixed the network server-side at invoice creation, so the very
    // first payload already carries a payment. Nobody selected anything here.
    const engine = new CheckoutController(
      "inv_1",
      fakeApi({
        show: async () => invoice({active_payment: payment("p1", "btc-net-1")})
      }),
      {...NEVER_POLL, callbacks: {onCoinSelected: () => selected++}}
    );

    engine.start();
    await sleep(30);
    engine.stop();

    expect(selected).toBe(0);
  });
});
