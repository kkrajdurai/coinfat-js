/**
 * The pay experience: what a payer sees once a coin is selected. Everything comes from
 * `checkout.show` — no extra requests. The layout is container-driven: `@md:` resolves
 * against the `@container` on the checkout root, so it splits or stacks by the
 * merchant's slot width without the SDK measuring anything.
 */

import {useEffect, useState} from "preact/hooks";
import type {CheckoutController} from "../core/checkout.js";
import type {WidgetLayout} from "../core/options.js";
import type {StoreInvoicePayment} from "../core/types.js";
import {formatCoin} from "./format.js";
import {paymentAmounts, paymentNotice} from "./payment.js";
import {
  Button,
  CopyField,
  RateLock,
  RefreshIcon,
  SwapIcon
} from "./primitives.js";
import {noticeMessage} from "./strings/index.js";
import {useStrings} from "./strings/context.js";

export interface PayPanelProps {
  payment: StoreInvoicePayment;
  controller: CheckoutController;
  /** A select/requote is in flight. */
  mutating: boolean;
  /** 'wide' allows the QR/details two-column split; 'narrow' stays single-column. */
  layout: WidgetLayout;
  /** Reopen the coin picker. Omitted once a payment is detected (the coin locks). */
  onChangeCoin?: () => void;
}

const NOTICE_TONE = {
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
  // Fixed info blue, not the brand accent — see --cf-info in theme.css.
  info: "bg-info/10 text-info"
} as const;

export function PayPanel({
  payment,
  controller,
  mutating,
  layout,
  onChangeCoin
}: PayPanelProps) {
  const strings = useStrings();
  const detected = !!payment.detected_at;
  const amounts = paymentAmounts(payment);
  const notice = paymentNotice(payment);
  const message = notice ? noticeMessage(notice, strings) : null;

  const [expired, setExpired] = useState(false);

  // A successful requote moves the deadline, which re-arms the lock and this.
  useEffect(() => setExpired(false), [payment.rate_expires_at]);

  // Never rejects — failures land on state. `useCountdown` fires onElapsed at most
  // once per deadline, so the automatic path needs no guard of its own.
  const requote = () => void controller.requote();

  const handleElapsed = () => {
    setExpired(true);
    requote();
  };

  return (
    <div class="mt-4 space-y-4">
      <div class="flex items-center justify-between gap-2">
        <span
          // Above the grid, not in it: as a grid item its width fed an `auto`
          // track, so a long network name stole room from the address column.
          class="inline-flex min-w-0 items-center gap-1.5 rounded-full border border-border bg-muted/40 py-1 ps-1 pe-2.5 text-xs font-medium">
          {payment.wallet.svg_icon ? (
            <img
              src={payment.wallet.svg_icon}
              alt=""
              class="size-4 shrink-0 rounded-full"
            />
          ) : null}
          <span class="truncate">
            {amounts.symbol}
            {payment.wallet_network ? ` · ${payment.wallet_network.name}` : ""}
          </span>
        </span>

        {onChangeCoin ? (
          <button
            type="button"
            onClick={onChangeCoin}
            class="inline-flex shrink-0 items-center gap-1 rounded-md px-1 py-0.5 text-xs font-medium text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <SwapIcon />
            {strings.changeCoin}
          </button>
        ) : null}
      </div>

      <div
        // Two columns only when the merchant asked for `wide` AND the container is past
        // @md (28rem). A `narrow` modal (max-w-sm, 24rem) therefore never splits; a
        // `wide` one (max-w-xl) clears the threshold and does.
        class={
          layout === "wide"
            ? "grid grid-cols-1 gap-4 @md:grid-cols-[8rem_1fr] @md:gap-5"
            : "grid grid-cols-1 gap-4"
        }>
        <div class="flex flex-col items-center gap-2">
          {payment.qr_code_url ? (
            <img
              src={payment.qr_code_url}
              alt={strings.qrAlt(amounts.symbol)}
              class="size-32 rounded-xl border border-border bg-white p-1.5"
              // Third-party image: a broken-image glyph as the panel's focal point is
              // worse than no QR at all.
              onError={(event) => {
                (event.currentTarget as HTMLImageElement).style.display =
                  "none";
              }}
            />
          ) : null}
        </div>

        <div class="min-w-0 space-y-3">
          <div class="space-y-1">
            <p class="text-xs font-medium tracking-[0.12em] text-muted-foreground uppercase">
              {strings.sendExactly}
            </p>
            <CopyField
              text={payment.expected_value.amount}
              label={strings.copyAmount(formatCoin(payment.expected_value))}
              class="rounded-md">
              <span class="font-heading text-lg font-bold tabular-nums">
                {formatCoin(payment.expected_value)}
              </span>
            </CopyField>
          </div>

          {payment.address ? (
            <CopyField
              text={payment.address}
              label={strings.copyAddress}
              class="w-full rounded-xl border border-border bg-muted/30 px-3 py-2.5">
              <span class="min-w-0 flex-1 truncate font-mono text-xs">
                {payment.address}
              </span>
            </CopyField>
          ) : (
            // A null address means the provider has none provisioned — a real
            // failure, not "no coin picked yet".
            <p class="rounded-xl bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {strings.noDepositAddress}
            </p>
          )}

          {payment.deposit_uri ? (
            // A payer on a phone cannot scan a QR on that same phone. The
            // BIP21/EIP-681 URI hands straight off to an installed wallet.
            <a
              href={payment.deposit_uri}
              class="inline-flex w-full items-center justify-center rounded-xl border border-border px-3 py-2 text-xs font-medium transition hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {strings.openInWallet}
            </a>
          ) : null}

          <p
            // Mounted unconditionally, only the text swapping: a live region inserted
            // with its text already in place is not announced.
            // https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Guides/Live_regions
            role="status"
            class={
              notice
                ? `rounded-xl px-3 py-2 text-xs ${NOTICE_TONE[notice.tone]}`
                : "sr-only"
            }>
            {message ?? ""}
          </p>

          <PaymentSummary payment={payment} />

          {!detected ? (
            // Once a transfer is detected the quote is settled: re-quoting would
            // change an amount the payer has already sent.
            <>
              <RateLock
                key={payment.rate_expires_at}
                target={payment.rate_expires_at}
                onElapsed={handleElapsed}
              />
              {expired ? (
                // Only once the lock has lapsed: while the amount on screen is still
                // good, a refresh button next to it invites second-guessing.
                <Button variant="outline" onClick={requote} busy={mutating}>
                  {mutating ? null : <RefreshIcon />}
                  {strings.refreshRate}
                </Button>
              ) : null}
            </>
          ) : null}
        </div>
      </div>

      <div class="border-t border-border pt-3">
        <ListeningIndicator detected={detected} />
      </div>
    </div>
  );
}

function PaymentSummary({payment}: {payment: StoreInvoicePayment}) {
  const strings = useStrings();
  const {
    symbol,
    expected,
    received,
    remaining,
    overpaid,
    owes,
    started,
    progress
  } = paymentAmounts(payment);

  // Nothing has arrived yet, so a table of zeroes would be noise.
  if (!started) {
    return null;
  }

  const rows: {label: string; value: string; tone?: string}[] = [
    {label: strings.summaryExpected, value: `${expected} ${symbol}`},
    {
      label: strings.summaryReceived,
      value: `${received} ${symbol}`,
      tone: "text-success"
    }
  ];

  if (owes) {
    rows.push({
      label: strings.summaryRemaining,
      value: `${remaining} ${symbol}`,
      tone: "text-warning"
    });
  }

  if (Number(overpaid) > 0) {
    rows.push({
      label: strings.summaryOverpaid,
      // Semantic, not the brand accent: an overpayment is settled-and-then-some, and a
      // red-brand store shouldn't render it as alarming.
      value: `${overpaid} ${symbol}`,
      tone: "text-success"
    });
  }

  return (
    <div class="space-y-2 rounded-xl border border-border bg-muted/30 p-3">
      <dl class="space-y-1.5">
        {rows.map((row) => (
          <div
            key={row.label}
            class="flex items-center justify-between gap-3 text-xs">
            <dt class="text-muted-foreground">{row.label}</dt>
            <dd class={`font-medium tabular-nums ${row.tone ?? ""}`}>
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
      <div class="h-1 overflow-hidden rounded-full bg-muted">
        <div
          style={{width: `${progress}%`}}
          class="h-full rounded-full bg-success transition-[width]"
        />
      </div>
    </div>
  );
}

function ListeningIndicator({detected}: {detected: boolean}) {
  const strings = useStrings();

  return (
    <div class="flex items-center justify-center gap-2 text-xs text-muted-foreground">
      <span class="relative flex size-2">
        <span
          // A permanent ping carries no information and is exactly what triggers
          // vestibular discomfort.
          class="absolute inline-flex size-full animate-ping rounded-full bg-success/70 motion-reduce:hidden"
        />
        <span class="relative inline-flex size-2 rounded-full bg-success" />
      </span>
      {detected ? strings.confirming : strings.listening}
    </div>
  );
}
