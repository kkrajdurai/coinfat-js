/**
 * Terminal states — the checkout is over. Routed purely on `invoice.status`; the payer
 * payload carries no receipt, tx hash or paid-at to show. Each is a centred icon +
 * message, plus a link to the store when the invoice supplied one. The success check
 * animates in (theme.css `cf-*`) and honours `prefers-reduced-motion`.
 */

import type {ComponentChild} from "preact";
import type {Checkout, StoreInvoiceStatus} from "../core/types.js";
import {formatMoney} from "./format.js";
import {CircleXIcon, ClockIcon, LinkButton} from "./primitives.js";
import {useI18n} from "./strings/context.js";
import type {CheckoutStrings} from "./strings/index.js";

/**
 * The payer-facing line for a terminal status. Exported so the card can mirror it in an
 * always-mounted live region — a `role="status"` mounted here would not reliably
 * announce the poll transition into a terminal state.
 */
export function terminalMessage(
  status: StoreInvoiceStatus,
  strings: CheckoutStrings
): string {
  if (status === "completed") return strings.completedMessage;
  if (status === "canceled") return strings.canceledMessage;
  return strings.expiredMessage;
}

export function Terminal({invoice}: {invoice: Checkout}) {
  const {locale, strings} = useI18n();
  const message = terminalMessage(invoice.status, strings);

  if (invoice.status === "completed") {
    return (
      <TerminalPanel
        icon={<SuccessCheck />}
        // Reassurance that this success screen is theirs.
        amount={formatMoney(invoice.amount, locale)}
        message={message}
        href={invoice.success_url}
        action={strings.continueToStore}
        actionVariant="primary"
      />
    );
  }

  if (invoice.status === "canceled") {
    return (
      <TerminalPanel
        icon={
          <IconBadge tone="destructive">
            <CircleXIcon />
          </IconBadge>
        }
        message={message}
        href={invoice.cancel_url}
        action={strings.returnToStore}
        actionVariant="outline"
      />
    );
  }

  // Expired is the remaining terminal status.
  return (
    <TerminalPanel
      icon={
        <IconBadge tone="muted">
          <ClockIcon />
        </IconBadge>
      }
      message={message}
      href={invoice.cancel_url}
      action={strings.returnToStore}
      actionVariant="outline"
    />
  );
}

function TerminalPanel({
  icon,
  amount,
  message,
  href,
  action,
  actionVariant
}: {
  icon: ComponentChild;
  amount?: string;
  message: string;
  href: string | null;
  action: string;
  actionVariant: "primary" | "outline";
}) {
  return (
    <div class="mt-4 flex flex-col items-center gap-3 py-4 text-center">
      {icon}
      {amount ? (
        <p class="font-heading text-2xl font-semibold tracking-tight">
          {amount}
        </p>
      ) : null}
      <p class="text-sm font-medium text-balance">{message}</p>
      {href ? (
        <LinkButton href={href} variant={actionVariant}>
          {action}
        </LinkButton>
      ) : null}
    </div>
  );
}

function IconBadge({
  tone,
  children
}: {
  tone: "muted" | "destructive";
  children: ComponentChild;
}) {
  const tint =
    tone === "destructive"
      ? "bg-destructive/10 text-destructive"
      : "bg-muted text-muted-foreground";

  return (
    <span
      class={`cf-pop flex size-16 items-center justify-center rounded-full ${tint}`}>
      {children}
    </span>
  );
}

/** The animated success mark: a burst ring, a resting circle, and a drawn check. */
function SuccessCheck() {
  return (
    <span class="cf-pop relative inline-flex text-success">
      <span
        class="cf-burst absolute inset-0 rounded-full bg-success/30"
        aria-hidden="true"
      />
      <svg
        viewBox="0 0 52 52"
        class="relative size-16"
        fill="none"
        aria-hidden="true">
        <circle
          cx="26"
          cy="26"
          r="24"
          stroke="currentColor"
          stroke-width="2"
          class="opacity-20"
        />
        <path
          d="M16 27l7 7 13-15"
          stroke="currentColor"
          stroke-width="3"
          stroke-linecap="round"
          stroke-linejoin="round"
          pathLength="1"
          class="cf-check-draw"
        />
      </svg>
    </span>
  );
}
