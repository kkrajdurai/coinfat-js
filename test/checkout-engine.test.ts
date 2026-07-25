/**
 * CheckoutController ordering and teardown. Every case is a regression test,
 * verified to fail against the code as it stood before its fix.
 */

import {afterEach, describe, expect, it} from "vitest";
import {CheckoutApiError} from "../src/core/api.js";
import {CheckoutController} from "../src/core/checkout.js";
import {delay, fakeApi, invoice, payment, sleep} from "./helpers.js";

const NEVER_POLL = {pollMs: 999_999};

let running: CheckoutController[] = [];

function controller(...args: ConstructorParameters<typeof CheckoutController>) {
  const instance = new CheckoutController(...args);
  running.push(instance);
  return instance;
}

afterEach(() => {
  running.forEach((instance) => instance.stop());
  running = [];
});

describe("mutations", () => {
  it("applies the newest selection when an earlier one resolves later", async () => {
    const api = fakeApi({
      show: async (_u: string, signal?: AbortSignal) => {
        await delay(5, signal);
        return invoice();
      },
      select: async (_u: string, networkId: string, signal?: AbortSignal) => {
        // The first pick is the slow one, so a naive implementation lets it land last.
        await delay(networkId === "tron" ? 120 : 10, signal);
        return invoice({active_payment: payment("p1", networkId)});
      }
    });

    const engine = controller("inv_1", api, NEVER_POLL);
    engine.start();
    await sleep(20);

    void engine.select("tron");
    await sleep(2);
    void engine.select("ethereum");
    await sleep(250);

    // Anything else means the payer is shown an address for a chain they did not pick.
    expect(engine.getState().invoice?.active_payment?.address).toBe(
      "addr_ethereum"
    );
  });

  it("clears `mutating` when a requote supersedes an in-flight select", async () => {
    const api = fakeApi({
      show: async (_u: string, signal?: AbortSignal) => {
        await delay(5, signal);
        return invoice();
      },
      select: async (_u: string, _n: string, signal?: AbortSignal) => {
        await delay(120, signal);
        return invoice();
      },
      requote: async (_u: string, signal?: AbortSignal) => {
        await delay(10, signal);
        return invoice();
      }
    });

    const engine = controller("inv_1", api, NEVER_POLL);
    engine.start();
    await sleep(20);

    void engine.select("tron");
    await sleep(10);
    void engine.requote();
    await sleep(250);

    // Two separate flags used to strand this one on, disabling the coin picker.
    expect(engine.getState().mutating).toBe(false);
  });

  it("reports a failed select through state instead of rejecting", async () => {
    const api = fakeApi({
      show: async () => invoice(),
      select: async () => {
        throw new CheckoutApiError("No longer accepting payments.", 422);
      }
    });

    const engine = controller("inv_1", api, NEVER_POLL);
    let rejected = false;

    // Fire-and-forget from a click handler: rejecting would surface as an
    // unhandledrejection on the merchant's page.
    await engine.select("tron").catch(() => {
      rejected = true;
    });

    expect(rejected).toBe(false);
    expect(engine.getState().error?.status).toBe(422);
  });
});

describe("teardown", () => {
  it("lets stop() abort a show() that a concurrent refetch installed", async () => {
    const aborted: boolean[] = [];
    const api = fakeApi({
      show: async (_u: string, signal?: AbortSignal) => {
        try {
          await delay(300, signal);
        } catch (error) {
          aborted.push(true);
          throw error;
        }
        aborted.push(false);
        return invoice();
      },
      select: async (_u: string, _n: string, signal?: AbortSignal) => {
        await delay(120, signal);
        return invoice();
      }
    });

    const engine = controller("inv_1", api, NEVER_POLL);
    engine.start();
    await sleep(350);

    void engine.select("tron");
    await sleep(10);
    void engine.refetch(); // aborts the mutation and installs its own controller
    await sleep(60); // the mutation has rejected and run its finally by now
    engine.stop();
    await sleep(400);

    // The mutation's finally used to null the shared handle, stranding this request.
    expect(aborted.at(-1)).toBe(true);
  });

  it("fires no request after stop()", async () => {
    let shows = 0;
    const api = fakeApi({
      show: async (_u: string, signal?: AbortSignal) => {
        shows++;
        await delay(5, signal);
        return invoice();
      },
      select: async (_u: string, _n: string, signal?: AbortSignal) => {
        await delay(120, signal);
        return invoice();
      }
    });

    const engine = controller("inv_1", api, {pollMs: 60});
    engine.start();
    await sleep(20);

    // Two completion paths land together, so one timer handle goes untracked.
    void engine.select("tron");
    await sleep(10);
    void engine.refetch();
    await sleep(15);
    engine.stop();

    const atStop = shows;
    await sleep(400);

    expect(shows).toBe(atStop);
  });

  it("keeps the poll rate steady when a mutation and a refetch both reschedule", async () => {
    let shows = 0;
    const api = fakeApi({
      show: async (_u: string, signal?: AbortSignal) => {
        shows++;
        await delay(5, signal);
        return invoice();
      },
      select: async (_u: string, _n: string, signal?: AbortSignal) => {
        await delay(120, signal);
        return invoice();
      }
    });

    const engine = controller("inv_1", api, {pollMs: 60});
    engine.start();
    await sleep(20);

    void engine.select("tron");
    await sleep(10);
    void engine.refetch();
    await sleep(400); // ~6 intervals

    expect(shows).toBeLessThanOrEqual(9);
  });
});

describe("wallets", () => {
  it("fetches the payable coins once across modal reopens", async () => {
    let calls = 0;
    const api = fakeApi({
      show: async () => invoice(),
      wallets: async () => {
        calls++;
        await sleep(5);
        return [];
      }
    });

    const engine = controller("inv_1", api, NEVER_POLL);

    // close() -> stop(), open() -> start(). The data is static per invoice.
    for (let open = 0; open < 3; open++) {
      engine.start();
      await sleep(30);
      engine.stop();
    }

    expect(calls).toBe(1);
  });
});
