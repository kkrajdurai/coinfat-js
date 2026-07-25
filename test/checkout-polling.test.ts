/**
 * The polling loop: when it backs off, when it gives up, and how subscribers see it.
 */

import {afterEach, describe, expect, it} from "vitest";
import {CheckoutApiError} from "../src/core/api.js";
import {CheckoutController, type CheckoutState} from "../src/core/checkout.js";
import {fakeApi, invoice, sleep} from "./helpers.js";

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

describe("backoff", () => {
  it("spaces retries out exponentially while failures continue", async () => {
    let shows = 0;
    const engine = controller(
      "inv_1",
      fakeApi({
        show: async () => {
          shows++;
          throw new CheckoutApiError("Server error", 500);
        }
      }),
      {pollMs: 20}
    );

    engine.start();
    await sleep(400);

    // Flat 20ms polling would be ~20 attempts; doubling gives 20, 40, 80, 160,
    // 320. The upper bound is the point: a failing endpoint must not be hammered.
    expect(shows).toBeGreaterThanOrEqual(2);
    expect(shows).toBeLessThanOrEqual(6);
  });

  it("returns to the normal interval once a fetch succeeds", async () => {
    let shows = 0;
    const engine = controller(
      "inv_1",
      fakeApi({
        show: async () => {
          shows++;
          // Fail hard enough to stretch the interval, then recover.
          if (shows <= 3) {
            throw new CheckoutApiError("Server error", 500);
          }
          return invoice();
        }
      }),
      {pollMs: 20}
    );

    engine.start();
    await sleep(300);
    const afterRecovery = shows;
    await sleep(200);

    // Back at ~20ms the last 200ms alone adds several polls; an unreset streak
    // would still be growing the interval.
    expect(shows - afterRecovery).toBeGreaterThan(3);
    expect(engine.getState().error).toBeNull();
  });
});

describe("giving up", () => {
  it("stops polling once the invoice reaches a terminal status", async () => {
    let shows = 0;
    const engine = controller(
      "inv_1",
      fakeApi({
        show: async () => {
          shows++;
          return invoice({status: "completed"});
        }
      }),
      {pollMs: 20}
    );

    engine.start();
    await sleep(300);

    // A completed, expired or canceled invoice will never change again.
    expect(shows).toBe(1);
    expect(engine.getState().isTerminal).toBe(true);
  });

  it("stops polling on a 404 for an invoice that never loaded", async () => {
    let shows = 0;
    const engine = controller(
      "inv_1",
      fakeApi({
        show: async () => {
          shows++;
          throw new CheckoutApiError("No query results.", 404);
        }
      }),
      {pollMs: 20}
    );

    engine.start();
    await sleep(300);

    // A bad ulid is not going to start existing, so retrying only burns throttle.
    expect(shows).toBe(1);
    expect(engine.getState().notFound).toBe(true);
  });

  it("keeps polling through a 404 that arrives after a successful load", async () => {
    let shows = 0;
    const engine = controller(
      "inv_1",
      fakeApi({
        show: async () => {
          shows++;
          if (shows === 1) {
            return invoice();
          }
          throw new CheckoutApiError("No query results.", 404);
        }
      }),
      {pollMs: 20}
    );

    engine.start();
    await sleep(200);

    // The ulid demonstrably resolved once, so a later 404 is a blip, not a bad
    // link — notFound stays false and the backoff handles it.
    expect(shows).toBeGreaterThan(1);
    expect(engine.getState().notFound).toBe(false);
    expect(engine.getState().invoice).not.toBeNull();
  });
});

describe("subscribe", () => {
  it("emits the current state immediately on subscribe", () => {
    const engine = controller("inv_1", fakeApi({}), {pollMs: 999_999});
    const seen: CheckoutState[] = [];

    engine.subscribe((state) => seen.push(state));

    // A view mounting mid-flight renders from state rather than waiting for a
    // change, which is what lets a modal reopen paint the invoice at once.
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBe(engine.getState());
  });

  it("stops notifying after unsubscribe", async () => {
    const engine = controller("inv_1", fakeApi({show: async () => invoice()}), {
      pollMs: 999_999
    });

    let updates = 0;
    const unsubscribe = engine.subscribe(() => updates++);
    const atSubscribe = updates;

    unsubscribe();
    engine.start();
    await sleep(50);

    expect(atSubscribe).toBe(1);
    expect(updates).toBe(1);
  });

  it("keeps other listeners alive when one unsubscribes", async () => {
    const engine = controller("inv_1", fakeApi({show: async () => invoice()}), {
      pollMs: 999_999
    });

    let first = 0;
    let second = 0;
    const unsubscribe = engine.subscribe(() => first++);
    engine.subscribe(() => second++);

    unsubscribe();
    engine.start();
    await sleep(50);

    expect(first).toBe(1);
    expect(second).toBeGreaterThan(1);
  });
});
