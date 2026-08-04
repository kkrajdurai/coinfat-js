import type {ComponentChild} from "preact";
import {useRef, useState} from "preact/hooks";
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
import {Faq, faqContext, faqEntries} from "./Faq.js";
import {CloseIcon, HelpIcon} from "./primitives.js";
import {formatMoney} from "./format.js";
import {PayPanel} from "./PayPanel.js";
import {Terminal, terminalMessage} from "./Terminal.js";
import {useCheckoutState} from "./useCheckout.js";
import type {CheckoutStrings} from "./strings/index.js";
import {useI18n, useStrings} from "./strings/context.js";
import {useCloseRequest} from "./Modal.js";

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
        savingEmail={state.savingEmail}
        emailError={state.emailError}
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
  savingEmail,
  emailError,
  layout,
  controller,
  onRequestClose
}: {
  invoice: Invoice;
  error: CheckoutApiError | null;
  wallets: Wallet[] | null;
  walletsError: CheckoutApiError | null;
  mutating: boolean;
  savingEmail: boolean;
  emailError: CheckoutApiError | null;
  layout: WidgetLayout;
  controller: CheckoutController;
  onRequestClose?: () => void;
}) {
  const strings = useStrings();
  const requestClose = useCloseRequest();
  const [faqOpen, setFaqOpen] = useState(false);
  // The trigger stays mounted while the FAQ is up — it is the toggle — so closing from
  // inside the FAQ can hand focus straight back to it, with no effect to sequence.
  const helpRef = useRef<HTMLButtonElement>(null);
  const {store, active_payment: payment} = invoice;
  // Terminal invoices keep their `active_payment`. Without this gate a settled invoice
  // still shows a live deposit address and QR, and a payer reloading the link sends a
  // second transfer.
  const settled = TERMINAL_STATUSES.has(invoice.status);

  const {picking, canSwitch, selectedNetworkId, startSwitch, cancelSwitch} =
    useCoinSwitch(payment, wallets);

  // Offered on terminal invoices too: "my payment wasn't credited" and "I never got
  // what I paid for" are asked after the checkout is over, not during it.
  const context = faqContext(invoice);
  const entries = faqEntries(strings, context);

  const closeFaq = () => {
    setFaqOpen(false);
    helpRef.current?.focus();
  };

  // Escape backs out of the FAQ rather than out of the checkout. Bound at the CARD, not
  // inside the FAQ: the header — trigger and close button both — is the FAQ's sibling,
  // so a key pressed there would bubble straight past it to the modal's handler and
  // raise the close prompt instead. Stopped only while the FAQ is showing, and only for
  // Escape: that same handler is the modal's Tab focus trap.
  const onKeyDown = (event: KeyboardEvent) => {
    if (faqOpen && event.key === "Escape") {
      event.stopPropagation();
      closeFaq();
    }
  };

  return (
    <div
      class={`${CARD} text-card-foreground shadow-xl shadow-primary/5`}
      onKeyDown={onKeyDown}>
      <header class="flex items-center justify-between gap-3">
        <div class="flex items-center gap-2 min-w-0">
          {store.logo?.url ? (
            <img src={store.logo.url} alt="" class="size-6 rounded" />
          ) : null}
          <span class="truncate text-sm font-medium text-muted-foreground">
            {store.name}
          </span>
        </div>
        <div
          // NOT `shrink-0`: with a status word, a help trigger and a close button on
          // it, this cluster's natural width can exceed the whole card in a slot narrow
          // enough, and an unshrinkable cluster pushes the card out of its container
          // rather than giving way. The badge absorbs it; the two icons never shrink.
          //
          // Shrinking at the default factor, NOT a fractional one: weighting the squeeze
          // onto the store name reads better at 300px, but at the widths the deposit-
          // address sweep covers the name cannot give up enough on its own, and the card
          // overflowed its slot by up to 12px again.
          class="flex min-w-0 items-center gap-1.5">
          <StatusBadge status={invoice.status} />
          {entries.length > 0 ? (
            <button
              ref={helpRef}
              type="button"
              aria-label={strings.faqOpen}
              aria-expanded={faqOpen}
              onClick={() => setFaqOpen((open) => !open)}
              class={`inline-flex shrink-0 rounded-md p-1 transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                faqOpen ? "bg-muted text-foreground" : "text-muted-foreground"
              }`}>
              <HelpIcon />
            </button>
          ) : null}
          {onRequestClose ? (
            <button
              type="button"
              aria-label={strings.close}
              // Where a payer looks for it, and it costs no row of its own — the
              // footer strip it used to occupy was mostly empty space. Inside a modal
              // this is the guarded close, so the warning cannot be walked past by
              // using the card's own exit instead of the backdrop.
              onClick={requestClose ?? onRequestClose}
              class="-me-1 inline-flex shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <CloseIcon />
            </button>
          ) : null}
        </div>
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

      <div
        // Hidden, not unmounted, for the reason the modal hides the card behind its
        // close prompt: a running rate lock and a half-made coin switch survive the
        // detour. The live regions above stay outside it, so a poll landing while the
        // FAQ is open is still announced.
        class={faqOpen ? "hidden" : undefined}>
        {settled ? (
          <Terminal invoice={invoice} />
        ) : (
          <>
            <div
              // Hidden once the pay panel splits in two, where it renders its own copy
              // at the top of the details column — otherwise it sits full-width above
              // the split with an empty half-card beside it. Duplicated and
              // container-queried rather than moved, so the stacked order stays
              // amount-first no matter which column the DOM puts first.
              class={
                layout === "wide" && payment && !picking
                  ? "mt-4 @md:hidden"
                  : "mt-4"
              }>
              <AmountDue amount={invoice.amount} />
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
                amount={invoice.amount}
                controller={controller}
                mutating={mutating}
                payerEmail={invoice.payer_email}
                savingEmail={savingEmail}
                emailError={emailError}
                layout={layout}
                onChangeCoin={canSwitch ? startSwitch : undefined}
              />
            ) : null}
          </>
        )}
      </div>

      {faqOpen ? (
        <Faq
          entries={entries}
          context={context}
          invoice={invoice}
          onClose={closeFaq}
        />
      ) : null}
    </div>
  );
}

export function AmountDue({amount}: {amount: Invoice["amount"]}) {
  const {locale, strings} = useI18n();

  return (
    <>
      <p class="text-xs text-muted-foreground">{strings.amountDue}</p>
      <p class="font-heading text-3xl font-semibold tracking-tight">
        {formatMoney(amount, locale)}
      </p>
    </>
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
    chip: "bg-accent-surface/10 text-accent-surface",
    dot: "bg-accent-surface animate-pulse"
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
      class={`inline-flex min-w-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${style.chip}`}>
      <span class={`size-1.5 shrink-0 rounded-full ${style.dot}`} />
      <span
        // Truncates rather than wrapping: a second line inside a rounded pill reads
        // as a bug.
        class="truncate">
        {strings.status[status]}
      </span>
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
