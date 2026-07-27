/**
 * The brand identity, declared once — only the spellings that appear in more than one
 * file and must never drift. Deliberately NOT here: the API hosts (a subdomain is a
 * deployment choice, so they stay in `config.ts`), `theme.css`'s `--cf-` prefix (CSS
 * cannot import a constant), and the mark's path data in `primitives.tsx` (artwork is
 * not a string). Rename those by hand.
 *
 * `name` is not in the string table: a locale translates copy, it does not rename the
 * company. `slug` is not a swappable namespace but public surface twice over —
 * merchants target `[data-coinfat]` from their own stylesheet, and the `coinfat:`
 * error prefix is what identifies the vendor in a shared console. Its job here is
 * lockstep, not configurability.
 */
export const BRAND = {
  /** Display name — the wordmark, rendered verbatim in every locale. */
  name: "Coinfat",
  /** Machine-readable form: DOM attribute prefix and error-message prefix. */
  slug: "coinfat"
} as const;
