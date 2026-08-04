/** Transport behaviour of the fetch client; the error body is api-errors.test.ts. */

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

  it("PUTs the payer's notification address, still credential-less", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      response(JSON.stringify(invoice({payer_email: "j***@example.com"})))
    );
    vi.stubGlobal("fetch", fetchMock);

    await api().setPayerEmail("inv_1", "jane.doe@example.com");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "https://test-api.example/api/v1/checkout/inv_1/payer-email"
    );
    expect(init.method).toBe("PUT");
    expect(init.body).toBe(JSON.stringify({email: "jane.doe@example.com"}));
    // The address is the payer's, but the invoice ulid is still the only capability.
    expect(init.credentials).toBe("omit");
    expect(init.headers).not.toHaveProperty("Authorization");
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

    // Rewrapping would make every aborted poll look like a real failure: inflated
    // backoff, and a spurious onError.
    expect(isAbortError(error)).toBe(true);
    expect(error).not.toBeInstanceOf(CheckoutApiError);
  });
});
