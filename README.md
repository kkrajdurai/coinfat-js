# @coinfat/checkout

Embedded crypto checkout SDK for Coinfat. Drop a Coinfat invoice checkout onto any
website — inline or as a modal — with no secret keys in the browser. Preact-small,
self-contained (nothing to load at runtime), style-isolated in a shadow root.

## How it works

The store secret key is **never** in the browser. The flow is two-actor:

1. Your **server** creates the invoice with your secret API key and gets back an
   invoice `ulid`.
2. Your **page** passes that ulid to this SDK, which drives a branded checkout using
   only Coinfat's public, credential-less `/api/v1/checkout` endpoints. The ulid is the
   sole capability — never add auth headers or put the secret key on the page.

## Install

**npm** (bundler / framework apps):

```bash
npm install @coinfat/checkout
```

```js
import {Coinfat} from "@coinfat/checkout";
```

**Or a plain `<script>` tag** (no build step) — a callable `window.Coinfat`:

```html
<script src="https://cdn.jsdelivr.net/npm/@coinfat/checkout@1/dist/coinfat.iife.js"></script>
<script>
  const coinfat = Coinfat({environment: "production"});
  coinfat.button({invoice: ulid, mount: "#pay"});
</script>
```

`@1` tracks the newest `1.x`, so fixes reach your customers without a redeploy. Use
`https://unpkg.com/@coinfat/checkout@1/dist/coinfat.iife.js` instead if you prefer unpkg —
both serve straight off npm.

If your policy requires an immutable script, pin an exact version and add its integrity
hash — every [release](https://github.com/kkrajdurai/coinfat-js/releases) publishes the
tag ready to paste. Updating it for each patch is then yours to do.

## Usage

```js
const coinfat = Coinfat({environment: "production"});
// or a custom backend:  Coinfat({apiBase: "http://localhost:8000/api/v1"})

// Inline — mounted immediately into your markup
coinfat.checkout({
  invoice: ulid,
  display: "inline",
  mount: "#pay",
  layout: "wide" // 'wide' collapses to one column on narrow slots; 'narrow' stays single
});

// Modal — opened from your own button
const session = coinfat.checkout({
  invoice: ulid,
  display: "modal",
  layout: "narrow"
});
myButton.onclick = () => session.open();

// Drop-in button that renders itself and opens the modal
coinfat.button({invoice: ulid, mount: "#pay-button", label: "Pay with crypto"});
```

`button()` also takes `theme`, and a `checkout` object carrying everything the modal
it opens accepts — callbacks, `layout`, `locale`, `strings`, `redirectOnComplete`:

```js
coinfat.button({
  invoice: ulid,
  mount: "#pay-button",
  checkout: {onCompleted: (invoice) => console.log("paid", invoice.ulid)}
});
```

A session exposes `open()`, `close()` and `destroy()` (stops polling and unmounts);
the button exposes `destroy()`.

Runnable examples: [`examples/inline.html`](./examples/inline.html),
[`examples/modal.html`](./examples/modal.html).

### Callbacks & theming

All callbacks are optional: `onReady`, `onCoinSelected`, `onPaymentDetected`,
`onCompleted`, `onExpired`, `onCanceled`, `onError`.

- **Success:** `onCompleted` fires; the widget redirects to the invoice's `success_url`
  **only** if you pass `redirectOnComplete: true`.
- **Theme:** `theme: {accent?: "#hex", mode?: "light" | "dark" | "auto"}`. The accent
  falls back to the store's `brand_color`, then Coinfat orange; `mode: "auto"` follows
  the viewer's OS setting (live). To match `brand_color`, `button()` makes one
  lightweight `GET /checkout/{ulid}` when it mounts — set `theme.accent` to skip it.
- **Copy / locale:** `locale?: "fr"` (only `en` ships today; unknown tags fall back to
  English while `Intl` still formats amounts for the tag) and `strings?: {sendExactly:
"…"}` to override any payer-facing string.

### Errors

`onError` receives a `CheckoutApiError` carrying `status`, the server's `message`, any
field `errors` from a 422, and `retryAfter` from a 429. Narrow with `instanceof`:

```js
import {Coinfat, CheckoutApiError} from "@coinfat/checkout";
// From a <script> tag the same value hangs off the global: Coinfat.CheckoutApiError

coinfat.checkout({
  invoice: ulid,
  display: "inline",
  mount: "#pay",
  onError: (error) => {
    if (error instanceof CheckoutApiError && error.status === 429) {
      // rate limited — the widget is already backing off
    }
  }
});
```

## Environments

`environment` maps to a backend base URL; `/api/v1` is pinned by the SDK.

| environment             | base URL                       |
| ----------------------- | ------------------------------ |
| `production`            | `https://api.coinfat.com`      |
| `development` (default) | `https://test-api.coinfat.com` |

Use `development` for integration testing and `production` for live traffic, or point
`apiBase` at any host (it must already include `/api/v1`).

## License

[MIT](./LICENSE)
