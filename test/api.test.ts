/**
 * Transport-level behaviour of the fetch client, separate from the error-body
 * contract covered in api-errors.test.ts.
 */

import {afterEach, describe, expect, it, vi} from "vitest";
import {CheckoutApi, CheckoutApiError, isAbortError} from "../src/core/api.js";
import {abortError, invoice, response} from "./helpers.js";

const api = () => new CheckoutApi("https://test-api.example/api/v1");

afterEach(() => vi.unstubAllGlobals());

describe("requests", () => {
  it("sends no credentials — the ulid in the URL is the only capability", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      response(JSON.stringify(invoice()))
    );
    vi.stubGlobal("fetch", fetchMock);

    await api().show("inv_1");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://test-api.example/api/v1/checkout/inv_1");
    // Cookies on a third-party embed would be both useless and a privacy problem.
    expect(init.credentials).toBe("omit");
    expect(init.headers).not.toHaveProperty("Authorization");
  });

  it("percent-encodes the ulid into the path", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      response(JSON.stringify(invoice()))
    );
    vi.stubGlobal("fetch", fetchMock);

    await api().select("inv/1?x", "btc-net-1");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "https://test-api.example/api/v1/checkout/inv%2F1%3Fx/select"
    );
    expect(init.body).toBe(JSON.stringify({wallet_network_id: "btc-net-1"}));
  });
});

describe("failures", () => {
  it("reports a 404 with its status so the widget can stop polling", async () => {
    vi.stubGlobal("fetch", async () =>
      response(JSON.stringify({message: "No query results."}), {status: 404})
    );

    await expect(api().show("missing")).rejects.toMatchObject({
      status: 404,
      message: "No query results."
    });
  });

  it("turns a transport failure into status 0", async () => {
    // DNS failure, offline, blocked by CORS — fetch rejects with a TypeError.
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("Failed to fetch");
    });

    const error = await api()
      .show("inv_1")
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(CheckoutApiError);
    expect(error).toMatchObject({status: 0, message: "Failed to fetch"});
  });

  it("lets an AbortError through unwrapped", async () => {
    vi.stubGlobal("fetch", async () => {
      throw abortError();
    });

    const error = await api()
      .show("inv_1")
      .catch((caught: unknown) => caught);

    // The controller tells "superseded by a newer request" from a real failure
    // purely by this. Rewrapping would make every aborted poll look like an error,
    // inflate the backoff, and fire onError.
    expect(isAbortError(error)).toBe(true);
    expect(error).not.toBeInstanceOf(CheckoutApiError);
  });
});
