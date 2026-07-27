/**
 * Dependency-free fetch client for the public checkout endpoints. Bearer-less by
 * design: the ulid in the URL is the sole capability, so requests carry no
 * credentials and no auth headers.
 */

import type {Checkout, Wallet} from "./types.js";

export class CheckoutApiError extends Error {
  constructor(
    message: string,
    /** HTTP status, or 0 for a network/transport failure. */
    readonly status: number,
    /** Field-keyed validation messages, when the server sent any. */
    readonly errors?: Record<string, string[]>,
    /** Seconds to wait, from `Retry-After`. Only the delta-seconds form is read. */
    readonly retryAfter?: number
  ) {
    super(message);
    this.name = "CheckoutApiError";
  }
}

/** A cancelled request, not a failure — an aborted fetch rejects with this name. */
export function isAbortError(error: unknown): boolean {
  return (error as Error)?.name === "AbortError";
}

interface RequestOptions {
  body?: Record<string, unknown>;
  signal?: AbortSignal;
}

/**
 * The transport seam `CheckoutController` depends on. Declared apart from the class:
 * depending on `CheckoutApi` would drag its private fields into the type, forcing
 * every substitute through a cast.
 */
export interface CheckoutApiClient {
  show(ulid: string, signal?: AbortSignal): Promise<Checkout>;
  wallets(ulid: string, signal?: AbortSignal): Promise<Wallet[]>;
  select(
    ulid: string,
    walletNetworkId: string,
    signal?: AbortSignal
  ): Promise<Checkout>;
  requote(ulid: string, signal?: AbortSignal): Promise<Checkout>;
}

export class CheckoutApi implements CheckoutApiClient {
  constructor(private readonly apiBase: string) {}

  show(ulid: string, signal?: AbortSignal): Promise<Checkout> {
    return this.request("GET", this.endpoint(ulid), {signal});
  }

  /** The payable coins with their active networks. Static per invoice. */
  wallets(ulid: string, signal?: AbortSignal): Promise<Wallet[]> {
    return this.request("GET", this.endpoint(ulid, "/wallets"), {signal});
  }

  /** Pick — or switch — the coin/network to pay with. */
  select(
    ulid: string,
    walletNetworkId: string,
    signal?: AbortSignal
  ): Promise<Checkout> {
    return this.request("POST", this.endpoint(ulid, "/select"), {
      body: {wallet_network_id: walletNetworkId},
      signal
    });
  }

  /** Refresh the rate lock on the active payment. */
  requote(ulid: string, signal?: AbortSignal): Promise<Checkout> {
    return this.request("POST", this.endpoint(ulid, "/requote"), {signal});
  }

  private endpoint(ulid: string, suffix = ""): string {
    return `/checkout/${encodeURIComponent(ulid)}${suffix}`;
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    {body, signal}: RequestOptions
  ): Promise<T> {
    const headers: Record<string, string> = {Accept: "application/json"};

    if (body) {
      headers["Content-Type"] = "application/json";
    }

    let response: Response;

    try {
      response = await fetch(`${this.apiBase}${path}`, {
        method,
        credentials: "omit",
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal
      });
    } catch (error) {
      // Aborts propagate unwrapped: this is the controller's only signal that a
      // request was superseded rather than failed.
      if (isAbortError(error)) {
        throw error;
      }

      throw new CheckoutApiError(
        (error as Error)?.message ?? "Network error",
        0
      );
    }

    if (!response.ok) {
      throw await failureFor(response);
    }

    // A 2xx whose body is not JSON (a proxy's HTML interstitial) would otherwise
    // reject with a bare SyntaxError that callers read an undefined `status` off.
    try {
      return (await response.json()) as T;
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }

      throw new CheckoutApiError(
        "The server returned a response that could not be read.",
        response.status
      );
    }
  }
}

/**
 * The error for a non-2xx. A 422's `{message, errors}` is the only text that can tell
 * a payer why their selection was rejected, so it wins over the bare status.
 */
async function failureFor(response: Response): Promise<CheckoutApiError> {
  const seconds = Number(response.headers.get("Retry-After"));
  const retryAfter =
    Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;

  let message = `Request failed with status ${response.status}`;
  let errors: Record<string, string[]> | undefined;

  try {
    const body: unknown = await response.json();

    if (body && typeof body === "object") {
      const payload = body as {message?: unknown; errors?: unknown};

      if (typeof payload.message === "string" && payload.message) {
        message = payload.message;
      }

      if (payload.errors && typeof payload.errors === "object") {
        errors = payload.errors as Record<string, string[]>;
      }
    }
  } catch {
    // A non-JSON error body is fine — the status-based message stands.
  }

  return new CheckoutApiError(message, response.status, errors, retryAfter);
}
