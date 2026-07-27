/**
 * Shared fakes for the core-engine tests. The engine's hard parts are all ordering, so
 * these reject the instant their signal aborts, exactly as `fetch` does — a fake that
 * only checks `signal.aborted` after its delay silently passes tests that should fail.
 */

import type {CheckoutApiClient} from "../src/core/api.js";
import type {Checkout, StoreInvoicePayment} from "../src/core/types.js";

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export function abortError(): Error {
  const error = new Error("The operation was aborted.");
  error.name = "AbortError";
  return error;
}

/** Resolves after `ms`, or rejects the moment `signal` aborts. */
export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }

    const timer = setTimeout(resolve, ms);

    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(abortError());
      },
      {once: true}
    );
  });
}

export function invoice(over: Partial<Checkout> = {}): Checkout {
  return {
    ulid: "inv_1",
    status: "pending",
    store: {name: "Acme"},
    currency: {code: "USD"},
    amount: {amount: "10", currency: "USD", scale: 2},
    supported_wallets: [],
    active_payment: null,
    success_url: "https://merchant.test/thanks",
    cancel_url: null,
    expires_at: "",
    created_at: "",
    updated_at: "",
    ...over
  } as Checkout;
}

/** A payment row. `networkId` is what a coin switch changes; `ulid` often is not. */
export function payment(ulid: string, networkId?: string): StoreInvoicePayment {
  return {
    ulid,
    wallet_network: networkId ? {id: networkId} : null,
    address: `addr_${networkId ?? ulid}`,
    detected_at: null
  } as unknown as StoreInvoicePayment;
}

/** A stand-in transport. Structural, so no cast: see `CheckoutApiClient`. */
export function fakeApi(parts: Partial<CheckoutApiClient>): CheckoutApiClient {
  return {
    show: async () => invoice(),
    wallets: async () => [],
    select: async () => invoice(),
    requote: async () => invoice(),
    ...parts
  };
}

/**
 * A stand-in for `Response` covering what `CheckoutApi.request` touches. Hand-built so
 * `json()` throws a real SyntaxError on a non-JSON body, which is the case under test.
 */
export function response(
  body: string,
  init: {status?: number; headers?: Record<string, string>} = {}
): Response {
  const status = init.status ?? 200;
  const headers = new Map(
    Object.entries(init.headers ?? {}).map(([key, value]) => [
      key.toLowerCase(),
      value
    ])
  );

  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {get: (name: string) => headers.get(name.toLowerCase()) ?? null},
    json: async () => JSON.parse(body) as unknown
  } as unknown as Response;
}
