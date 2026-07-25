/**
 * Display formatting for the backend's money/coin shapes. DISPLAY-only — the
 * backend is the authority on amounts, which is what makes `Number()` safe here and
 * a big-decimal dependency unnecessary.
 */

import type {Coin, Money} from "../core/types.js";

export function formatMoney(money: Money, locale?: string): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: money.currency,
      minimumFractionDigits: money.scale,
      maximumFractionDigits: money.scale
    }).format(Number(money.amount));
  } catch {
    // Unknown currency code — fall back to a plain number + code.
    return `${money.amount} ${money.currency}`;
  }
}

/**
 * Crypto amounts, unlike the fiat `formatMoney`, take NO locale: the backend string
 * is exact and rendered verbatim (see ui/payment.ts), and `Intl` grouping separators
 * would corrupt an address-bound deposit amount. Only the symbol is appended.
 */
export function formatCoin(coin: Coin): string {
  return `${coin.amount} ${coin.symbol}`;
}
