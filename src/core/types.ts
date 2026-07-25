/**
 * The SDK's contract with the backend for `/api/v1/checkout/...`. Keep in sync with
 * the published schemas for the Coinfat public checkout API.
 */

/** Fiat money, as serialized by the backend's `JsonSerialize::money()`. */
export interface Money {
  /** Decimal string with trailing zeros stripped, e.g. "1450" or "12.5". */
  amount: string;
  /** ISO currency code, e.g. "USD". */
  currency: string;
  /** Number of fraction digits to render, e.g. 2. */
  scale: number;
}

/**
 * Crypto amount from the backend's `JsonSerialize::coin()`. No `scale`, unlike
 * `Money`. The published schema is stale — it omits the `symbol` the API does send,
 * so this type follows the response, not the schema.
 */
export interface Coin {
  /** Decimal string with trailing zeros stripped, already at the wallet's precision. */
  amount: string;
  /** Wallet identifier, e.g. "btc". */
  wallet: string;
  /** Coin symbol, e.g. "BTC". */
  symbol: string;
}

export type StoreInvoiceStatus =
  "pending" | "completed" | "expired" | "canceled";

export type StoreInvoicePaymentStatus =
  "pending" | "underpaid" | "completed" | "expired";

/** A stored file reference (logo), as serialized by the backend's FileInfo. */
export interface FileInfo {
  url: string;
  [key: string]: unknown;
}

export interface Currency {
  code: string;
  name: string;
}

export interface WalletNetwork {
  /** Post this back as `wallet_network_id` to select the network. */
  id: string;
  name: string;
  is_active: boolean;
  /** Confirmations required before the payment completes. */
  confirmation: number;
  supports_consolidation: boolean;
  supports_execution_fee: boolean;
  /** The coin this network belongs to. */
  wallet: Wallet;
  /**
   * The chain's native coin, which the execution (gas) fee is paid in. Null where
   * there is no separate fee coin. Read the network's icon/symbol off
   * `execution_fee_wallet ?? wallet`: USDT-on-Tron is marked TRX, not USDT.
   */
  execution_fee_wallet: Wallet | null;
  created_at: string;
  updated_at: string;
}

export interface Wallet {
  id: string;
  name: string;
  scale: number;
  precision: number;
  currency_scale: number | null;
  symbol: string;
  svg_icon: string;
  unit_price: Money;
  /**
   * Present on the wallets endpoint, absent on `Checkout.supported_wallets` — which
   * is why only the former can drive the coin/network picker.
   */
  networks?: WalletNetwork[];
  created_at: string;
  updated_at: string;
}

/** The store's public branding, for theming the checkout. */
export interface CheckoutStore {
  ulid: string;
  name: string;
  logo: FileInfo | null;
  /** Hex color, e.g. "#1A2B3C". Seeds the widget accent when set. */
  brand_color: string | null;
  description: string | null;
  support_email: string | null;
  website_url: string | null;
}

/** The currently-selected coin payment (deposit address, quote, status). */
export interface StoreInvoicePayment {
  ulid: string;
  status: StoreInvoicePaymentStatus;
  wallet: Wallet;
  wallet_network: WalletNetwork | null;
  /**
   * The on-chain address the payer sends to. Null does NOT mean "no coin chosen
   * yet" — a payment row only exists once a network is selected. It means the
   * network's provider has no address provisioned: an error state to surface, not
   * a cue to show the coin picker. `deposit_uri` and `qr_code_url` go null with it.
   */
  address: string | null;
  /** Scannable BIP21/EIP-681 deposit URI. Null whenever `address` is. */
  deposit_uri: string | null;
  /** URL of a QR code image encoding the deposit URI. Null whenever `address` is. */
  qr_code_url: string | null;
  /** The exact coin amount to send. */
  expected_value: Coin;
  received_value: Coin;
  overpaid: boolean;
  overpaid_value: Coin;
  /**
   * Still owed, quoted by the backend so the client never re-derives it from
   * `expected − received`. Floored at zero once the received value meets the
   * completion threshold — a payment settled within the tolerance band reads as
   * nothing owed. Sits beside `overpaid_value`, the mirror quantity.
   */
  remaining_value: Coin;
  detected_at: string | null;
  /** When the rate lock lapses and a requote is needed. Never null. */
  rate_expires_at: string;
  created_at: string;
  updated_at: string;
}

/** The payer-facing view of an invoice, returned by `checkout.show`. */
export interface Checkout {
  ulid: string;
  status: StoreInvoiceStatus;
  store: CheckoutStore;
  currency: Currency;
  amount: Money;
  supported_wallets: Wallet[];
  active_payment: StoreInvoicePayment | null;
  success_url: string | null;
  cancel_url: string | null;
  expires_at: string;
  created_at: string;
  updated_at: string;
}

/** Invoice statuses that end the checkout (no further polling). */
export const TERMINAL_STATUSES: ReadonlySet<StoreInvoiceStatus> = new Set([
  "completed",
  "expired",
  "canceled"
]);
