/** CheckoutController ordering and teardown. Every case is a regression test. */

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

    // Anything else shows an address for a chain the payer did not pick.
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

    // Fire-and-forget from a click handler: a rejection would surface as an
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

/**
 * The notification address is the one mutation that does NOT re-quote the payment, so it
 * runs beside `select`/`requote` rather than through the same gate. Everything here is
 * about that separation holding.
 */
describe("payer email", () => {
  it("does not cancel a coin switch running alongside it", async () => {
    let selected: string | null = null;

    const api = fakeApi({
      show: async () => invoice(),
      select: async (_u: string, networkId: string, signal?: AbortSignal) => {
        await delay(20, signal);
        selected = networkId;
        return invoice({active_payment: payment("pay_1", networkId)});
      },
      setPayerEmail: async () => invoice({payer_email: "j***@example.com"})
    });

    const engine = controller("inv_1", api, NEVER_POLL);
    engine.start();
    await sleep(5);

    // Routed through `mutate`, this would abort the in-flight select outright.
    const switching = engine.select("net_2");
    await sleep(5);
    await engine.setPayerEmail("jane@example.com");
    await switching;

    expect(selected).toBe("net_2");
    expect(engine.getState().invoice?.active_payment?.wallet_network?.id).toBe(
      "net_2"
    );
  });

  it("never raises `mutating`, which drives the picker and refresh spinners", async () => {
    const seen: boolean[] = [];

    const api = fakeApi({
      show: async () => invoice(),
      setPayerEmail: async (_u: string, _e: string, signal?: AbortSignal) => {
        await delay(10, signal);
        return invoice({payer_email: "j***@example.com"});
      }
    });

    const engine = controller("inv_1", api, NEVER_POLL);
    engine.subscribe((state) => seen.push(state.mutating));
    engine.start();
    await sleep(5);

    const saving = engine.setPayerEmail("jane@example.com");
    expect(engine.getState().savingEmail).toBe(true);
    await saving;

    expect(seen).not.toContain(true);
    expect(engine.getState().savingEmail).toBe(false);
  });

  it("takes only payer_email off the response, not the stale payment beside it", async () => {
    const api = fakeApi({
      show: async () => invoice({active_payment: payment("pay_1", "net_1")}),
      select: async (_u: string, networkId: string) =>
        invoice({active_payment: payment("pay_1", networkId)}),
      // Serialised before the switch landed: this body still carries net_1.
      setPayerEmail: async (_u: string, _e: string, signal?: AbortSignal) => {
        await delay(20, signal);
        return invoice({
          active_payment: payment("pay_1", "net_1"),
          payer_email: "j***@example.com"
        });
      }
    });

    const engine = controller("inv_1", api, NEVER_POLL);
    engine.start();
    await sleep(5);

    const saving = engine.setPayerEmail("jane@example.com");
    await engine.select("net_2");
    await saving;

    const state = engine.getState();
    expect(state.invoice?.payer_email).toBe("j***@example.com");
    // Applying the response whole would resurrect the network the payer left.
    expect(state.invoice?.active_payment?.wallet_network?.id).toBe("net_2");
  });

  it("keeps its failure off the card-level error banner", async () => {
    const api = fakeApi({
      show: async () => invoice(),
      setPayerEmail: async () => {
        throw new CheckoutApiError("The email field must be valid.", 422, {
          email: ["The email field must be valid."]
        });
      }
    });

    const engine = controller("inv_1", api, NEVER_POLL);
    engine.start();
    await sleep(5);
    await engine.setPayerEmail("nope");

    const state = engine.getState();
    expect(state.emailError?.status).toBe(422);
    // `error` paints a banner across the card and re-arms the merchant's onError.
    expect(state.error).toBeNull();
  });

  it("does not submit against a settled invoice", async () => {
    let calls = 0;

    const api = fakeApi({
      show: async () => invoice({status: "completed"}),
      setPayerEmail: async () => {
        calls++;
        return invoice();
      }
    });

    const engine = controller("inv_1", api, NEVER_POLL);
    engine.start();
    await sleep(5);
    await engine.setPayerEmail("jane@example.com");

    expect(calls).toBe(0);
  });

  it("clears the in-flight flag when a teardown aborts it", async () => {
    const api = fakeApi({
      show: async () => invoice(),
      setPayerEmail: async (_u: string, _e: string, signal?: AbortSignal) => {
        await delay(50, signal);
        return invoice({payer_email: "j***@example.com"});
      }
    });

    const engine = controller("inv_1", api, NEVER_POLL);
    engine.start();
    await sleep(5);

    void engine.setPayerEmail("jane@example.com");
    await sleep(5);
    // A modal closed mid-request reopens on the same controller.
    engine.stop();
    await sleep(5);

    expect(engine.getState().savingEmail).toBe(false);
  });
});

describe("payer email, against the poll", () => {
  it("survives a show that was serialised before the address was saved", async () => {
    let shows = 0;

    const api = fakeApi({
      show: async (_u: string, signal?: AbortSignal) => {
        shows++;
        // The second poll is slow: issued before the PUT, lands after it, and its body
        // still predates the address.
        if (shows === 2) await delay(40, signal);
        return invoice({payer_email: null});
      },
      setPayerEmail: async () => invoice({payer_email: "j***@example.com"})
    });

    const engine = controller("inv_1", api, {pollMs: 10});
    engine.start();
    await sleep(20);
    await engine.setPayerEmail("jane@example.com");
    await sleep(60);

    // Without this the confirmation the payer is reading reverts to "Email me when this
    // payment confirms" until the next poll, which reads as the address being lost.
    expect(engine.getState().invoice?.payer_email).toBe("j***@example.com");
  });
});
