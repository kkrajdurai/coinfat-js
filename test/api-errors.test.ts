/**
 * The CheckoutApiError contract: the payer-facing message, the validation detail and
 * how long to wait all arrive on this one error.
 */

import {afterEach, describe, expect, it, vi} from "vitest";
import {CheckoutApi, CheckoutApiError} from "../src/core/api.js";
import {CheckoutController} from "../src/core/checkout.js";
import {fakeApi, response, sleep} from "./helpers.js";

const api = () => new CheckoutApi("https://test-api.example/api/v1");

afterEach(() => vi.unstubAllGlobals());

describe("failure shape", () => {
  it("wraps a 2xx with a non-JSON body instead of leaking a SyntaxError", async () => {
    // A corporate proxy or WAF answering 200 with an HTML interstitial.
    vi.stubGlobal("fetch", async () =>
      response("<html>Blocked</html>", {
        status: 200,
        headers: {"Content-Type": "text/html"}
      })
    );

    // The controller casts whatever it catches to CheckoutApiError, so a bare
    // SyntaxError would leave it reading an undefined `status`.
    await expect(api().show("inv_1")).rejects.toBeInstanceOf(CheckoutApiError);
  });

  it("keeps the server's message and field errors from a 422", async () => {
    vi.stubGlobal("fetch", async () =>
      response(
        JSON.stringify({
          message: "This invoice is no longer accepting payments.",
          errors: {wallet_network_id: ["The selected network is unavailable."]}
        }),
        {status: 422}
      )
    );

    // Without this the payer only ever learns "Request failed with status 422".
    await expect(api().select("inv_1", "btc-net-1")).rejects.toMatchObject({
      status: 422,
      message: "This invoice is no longer accepting payments.",
      errors: {wallet_network_id: ["The selected network is unavailable."]}
    });
  });

  it("reads Retry-After off a 429", async () => {
    vi.stubGlobal("fetch", async () =>
      response(JSON.stringify({message: "Too Many Requests"}), {
        status: 429,
        headers: {"Retry-After": "30"}
      })
    );

    await expect(api().show("inv_1")).rejects.toMatchObject({
      status: 429,
      retryAfter: 30
    });
  });

  it("falls back to the status when the error body is not JSON", async () => {
    vi.stubGlobal("fetch", async () =>
      response("<html>Bad Gateway</html>", {status: 502})
    );

    await expect(api().show("inv_1")).rejects.toMatchObject({
      status: 502,
      message: "Request failed with status 502"
    });
  });
});

describe("backoff", () => {
  it("never polls sooner than Retry-After allows", async () => {
    let shows = 0;
    const engine = new CheckoutController(
      "inv_1",
      fakeApi({
        show: async () => {
          shows++;
          throw new CheckoutApiError("Too Many Requests", 429, undefined, 1);
        }
      }),
      {pollMs: 20} // would otherwise poll ~20 times in the window below
    );

    engine.start();
    await sleep(400);
    engine.stop();

    expect(shows).toBe(1);
  });
});
