/**
 * IIFE entry for the CDN `<script>` build. The main bundle's UMD global is the module
 * NAMESPACE (`{Coinfat, CheckoutApiError, …}`), so `Coinfat(...)` isn't callable. Here
 * the default export IS the factory — built with `output.exports: "default"` — so a
 * plain script tag gets a callable `window.Coinfat(...)`, with the value exports hung
 * off it (`Coinfat.CheckoutApiError`, `Coinfat.englishStrings`).
 */

import {Coinfat, CheckoutApiError, englishStrings} from "./index.js";

export default Object.assign(Coinfat, {CheckoutApiError, englishStrings});
