/**
 * The brand identity, declared once.
 *
 * Scope is deliberately narrow: the two spellings that appear in more than one file
 * and must never drift from each other. Things that merely *contain* the brand but
 * are owned elsewhere stay elsewhere — the API hosts belong to `config.ts`, because a
 * subdomain is a deployment choice rather than a fact about the name.
 *
 * `name` is not in the string table: a locale translates copy, it does not rename the
 * company.
 *
 * `slug` is not a swappable namespace — naming the vendor is its entire job. It is
 * public surface twice over: merchants target `[data-coinfat]` to size and position
 * the embed from their own stylesheet, and the `coinfat:` prefix on thrown errors is
 * what tells them which vendor's script failed when three of them share a console.
 * A generic value would defeat both. Its point here is lockstep, not configurability
 * — the host attribute, the `@property` style attribute and both error prefixes are
 * one edit.
 *
 * Two spellings this file cannot reach: `ui/theme.css`'s `--cf-` custom-property
 * prefix (authored in CSS, which cannot import a constant) and the mark's path data
 * in `ui/primitives.tsx` (artwork is not a string). Rename those by hand.
 */
export const BRAND = {
  /** Display name — the wordmark, rendered verbatim in every locale. */
  name: "Coinfat",
  /** Machine-readable form: DOM attribute prefix and error-message prefix. */
  slug: "coinfat"
} as const;
