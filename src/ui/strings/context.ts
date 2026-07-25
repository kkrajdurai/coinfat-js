import {createContext} from "preact";
import {useContext} from "preact/hooks";
import {
  resolveStrings,
  type CheckoutStrings,
  type ResolvedI18n
} from "./index.js";

/**
 * The resolved locale + copy for the subtree. Defaults to English so a component
 * rendered without a provider (or a unit test) still reads real strings rather than
 * `undefined`.
 */
const I18nContext = createContext<ResolvedI18n>(resolveStrings());

export const I18nProvider = I18nContext.Provider;

/** The resolved locale and strings — use `locale` for `Intl`, `strings` for copy. */
export function useI18n(): ResolvedI18n {
  return useContext(I18nContext);
}

/** Just the copy, for components that render text but format no numbers. */
export function useStrings(): CheckoutStrings {
  return useContext(I18nContext).strings;
}
