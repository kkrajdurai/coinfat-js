/**
 * Public option and callback types. In `core` so the UI can import them without
 * depending on the entrypoint.
 */

import type {Checkout} from "./types.js";

export type WidgetDisplay = "inline" | "modal";

export type WidgetLayout = "wide" | "narrow";

export type ThemeMode = "light" | "dark" | "auto";

export interface CheckoutTheme {
  /** Hex color that overrides the store's brand_color as the widget accent. */
  accent?: string;
  /** Color scheme. Defaults to 'auto' (follows the viewer's preference). */
  mode?: ThemeMode;
}

/**
 * Lifecycle callbacks. Each receives the current invoice (except onError).
 * Fired once per transition.
 */
export interface CheckoutCallbacks {
  /** The invoice loaded for the first time. */
  onReady?: (invoice: Checkout) => void;
  /** The payer selected (or switched) a coin. */
  onCoinSelected?: (invoice: Checkout) => void;
  /** An on-chain payment was detected and is confirming. */
  onPaymentDetected?: (invoice: Checkout) => void;
  /** The invoice completed. */
  onCompleted?: (invoice: Checkout) => void;
  /** The invoice expired. */
  onExpired?: (invoice: Checkout) => void;
  /** The invoice was canceled. */
  onCanceled?: (invoice: Checkout) => void;
  /** A load/select/requote failed. */
  onError?: (error: Error) => void;
}
