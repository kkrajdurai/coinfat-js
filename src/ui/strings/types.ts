import type {StoreInvoiceStatus} from "../../core/types.js";

/**
 * Every payer-facing string the SDK itself authors. Interpolated ones are
 * FUNCTIONS, not templates with placeholders, so a locale owns its own grammar —
 * word order, and pluralisation via `Intl.PluralRules` where a language needs it.
 * The SDK never concatenates on a locale's behalf.
 *
 * Server-authored text is deliberately absent: a 4xx `error.message` is written by
 * the backend and localises there, not here.
 */
export interface CheckoutStrings {
  amountDue: string;
  status: Record<StoreInvoiceStatus, string>;
  close: string;
  /** Accessible name for the modal dialog. */
  dialogLabel: string;

  // Terminal states (completed / expired / canceled)
  completedMessage: string;
  expiredMessage: string;
  canceledMessage: string;
  /** Success action → success_url. */
  continueToStore: string;
  /** Expired/canceled action → cancel_url. */
  returnToStore: string;

  // Pay panel
  sendExactly: string;
  /** Screen-reader alt for the deposit QR — payer-facing, so it lives here too. */
  qrAlt: (symbol: string) => string;
  openInWallet: string;
  noDepositAddress: string;
  listening: string;
  confirming: string;
  refreshRate: string;
  amountLocked: string;
  copied: string;
  copyAmount: (formatted: string) => string;
  copyAddress: string;
  summaryExpected: string;
  summaryReceived: string;
  summaryRemaining: string;
  summaryOverpaid: string;

  // Payment notices — the copy for each `PaymentNotice` kind (see payment.ts).
  noticeOverpaid: (extra: string, symbol: string) => string;
  noticeUnderpaid: (remaining: string, symbol: string) => string;
  noticeDetected: string;

  // Error / empty states
  networkError: string;
  loadErrorTitle: string;
  loadErrorDetail: string;
  retry: string;
  notFoundTitle: string;
  notFoundDetail: string;

  // Coin selection
  chooseCoin: string;
  chooseNetwork: string;
  /** Reopens the picker from the pay panel, before a payment is detected. */
  changeCoin: string;
  cancel: string;
  proceed: string;
  searchCoins: string;
  noNetworks: string;
  optionsError: string;

  // Drop-in button
  payWithCrypto: string;
}

/**
 * A merchant's partial override, merged over the resolved locale. Every top-level
 * key is optional, and `status` may itself be partial — the resolver deep-merges it,
 * so one status word can be translated without supplying the other three.
 */
export type CheckoutStringsOverride = Partial<
  Omit<CheckoutStrings, "status">
> & {
  status?: Partial<Record<StoreInvoiceStatus, string>>;
};
