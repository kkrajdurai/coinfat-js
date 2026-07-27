/**
 * @coinfat/checkout — embedded crypto checkout SDK. The merchant creates the invoice
 * server-side with their secret API key and passes the ulid to the browser; this SDK
 * only ever talks to the public, bearer-less `/api/v1/checkout` endpoints.
 */

import {CheckoutApi} from "./core/api.js";
import {
  resolveConfig,
  type CoinfatOptions,
  type ResolvedConfig
} from "./core/config.js";
import {CheckoutButton, type ButtonParams} from "./widget/button.js";
import {CheckoutSession, type CheckoutParams} from "./widget/session.js";

export interface CoinfatClient {
  readonly config: ResolvedConfig;
  /** Create a checkout (inline is mounted immediately; modal is opened via `.open()`). */
  checkout(params: CheckoutParams): CheckoutSession;
  /** Render a drop-in "Pay with crypto" button that opens the checkout in a modal. */
  button(params: ButtonParams): CheckoutButton;
}

export function Coinfat(options: CoinfatOptions = {}): CoinfatClient {
  const config = resolveConfig(options);
  const api = new CheckoutApi(config.apiBase);

  return {
    config,
    checkout: (params) => new CheckoutSession(api, params),
    button: (params) => new CheckoutButton(api, params)
  };
}

/** A value export, so `onError` can `instanceof`-narrow it and read `status`. */
export {CheckoutApiError} from "./core/api.js";
export type {
  CoinfatOptions,
  Environment,
  ResolvedConfig
} from "./core/config.js";
export type {CheckoutParams} from "./widget/session.js";
export type {ButtonParams} from "./widget/button.js";
/** The full string table, plus the English base to copy when building a locale. */
export type {
  CheckoutStrings,
  CheckoutStringsOverride
} from "./ui/strings/index.js";
export {en as englishStrings} from "./ui/strings/index.js";
export type {
  CheckoutCallbacks,
  CheckoutTheme,
  ThemeMode,
  WidgetDisplay,
  WidgetLayout
} from "./core/options.js";
export type {
  Checkout,
  CheckoutStore,
  Coin,
  Currency,
  Money,
  StoreInvoicePayment,
  StoreInvoicePaymentStatus,
  StoreInvoiceStatus,
  Wallet,
  WalletNetwork
} from "./core/types.js";
