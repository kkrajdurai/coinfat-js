import type {ComponentChild} from "preact";
import type {CheckoutApiError} from "../core/api.js";
import type {CheckoutController, CheckoutState} from "../core/checkout.js";
import type {WidgetLayout} from "../core/options.js";
import {
  TERMINAL_STATUSES,
  type Checkout as Invoice,
  type StoreInvoiceStatus,
  type Wallet
} from "../core/types.js";
import {CoinSelect, useCoinSwitch} from "./CoinSelect.js";
import {formatMoney} from "./format.js";
import {PayPanel} from "./PayPanel.js";
import {Terminal, terminalMessage} from "./Terminal.js";
import {useCheckoutState} from "./useCheckout.js";
import type {CheckoutStrings} from "./strings/index.js";
import {useI18n, useStrings} from "./strings/context.js";

export interface CheckoutProps {
  controller: CheckoutController;
  layout: WidgetLayout;
  /** Rendered as a close affordance in the modal presenter. */
  onRequestClose?: () => void;
}

/** Every top-level view is the same card; only what sits inside it differs. */
const CARD = "rounded-2xl border border-border bg-card p-5";

export function Checkout({controller, layout, onRequestClose}: CheckoutProps) {
  const state = useCheckoutState(controller);

  return (
    <div class="cf-checkout @container w-full" data-layout={layout}>
      {renderBody(state, controller, layout, onRequestClose)}
    </div>
  );
}

/**
 * Order matters: the skeleton owns the first load, a 404 is final, and once an
 * invoice has arrived it keeps the screen even if a later poll fails — the
 * controller is backing off and will recover.
 */
function renderBody(
  state: CheckoutState,
  controller: CheckoutController,
  layout: WidgetLayout,
  onRequestClose?: () => void
): ComponentChild {
  if (state.isLoading) return <Skeleton />;
  if (state.notFound) return <NotFound />;

  if (state.invoice) {
    return (
      <InvoiceCard
        invoice={state.invoice}
        error={state.error}
        wallets={state.wallets}
        walletsError={state.walletsError}
        mutating={state.mutating}
        layout={layout}
        controller={controller}
        onRequestClose={onRequestClose}
      />
    );
  }

  // The first load failed — a 500, a 429, CORS, an offline payer. Without this the
  // merchant's slot sits blank while the controller retries in silence.
  return state.error ? (
    <LoadError onRetry={() => void controller.refetch()} />
  ) : null;
}

function InvoiceCard({
  invoice,
  error,
  wallets,
  walletsError,
  mutating,
  layout,
  controller,
  onRequestClose
}: {
  invoice: Invoice;
  error: CheckoutApiError | null;
  wallets: Wallet[] | null;
  walletsError: CheckoutApiError | null;
  mutating: boolean;
  layout: WidgetLayout;
  controller: CheckoutController;
  onRequestClose?: () => void;
}) {
  const {locale, strings} = useI18n();
  const {store, active_payment: payment} = invoice;
  // Terminal invoices keep their `active_payment`. Without this gate a settled invoice
  // still shows a live deposit address and QR, and a payer reloading the link sends a
  // second transfer.
  const settled = TERMINAL_STATUSES.has(invoice.status);

  const {picking, canSwitch, selectedNetworkId, startSwitch, cancelSwitch} =
    useCoinSwitch(payment, wallets);

  return (
    <div class={`${CARD} text-card-foreground shadow-xl shadow-primary/5`}>
      <header class="flex items-center justify-between gap-3">
        <div class="flex items-center gap-2 min-w-0">
          {store.logo?.url ? (
            <img src={store.logo.url} alt="" class="size-6 rounded" />
          ) : null}
          <span class="truncate text-sm font-medium text-muted-foreground">
            {store.name}
          </span>
        </div>
        <StatusBadge status={invoice.status} />
      </header>

      <p
        // Failed coin taps and failing polls. Mounted unconditionally — see PayPanel.
        role="status"
        class={
          error
            ? "mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive"
            : "sr-only"
        }>
        {error ? errorMessage(error, strings) : ""}
      </p>

      <p
        // Always mounted so the poll transition into a terminal state is announced —
        // the visible message lives in <Terminal>, which mounts too late to announce.
        role="status"
        class="sr-only">
        {settled ? terminalMessage(invoice.status, strings) : ""}
      </p>

      {settled ? (
        <Terminal invoice={invoice} />
      ) : (
        <>
          <div class="mt-4">
            <p class="text-xs text-muted-foreground">{strings.amountDue}</p>
            <p class="font-heading text-3xl font-semibold tracking-tight">
              {formatMoney(invoice.amount, locale)}
            </p>
          </div>

          {picking ? (
            <CoinSelect
              controller={controller}
              wallets={wallets}
              walletsError={walletsError}
              mutating={mutating}
              selectedNetworkId={selectedNetworkId}
              onCancel={payment ? cancelSwitch : undefined}
            />
          ) : payment ? (
            <PayPanel
              payment={payment}
              controller={controller}
              mutating={mutating}
              layout={layout}
              onChangeCoin={canSwitch ? startSwitch : undefined}
            />
          ) : null}
        </>
      )}

      {onRequestClose ? (
        <button
          type="button"
          class="mt-4 inline-flex rounded-md px-1 py-0.5 text-xs text-muted-foreground underline-offset-2 transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={onRequestClose}>
          {strings.close}
        </button>
      ) : null}
    </div>
  );
}

/**
 * A 4xx carries a message written for the payer ("This invoice is no longer accepting
 * payments"). A 5xx or a transport failure (status 0) has nothing worth quoting, and
 * those are the cases the poll retries anyway.
 */
function errorMessage(
  error: CheckoutApiError,
  strings: CheckoutStrings
): string {
  const {status} = error;

  return status >= 400 && status < 500 && error.message
    ? error.message
    : strings.networkError;
}

// Per status: the pulse means "still working", so leaving it on a canceled invoice
// reads as in-progress and a paid one deserves to look settled.
const STATUS_STYLE: Record<StoreInvoiceStatus, {chip: string; dot: string}> = {
  pending: {
    chip: "bg-primary/10 text-primary",
    dot: "bg-primary animate-pulse"
  },
  completed: {chip: "bg-success/10 text-success", dot: "bg-success"},
  expired: {chip: "bg-muted text-muted-foreground", dot: "bg-muted-foreground"},
  canceled: {chip: "bg-muted text-muted-foreground", dot: "bg-muted-foreground"}
};

function StatusBadge({status}: {status: StoreInvoiceStatus}) {
  const strings = useStrings();
  const style = STATUS_STYLE[status];

  return (
    <span
      class={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${style.chip}`}>
      <span class={`size-1.5 rounded-full ${style.dot}`} />
      {strings.status[status]}
    </span>
  );
}

function Skeleton() {
  return (
    <div class={CARD} aria-busy="true">
      <div class="h-4 w-24 animate-pulse rounded bg-muted" />
      <div class="mt-4 h-8 w-32 animate-pulse rounded bg-muted" />
      <div class="mt-4 h-20 w-full animate-pulse rounded-xl bg-muted" />
    </div>
  );
}

/** Shared chrome for the states that have nothing to render but a message. */
function MessageCard({
  title,
  detail,
  children
}: {
  title: string;
  detail: string;
  children?: ComponentChild;
}) {
  return (
    <div class={`${CARD} text-center`}>
      <p class="text-sm font-medium">{title}</p>
      <p class="mt-1 text-xs text-muted-foreground">{detail}</p>
      {children}
    </div>
  );
}

function LoadError({onRetry}: {onRetry: () => void}) {
  const strings = useStrings();

  return (
    <MessageCard
      title={strings.loadErrorTitle}
      detail={strings.loadErrorDetail}>
      <button
        type="button"
        class="mt-3 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
        onClick={onRetry}>
        {strings.retry}
      </button>
    </MessageCard>
  );
}

function NotFound() {
  const strings = useStrings();

  return (
    <MessageCard
      title={strings.notFoundTitle}
      detail={strings.notFoundDetail}
    />
  );
}
