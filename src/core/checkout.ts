/**
 * Framework-neutral checkout state engine: fetch the invoice, poll until a terminal
 * status, and expose `select`/`requote`. Free of Preact so it can back any view.
 */

import {
  isAbortError,
  type CheckoutApiClient,
  type CheckoutApiError
} from "./api.js";
import {BRAND} from "./brand.js";
import type {CheckoutCallbacks} from "./options.js";
import {
  TERMINAL_STATUSES,
  type Checkout,
  type StoreInvoiceStatus,
  type Wallet
} from "./types.js";

const DEFAULT_POLL_MS = 8000;
const MAX_BACKOFF_MS = 60000;

export interface CheckoutState {
  invoice: Checkout | null;
  /**
   * The picker's data source: payable coins with their active networks. Null until
   * the one-off fetch lands, or if it failed — `loadWallets()` retries. Not
   * `invoice.supported_wallets`, which carries no networks.
   */
  wallets: Wallet[] | null;
  walletsError: CheckoutApiError | null;
  isLoading: boolean;
  notFound: boolean;
  error: CheckoutApiError | null;
  /** completed / expired / canceled. */
  isTerminal: boolean;
  /** A `select()` or `requote()` is in flight. One flag: they supersede each other. */
  mutating: boolean;
  /**
   * A `setPayerEmail()` is in flight. Deliberately NOT `mutating`: that flag means "the
   * payment is being re-quoted", and it drives the picker's and the refresh button's
   * busy states. Signing up for a notification changes neither.
   */
  savingEmail: boolean;
  /**
   * Why the last `setPayerEmail()` failed. Its own field for the same reason `wallets`
   * has `walletsError`: this one belongs under the input the payer typed into, while
   * `error` paints a banner across the top of the card and re-arms `onError`.
   */
  emailError: CheckoutApiError | null;
}

export type CheckoutListener = (state: CheckoutState) => void;

export interface CheckoutControllerOptions {
  pollMs?: number;
  /**
   * Merchant lifecycle callbacks. Owned here rather than by the view so each
   * transition fires once per invoice: a modal reopen builds a fresh component
   * tree, which would otherwise replay `onReady`/`onCompleted` and any
   * `redirectOnComplete` navigation with it.
   */
  callbacks?: CheckoutCallbacks;
}

export class CheckoutController {
  private state: CheckoutState = {
    invoice: null,
    wallets: null,
    walletsError: null,
    isLoading: true,
    notFound: false,
    error: null,
    isTerminal: false,
    mutating: false,
    savingEmail: false,
    emailError: null
  };

  private readonly listeners = new Set<CheckoutListener>();
  private readonly pollMs: number;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private abort: AbortController | null = null;
  /** Separate from `abort` so the one-off wallets fetch is never cancelled by a poll. */
  private walletsAbort: AbortController | null = null;
  /**
   * Likewise separate: signing up for a notification neither supersedes nor is
   * superseded by a coin switch, so the two must not share `abort`.
   */
  private emailAbort: AbortController | null = null;
  /** The last notification address reported, masked. See `withPayerEmail`. */
  private payerEmail: string | null = null;
  private started = false;
  /** Consecutive failed fetches, used to back off polling (and 429s). */
  private errorStreak = 0;
  /**
   * Bumped by every mutation. One whose sequence no longer matches is superseded and
   * MUST NOT apply its response — two fast coin taps could otherwise resolve out of
   * order and show the address for the network nobody chose.
   */
  private mutationSeq = 0;
  private readonly callbacks: CheckoutCallbacks;
  /** Transitions already reported, so each callback fires once. */
  private readonly seen = {
    ready: false,
    errored: false,
    selection: null as string | null,
    detected: false,
    status: null as StoreInvoiceStatus | null
  };

  constructor(
    private readonly ulid: string,
    private readonly api: CheckoutApiClient,
    options: CheckoutControllerOptions = {}
  ) {
    this.pollMs = options.pollMs ?? DEFAULT_POLL_MS;
    this.callbacks = options.callbacks ?? {};
  }

  getState(): CheckoutState {
    return this.state;
  }

  subscribe(listener: CheckoutListener): () => void {
    this.listeners.add(listener);
    listener(this.state);

    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Idempotent. */
  start(): void {
    if (this.started) {
      return;
    }

    this.started = true;
    void this.refetch();
    void this.loadWallets();
  }

  stop(): void {
    this.started = false;
    this.clearPoll();
    this.abort?.abort();
    this.abort = null;
    this.walletsAbort?.abort();
    this.walletsAbort = null;
    this.emailAbort?.abort();
    this.emailAbort = null;

    // Both in-flight flags are owned by the call that set them, and an aborted call
    // returns without clearing its own — whoever superseded it is still running and will.
    // A teardown supersedes without a successor, so it has to clear them here or a modal
    // closed mid-request reopens (same controller: close -> stop, open -> start) with a
    // spinner that never stops.
    if (this.state.mutating || this.state.savingEmail) {
      this.patch({mutating: false, savingEmail: false});
    }
  }

  /**
   * Fetch the payable coins + networks. Runs once from `start()`; public so the UI
   * can retry after a failure. Never polled.
   */
  async loadWallets(): Promise<void> {
    // Static per invoice, so nothing to refetch once it has landed — which is also
    // what stops a modal reopen (close() -> stop(), open() -> start()) refiring it.
    if (this.state.wallets) {
      return;
    }

    this.walletsAbort?.abort();
    const controller = new AbortController();
    this.walletsAbort = controller;

    try {
      const wallets = await this.api.wallets(this.ulid, controller.signal);
      this.patch({wallets, walletsError: null});
    } catch (error) {
      if (!isAbortError(error)) {
        this.patch({walletsError: error as CheckoutApiError});
      }
    }
  }

  async refetch(): Promise<void> {
    this.clearPoll();
    this.abort?.abort();
    const controller = new AbortController();
    this.abort = controller;

    try {
      const invoice = await this.api.show(this.ulid, controller.signal);
      this.errorStreak = 0;
      this.applyInvoice(invoice);
    } catch (error) {
      // A newer fetch (or stop()) superseded this one, and owns the next schedule.
      if (isAbortError(error)) {
        return;
      }

      const apiError = error as CheckoutApiError;
      this.errorStreak++;
      this.patch({
        isLoading: false,
        error: apiError,
        notFound: !this.state.invoice && apiError.status === 404
      });
    }

    this.schedulePoll();
  }

  async select(walletNetworkId: string): Promise<void> {
    return this.mutate((signal) =>
      this.api.select(this.ulid, walletNetworkId, signal)
    );
  }

  async requote(): Promise<void> {
    return this.mutate((signal) => this.api.requote(this.ulid, signal));
  }

  /**
   * Sign the payer up to be emailed when this invoice completes.
   *
   * Deliberately NOT routed through `mutate()`, which exists to serialise the two calls
   * that re-quote the payment: it aborts whatever is in flight and bumps the mutation
   * sequence, so an address submitted mid-switch would cancel the switch — and it raises
   * `mutating`, which spins the picker and the refresh-rate button. This supersedes
   * nothing and is superseded by nothing, so it gets its own handle and its own flags.
   *
   * Like the mutations, it never rejects: it is called from a click handler, so a
   * rejection would surface as an unhandledrejection on the merchant's page.
   */
  async setPayerEmail(email: string): Promise<void> {
    // The backend 422s a settled invoice, and the view can be a poll behind. Nothing
    // useful to tell the payer about a checkout that is already over.
    if (this.state.isTerminal) {
      return;
    }

    this.emailAbort?.abort();
    const controller = new AbortController();
    this.emailAbort = controller;
    this.patch({savingEmail: true, emailError: null});

    try {
      const invoice = await this.api.setPayerEmail(
        this.ulid,
        email,
        controller.signal
      );

      // Superseded by a newer submission, or torn down. Not ours to apply.
      if (this.emailAbort !== controller) {
        return;
      }

      // Only the one field, though the response is a whole Checkout the handoff invites
      // us to swap in wholesale. That body was serialised before any concurrent
      // select/requote landed, so applying it entire can resurrect the payment the payer
      // just switched away from. This endpoint is authoritative about `payer_email` and
      // nothing else.
      const current = this.state.invoice;
      this.rememberPayerEmail(invoice.payer_email);

      if (current) {
        this.patch({
          invoice: {...current, payer_email: invoice.payer_email},
          emailError: null
        });
      }
    } catch (error) {
      if (isAbortError(error) || this.emailAbort !== controller) {
        return;
      }

      this.patch({emailError: error as CheckoutApiError});
    } finally {
      if (this.emailAbort === controller) {
        this.emailAbort = null;
        this.patch({savingEmail: false});
      }
    }
  }

  /** Run a select/requote in isolation from the poll loop, then resume polling. */
  private async mutate(
    call: (signal: AbortSignal) => Promise<Checkout>
  ): Promise<void> {
    // The backend 422s both on a settled invoice, and a stale view can still POST.
    // Surfacing that to the payer as an error on a finished invoice is noise.
    if (this.state.isTerminal) {
      return;
    }

    // Suspend the poll so an in-flight GET can't resolve after this mutation and
    // clobber the fresh invoice, and abort whatever was in flight — an earlier
    // mutation included, so a slow first pick can't overwrite a fast second.
    this.clearPoll();
    this.abort?.abort();
    const controller = new AbortController();
    this.abort = controller;
    const seq = ++this.mutationSeq;
    this.patch({mutating: true});

    try {
      const invoice = await call(controller.signal);
      // Belt and braces: a response that raced past its own abort must still not be
      // applied.
      if (this.isSuperseded(seq)) {
        return;
      }

      this.errorStreak = 0;
      this.applyInvoice(invoice);
    } catch (error) {
      // A superseded (or torn-down) mutation is not a failure the payer should
      // see, and whoever superseded it owns the next schedule.
      if (isAbortError(error) || this.isSuperseded(seq)) {
        return;
      }

      // Reported through state, never by rejecting: `select`/`requote` are called
      // fire-and-forget from click handlers and timers, so a rejection would land
      // as an unhandledrejection on the merchant's page.
      this.patch({error: error as CheckoutApiError});
    } finally {
      // Only drop the shared handle if it is still ours: a concurrent refetch()
      // installs its own controller without bumping the mutation sequence, and
      // nulling that would leave its request uncancellable by stop().
      if (this.abort === controller) {
        this.abort = null;
      }

      // A superseded mutation owns neither the flag nor the schedule: whoever
      // superseded it is still running and clears both when it settles.
      if (!this.isSuperseded(seq)) {
        this.patch({mutating: false});
        this.schedulePoll();
      }
    }
  }

  private isSuperseded(seq: number): boolean {
    return seq !== this.mutationSeq;
  }

  private applyInvoice(invoice: Checkout): void {
    this.patch({
      invoice: this.withPayerEmail(invoice),
      isLoading: false,
      notFound: false,
      error: null,
      isTerminal: TERMINAL_STATUSES.has(invoice.status)
    });
  }

  private rememberPayerEmail(masked: string | null): void {
    if (masked) {
      this.payerEmail = masked;
    }
  }

  /**
   * Keep a notification address the invoice has already reported.
   *
   * `payer_email` only ever goes null -> mask -> another mask; the backend offers no way
   * to remove one. But `setPayerEmail` deliberately runs beside the poll rather than
   * suspending it, so a GET serialised BEFORE a successful PUT can land after it — and
   * that body still says null. Without this, the confirmation the payer is reading flips
   * back to "Email me when this payment confirms" until the next poll, which reads as the
   * address having been lost and invites a pointless second submission.
   */
  private withPayerEmail(invoice: Checkout): Checkout {
    this.rememberPayerEmail(invoice.payer_email);

    return invoice.payer_email || !this.payerEmail
      ? invoice
      : {...invoice, payer_email: this.payerEmail};
  }

  private schedulePoll(): void {
    // Two completion paths can land here at once — a mutation's `finally` and the
    // refetch() that aborted it. Without this the first timer handle is orphaned:
    // uncancellable by stop(), still firing, doubling the rate against a throttled API.
    this.clearPoll();

    // A terminal invoice and a genuine not-found will never change. Transient
    // errors keep polling, with exponential backoff.
    if (!this.started || this.state.isTerminal || this.state.notFound) {
      return;
    }

    const backoff =
      this.errorStreak > 0
        ? Math.min(this.pollMs * 2 ** this.errorStreak, MAX_BACKOFF_MS)
        : this.pollMs;

    // Never come back sooner than the server asked: a 429's Retry-After knows the
    // throttle window better than the exponential guess, so it raises the floor,
    // uncapped.
    const hint = this.state.error?.retryAfter;
    const delay = hint ? Math.max(hint * 1000, backoff) : backoff;

    this.pollTimer = setTimeout(() => {
      void this.refetch();
    }, delay);
  }

  private clearPoll(): void {
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private patch(partial: Partial<CheckoutState>): void {
    this.state = {...this.state, ...partial};
    this.listeners.forEach((listener) => listener(this.state));
    this.emitLifecycle();
  }

  /**
   * Merchant handlers are arbitrary code, and `refetch`/`mutate` would otherwise catch
   * a throw as ours: blaming the payer's invoice for the merchant's bug, and rejecting
   * the fire-and-forget `select()`/`requote()`.
   */
  private emit<T>(callback: ((arg: T) => void) | undefined, arg: T): void {
    try {
      callback?.(arg);
    } catch (error) {
      console.error(`${BRAND.slug}: a checkout callback threw`, error);
    }
  }

  /**
   * Fire the merchant's callbacks for whatever changed. Every branch is guarded by
   * `seen`, so running this after each patch is safe and a re-entrant callback
   * cannot loop.
   */
  private emitLifecycle(): void {
    const cb = this.callbacks;
    const {invoice, error} = this.state;

    // Re-arm onError once a subsequent good state clears the error.
    if (error) {
      if (!this.seen.errored) {
        this.seen.errored = true;
        this.emit(cb.onError, error);
      }
    } else {
      this.seen.errored = false;
    }

    if (!invoice) {
      return;
    }

    const firstInvoice = !this.seen.ready;

    if (firstInvoice) {
      this.seen.ready = true;
      this.emit(cb.onReady, invoice);
    }

    const payment = invoice.active_payment;

    // Keyed on the network as well as the payment: the backend keeps one payment
    // row per COIN and re-points it on a switch, so an intra-coin network change
    // keeps the same ulid and would otherwise go unreported.
    const selection = payment
      ? `${payment.ulid}:${payment.wallet_network?.id ?? ""}`
      : null;

    if (selection && selection !== this.seen.selection) {
      this.seen.selection = selection;

      // A payment already present on the very first invoice was fixed server-side
      // by the merchant's `pay_with`, not chosen by the payer here.
      if (!firstInvoice) {
        this.emit(cb.onCoinSelected, invoice);
      }
    }

    if (payment?.detected_at && !this.seen.detected) {
      this.seen.detected = true;
      this.emit(cb.onPaymentDetected, invoice);
    }

    if (invoice.status !== this.seen.status) {
      this.seen.status = invoice.status;
      if (invoice.status === "completed") this.emit(cb.onCompleted, invoice);
      else if (invoice.status === "expired") this.emit(cb.onExpired, invoice);
      else if (invoice.status === "canceled") this.emit(cb.onCanceled, invoice);
    }
  }
}
