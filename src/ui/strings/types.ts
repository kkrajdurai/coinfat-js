import type {StoreInvoiceStatus} from "../../core/types.js";

/**
 * Every payer-facing string the SDK itself authors. Interpolated ones are FUNCTIONS,
 * not placeholder templates, so a locale owns its grammar — word order, and plurals via
 * `Intl.PluralRules` where a language needs it. The SDK never concatenates on a
 * locale's behalf.
 *
 * Server-authored text is deliberately absent: a 4xx `error.message` localises in the
 * backend.
 */
export interface CheckoutStrings {
  amountDue: string;
  status: Record<StoreInvoiceStatus, string>;
  close: string;
  /** Accessible name for the modal dialog. */
  dialogLabel: string;
  /** The lead-in only; `BRAND.name` follows it untranslated. */
  poweredBy: string;

  // Close confirmation. Kept to the reason to hesitate — the title and the buttons
  // carry the decision. Two standing constraints: neither body may promise the payer
  // can reopen (`open()` works, but whether the page still offers a way to call it is
  // the merchant's business), and the detected one must keep saying the payment
  // survives, or "still being confirmed" beside a Close button implies the opposite.
  confirmCloseTitle: string;
  /** Funds already on their way. */
  confirmCloseDetected: string;
  /** An address is showing, nothing sent yet. */
  confirmCloseAwaiting: string;
  /** Dismisses the prompt and stays. */
  confirmCloseStay: string;
  /** Closes for real. */
  confirmCloseLeave: string;

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
  /**
   * Toggles the QR between its inline size and an enlarged, easier-to-scan one. Carries
   * the coin itself: the label is on the button wrapping the image, and an `aria-label`
   * outranks the image's `alt`, so the alt no longer reaches a screen reader.
   * https://w3c.github.io/accname/
   */
  qrZoomIn: (symbol: string) => string;
  qrZoomOut: (symbol: string) => string;
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
 * A merchant's partial override, merged over the resolved locale. `status` may itself
 * be partial — the resolver deep-merges it, so one status word can be translated
 * without supplying the other three.
 */
export type CheckoutStringsOverride = Partial<
  Omit<CheckoutStrings, "status">
> & {
  status?: Partial<Record<StoreInvoiceStatus, string>>;
};
