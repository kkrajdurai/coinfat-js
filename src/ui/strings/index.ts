/**
 * String tables for the checkout. `en` is the only locale bundled today; every
 * table falls back to it per-key, so a partial one never renders `undefined`.
 *
 * ── Adding a locale ──────────────────────────────────────────────────────────
 *  1. Copy `en.ts` to e.g. `fr.ts` and translate every value. Interpolated strings
 *     are functions, so the locale handles its own word order and plurals (reach
 *     for `Intl.PluralRules` inside the function where a language needs it).
 *  2. Register it in `LOCALES` below: `{en, fr}`.
 *  3. Done — `coinfat.checkout({invoice, locale: "fr"})` now resolves to it, and
 *     `Intl` number/currency formatting follows the same `locale`.
 *
 * A merchant can also translate WITHOUT a rebuild by passing `strings`, a partial
 * override merged over the resolved locale:
 *     coinfat.checkout({invoice, strings: {sendExactly: "Envoyer exactement"}})
 * ─────────────────────────────────────────────────────────────────────────────
 */
import type {PaymentNotice} from "../payment.js";
import {en} from "./en.js";
import type {CheckoutStrings, CheckoutStringsOverride} from "./types.js";

export type {CheckoutStrings, CheckoutStringsOverride} from "./types.js";
export {en} from "./en.js";

/** Every bundled locale, keyed by its lowercase BCP-47 tag. */
const LOCALES: Record<string, CheckoutStrings> = {en};

export interface ResolvedI18n {
  /** What to hand `Intl` — the merchant's tag verbatim, or undefined for the runtime default. */
  locale: string | undefined;
  strings: CheckoutStrings;
}

/**
 * Resolve the copy for a checkout. The table is chosen by `locale` — exact tag,
 * then its base language (`fr-CA` → `fr`), then English — and a merchant `overrides`
 * partial is layered on top. The normalised tag is passed through for `Intl`, which
 * knows far more locales than we bundle tables for, so amounts can format in French
 * even while the copy falls back to English.
 */
export function resolveStrings(
  locale?: string,
  overrides?: CheckoutStringsOverride
): ResolvedI18n {
  // Blank/whitespace normalises to undefined: an empty string survives negotiation
  // but makes `Intl.NumberFormat("")` throw, silently dropping the currency symbol.
  const normalized = locale?.trim() || undefined;
  const tag = normalized?.toLowerCase();
  const base = tag?.split("-")[0];
  const table =
    (tag ? LOCALES[tag] : undefined) ??
    (base ? LOCALES[base] : undefined) ??
    en;

  if (!overrides) {
    return {locale: normalized, strings: table};
  }

  // Drop keys an untyped caller set to `undefined`: a spread would blank them, and
  // the interpolation keys are functions the view then calls — `undefined(...)` throws.
  const defined = Object.fromEntries(
    Object.entries(overrides).filter(([, value]) => value !== undefined)
  ) as CheckoutStringsOverride;

  return {
    locale: normalized,
    // Shallow but for `status`, the one nested object: a partial override there must
    // still inherit the labels it omits, or `settled(undefined)` would throw.
    strings: {
      ...table,
      ...defined,
      status: {...table.status, ...defined.status}
    }
  };
}

/** The copy for a `PaymentNotice`, resolved against a string table. */
export function noticeMessage(
  notice: PaymentNotice,
  strings: CheckoutStrings
): string {
  switch (notice.kind) {
    case "overpaid":
      return strings.noticeOverpaid(notice.extra, notice.symbol);
    case "underpaid":
      return strings.noticeUnderpaid(notice.remaining, notice.symbol);
    case "detected":
      return strings.noticeDetected;
  }
}
