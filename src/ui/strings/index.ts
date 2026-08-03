/**
 * String tables for the checkout. `en` is the only locale bundled today; every table
 * falls back to it per-key, so a partial one never renders `undefined`.
 *
 * Adding a locale: copy `en.ts` to e.g. `fr.ts`, translate every value (interpolated
 * strings are functions, so the locale owns its word order and plurals), and register
 * it in `LOCALES` below. `locale: "fr"` then resolves to it, and `Intl` formatting
 * follows the same tag.
 *
 * A merchant can also translate without a rebuild by passing `strings`, a partial
 * override merged over the resolved locale.
 */
import type {PaymentNotice} from "../payment.js";
import {en} from "./en.js";
import type {CheckoutStrings, CheckoutStringsOverride} from "./types.js";

export type {
  CheckoutStrings,
  CheckoutStringsOverride,
  FaqContext,
  FaqEntry
} from "./types.js";
export {en} from "./en.js";

/** Every bundled locale, keyed by its lowercase BCP-47 tag. */
const LOCALES: Record<string, CheckoutStrings> = {en};

export interface ResolvedI18n {
  /** What to hand `Intl` — the merchant's tag verbatim, or undefined for the runtime default. */
  locale: string | undefined;
  strings: CheckoutStrings;
}

/**
 * Resolve the copy for a checkout. The table is chosen by `locale` — exact tag, then
 * base language (`fr-CA` → `fr`), then English — with `overrides` layered on top. The
 * normalised tag passes through for `Intl`, which knows far more locales than we bundle
 * tables for, so amounts can format in French while the copy falls back to English.
 */
export function resolveStrings(
  locale?: string,
  overrides?: CheckoutStringsOverride
): ResolvedI18n {
  // Blank/whitespace normalises to undefined: an empty string survives negotiation but
  // makes `Intl.NumberFormat("")` throw, silently dropping the currency symbol.
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

  // Drop keys an untyped caller set to `undefined`: a spread would blank them, and the
  // interpolation keys are functions the view then calls — `undefined(...)` throws.
  const dropUndefined = <T extends object>(source: T): T =>
    Object.fromEntries(
      Object.entries(source).filter(([, value]) => value !== undefined)
    ) as T;

  const defined = dropUndefined(overrides);

  return {
    locale: normalized,
    // Shallow but for `status`, the one nested object: a partial override there must
    // still inherit the labels it omits — and be filtered in turn, or a blanked label
    // renders an empty chip.
    strings: {
      ...table,
      ...defined,
      status: {...table.status, ...dropUndefined(defined.status ?? {})}
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
