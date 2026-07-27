/**
 * IIFE entry for the CDN `<script>` build. The UMD global is the module NAMESPACE
 * (`{Coinfat, …}`), so `Coinfat(...)` isn't callable there. Here the default export IS
 * the factory — built with `output.exports: "default"` — giving a script tag a callable
 * `window.Coinfat(...)` with the value exports hung off it.
 */

import {Coinfat, CheckoutApiError, englishStrings} from "./index.js";

export default Object.assign(Coinfat, {CheckoutApiError, englishStrings});
