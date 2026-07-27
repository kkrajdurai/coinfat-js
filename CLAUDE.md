# coinfat-js — Agent Guide

The **embedded crypto checkout SDK** for Coinfat. A merchant drops it onto their site
so their customer can pay a Coinfat invoice inline or in a modal — without leaving the
merchant's page, and without the merchant's secret API key touching the browser.

The SDK is **feature-complete**; see [Status](#status) for the shipped surface.

---

## The one security invariant

The store API key (secret) is **never** in the browser. The flow is two-actor:

1. The **merchant's server** creates the invoice via the backend's secret-key API
   and gets back an invoice **ulid**.
2. The **browser** hands that ulid to this SDK, which drives the checkout using only
   the **public, bearer-less** `/api/v1/checkout` endpoints. The ulid is the sole
   capability. Never add auth headers or credentials to these requests.

---

## Locked architecture & decisions

Decided deliberately. Do not revisit without a reason.

- **Preact** (not React) — ~4KB, and the embed runs on someone else's checkout page.
  `react`/`react-dom` alias to `preact/compat` in tsconfig, but prefer plain Preact.
- **Shadow DOM** for style isolation — see
  [Shadow DOM + Tailwind](#shadow-dom--tailwind-v4).
- **Tailwind v4** with Coinfat's design tokens (brand orange `#ff8201`, oklch
  neutrals, radius 0.625rem). Utilities are the port vehicle for the design.
- **Polling, not realtime, for v1.** The engine polls `checkout.show` every 8s until a
  terminal status. Realtime, if it lands, is a later additive refetch-kick.
- **Widget types:** `inline` and `modal` (opened via `.open()`), plus a drop-in button
  that opens the modal. No "compact" variant.
- **Layout is explicit** (`layout: 'wide' | 'narrow'`), not auto-detected — but `wide`
  must still responsive-collapse to one column on a narrow container.
- **Success:** fire `onCompleted`; redirect to `success_url` **only** if
  `redirectOnComplete` is set.
- **Env switch:** `environment: 'production' | 'development'` maps to a base URL;
  `/api/v1` is pinned by the SDK. Defaults to `development`.
- **Translation seam, English-only bundle.** Payer-facing copy routes through
  `src/ui/strings/`, chosen by `locale` and overridable per-key by `strings`. Adding a
  locale is a drop-in data file (recipe at the top of `src/ui/strings/index.ts`).
  Server-authored 4xx messages localise backend-side. **Deferred:** more locale packs,
  plural-rule machinery, RTL, locale auto-negotiation.
- **Brand spellings live in `core/brand.ts`**, which documents what it owns and what it
  deliberately does not.
- **Modal attribution badge:** "Powered by Coinfat", pinned to the mask outside the
  dialog. Its gutter is cut from the scroll viewport, not from the content — see
  `src/ui/Modal.tsx`, and do not "simplify" it back to padding.
- **Out of v1:** realtime, framework wrappers (React/Vue), a deep appearance API (only
  the accent + light/dark seam exists).

---

## The design principle: port the _pattern_, not the pixels

The reference is Coinfat's own hosted checkout page. It is React; **do not copy the
JSX**. Port the flow, the state machine and the Tailwind classes (which transfer
almost verbatim and are how we replicate the look).

The hosted page is full-viewport; ours is not — inline lives in a merchant's slot and
modal is a constrained card. Follow the pattern and the design tokens; invent the
layout.

---

## Repository layout

```
src/
  core/            framework-neutral — no Preact imports
    types.ts       backend Checkout resource types (keep in sync with the backend)
    brand.ts       BRAND = {name, slug}
    config.ts      environment -> base URL
    api.ts         CheckoutApiClient (the transport seam) + its fetch impl, no deps
    checkout.ts    CheckoutController: fetch + 8s poll + select + requote + subscribe
    options.ts     public option/callback types
  ui/              Preact view layer
    theme.css      Tailwind + brand tokens, scoped for shadow DOM
    Checkout.tsx   the checkout core (status/branding + state routing)
    PayPanel.tsx   the pay experience: QR, copy fields, rate lock, amounts
    CoinSelect.tsx coin + network picker -> controller.select (+ switch flow)
    Terminal.tsx   completed / expired / canceled terminal states
    primitives.tsx Button, LinkButton, Spinner, CopyField, RateLock, icons, brand mark
    payment.ts     pay-panel arithmetic + notice logic (no Preact — unit-tested)
    Modal.tsx      modal chrome (backdrop + centered card + attribution badge)
    useCheckout.ts Preact hook binding a component to a CheckoutController
    format.ts      display formatting for Money/Coin
    strings/       payer-facing copy: types + en table + resolve/context (i18n seam)
  widget/          mounting + presenters
    mount.ts       createShadowHost(): shadow root + injected CSS + Preact render
    session.tsx    CheckoutSession: inline + modal presenters, callback composition
    button.tsx     CheckoutButton: drop-in "Pay with crypto" button
  index.ts         public API — the Coinfat(...) factory
  dev.tsx          local dev harness (not published)
test/              Vitest specs (not published); test/browser/ is Playwright
```

**Boundary rule:** `core/` never imports Preact. The view layer (`ui/`, `widget/`)
depends on `core/`, never the reverse. `CheckoutController` depends on the
`CheckoutApiClient` **interface**, not the `CheckoutApi` class — keep it that way, or
the class's private fields leak into the type and every substitute needs a cast.

---

## Public API

```js
import {Coinfat} from "@coinfat/checkout";

const coinfat = Coinfat({environment: "development"}); // or {apiBase: "http://localhost:8000/api/v1"}

// Inline — mounted immediately, skeleton first
coinfat.checkout({
  invoice: ulid,
  display: "inline",
  mount: "#pay",
  layout: "wide"
});

// Modal — merchant's own button
const session = coinfat.checkout({
  invoice: ulid,
  display: "modal",
  layout: "narrow"
});
myButton.onclick = () => session.open();

// Drop-in button that opens the modal
coinfat.button({invoice: ulid, mount: "#btn", label: "Pay with crypto"});
```

Callbacks (all optional): `onReady`, `onCoinSelected`, `onPaymentDetected`,
`onCompleted`, `onExpired`, `onCanceled`, `onError`. Theme seam:
`theme: {accent?: "#hex", mode?: "light" | "dark" | "auto"}`. Translation seam:
`locale?: "fr"` and `strings?: {sendExactly?: "…"}`. `locale` also drives `Intl`
**fiat** formatting; crypto amounts render verbatim and are never grouped.

Callbacks are owned by the **controller**, not the view, so each transition fires once
per invoice — reopening the modal must not replay `onReady`/`onCompleted` (and with it
the opt-in `success_url` redirect).

`onError` receives a **`CheckoutApiError`** (exported from the entry point) carrying
`status`, the server's `message`, a 422's field `errors` and a 429's `retryAfter`.
Narrow with `instanceof` to read them. `select()` and `requote()` never reject;
failures land on `state.error`.

`CheckoutState` is `{invoice, wallets, walletsError, isLoading, notFound, error,
isTerminal, mutating}` — one `mutating` flag covers select and requote, since they
supersede each other.

---

## Shadow DOM + Tailwind v4

Tailwind v4 emits its theme variables to `:root`, which does not exist inside a shadow
tree. `src/widget/mount.ts` and `src/ui/theme.css` carry the reasoning in full — read
them before changing either. The shape of it: `@theme inline` + `--cf-*` tokens on
`:host`; the sheet imported as a string and injected into the shadow root; and
Tailwind's `@property --tw-*` rules **also** injected into the host document, the only
scope where browsers honour them. Do not "clean that last one up".

Accent seam: `--cf-accent` (merchant `theme.accent`, else the store's `brand_color` on
first load — `mount.ts` `applyAccent`, called from `session.tsx` `onReady`). Dark mode:
`:host([data-theme="dark"])`, re-resolved live for `mode: 'auto'`.

Verify after any CSS change: `npm run build`, then confirm `dist/coinfat.js` contains
`--cf-primary` and `:host` and zero `:root`. Keep it as a regression guard, not as
proof of isolation — Tailwind 4.3 already emits `:root, :host`, so the
`replaceAll(":root", ":host")` in `mount.ts` is a no-op today.

---

## Backend contract

The public checkout surface this SDK is built against:

- `GET  /api/v1/checkout/{ulid}` — the `Checkout` resource (payer-safe; branding in
  `store`). Its `supported_wallets` is a coin list **without** networks — do not use
  it to drive the coin picker.
- `GET  /api/v1/checkout/{ulid}/wallets` — the invoice's **payable** coins, each
  grouped with its **active** networks; coins with no active network are omitted. This
  is the picker's data source. Static per invoice — fetch it **once**, not in the 8s
  poll. Returns `Wallet` / `WalletNetwork` in the payer-safe subset modelled in
  `src/core/types.ts`; a network's icon is `execution_fee_wallet ?? wallet`.
- `POST /api/v1/checkout/{ulid}/select` — body `{wallet_network_id}` (the network `id`
  from the wallets endpoint).
- `POST /api/v1/checkout/{ulid}/requote`.

CORS is open + credential-less for these paths; rate-limited per invoice+IP (expect
occasional `429` — back off). The types in `src/core/types.ts` mirror the backend's
schemas — keep them in sync.

---

## Tooling & commands

- `npm run dev` — Vite dev server + the `dev.tsx` harness (append `?invoice=<ulid>`
  and run the backend at `localhost:8000`).
- `npm run build` — `vite build` (ES + UMD), a second `vite build` for the IIFE
  `<script>` global (`vite.config.iife.ts`), then `tsc` declarations.
- `npm run typecheck` — `tsc -b` (covers `src` and `test`).
- `npm test` — Vitest + jsdom, run once. `npm run test:watch` to iterate.
- `npm run test:browser` — Playwright; reads `dist/`, so build first.
- `npm run format` — Prettier (80 cols, no trailing commas, `bracketSameLine`,
  `bracketSpacing: false`, double quotes).

Prefer official scaffolding commands over hand-written boilerplate. Use sub-agents for
bulky parallel work, and hold them to the documentation rule below.

---

## Commit messages

This repository is public and history is not rewritten, so a message is permanent the
moment it lands.

- **No attribution trailers.** Never append `Claude-Session:`, `Co-Authored-By: Claude`
  or any session/tool identifier. `attribution` is empty in
  [`.claude/settings.json`](./.claude/settings.json); treat this line as the backstop.
- Describe the change and the reasoning. Do not describe internal systems, deployment
  status, commercial arrangements, or anything a reader outside the team has no
  business knowing.

---

## Reporting rule: be concise

Applies to **every agent and sub-agent**, and to review as much as to authoring —
repeat it in sub-agent prompts.

- Lead with the answer. No restating the question, no recap the diff already shows.
- Findings: one line each — file:line, the defect, the fix.
- Skip the options you rejected and the caveats nobody asked for. Long output needs a
  reason: a real trade-off, or a decision that is the user's to make.
- Citing docs is not an exception — cite the URL, don't narrate the reading.

---

## Documentation rule (non-negotiable)

**Never answer from memory about a library's API, defaults, or behaviour. Fetch the
current docs first.** This repo's surface — Tailwind v4's `@theme`/`@property`
emission, Preact hook and render semantics, Vite 8 library mode, TS 6 — is on
fast-moving majors where training data is stale or wrong. The `@property`-inside-a-
shadow-root bug surfaced only by reading compiled output against current docs.

Applies to **every agent and sub-agent**, authoring and review alike. A sub-agent
prompt that involves a library API must repeat this rule.

**Context7 MCP** is configured in [`.mcp.json`](./.mcp.json) and auto-enabled in
[`.claude/settings.json`](./.claude/settings.json): call
`mcp__context7__resolve-library-id` for the library ID, then
`mcp__context7__query-docs`. The anonymous tier needs no key; export
`CONTEXT7_API_KEY` in your own environment for higher limits, never in this tree.
If the tools are absent (MCP config changes need a client restart), use `WebFetch`
against the official docs sites — not memory. Both paths are pre-allowlisted.

Pin lookups to the **installed** major/minor. Re-read this against `package.json`
before trusting it:

| Library               | Installed | Docs                                                 |
| --------------------- | --------- | ---------------------------------------------------- |
| `preact`              | 10.29.x   | https://preactjs.com/guide/v10/                      |
| `tailwindcss`         | 4.3.x     | https://tailwindcss.com/docs                         |
| `@tailwindcss/vite`   | 4.3.x     | https://tailwindcss.com/docs/installation/using-vite |
| `vite`                | 8.1.x     | https://vite.dev/guide/build#library-mode            |
| `typescript`          | 6.0.x     | https://www.typescriptlang.org/docs/                 |
| `@preact/preset-vite` | 2.10.x    | https://github.com/preactjs/preset-vite              |

Web platform behaviour (Shadow DOM, `@property` registration scope, constructable
stylesheets, `matchMedia`, `AbortController`) is equally in scope: check MDN.

---

## Status

Shipped: the framework-neutral core (config, api incl. the wallets endpoint,
poll/state engine, the `CheckoutApiError` contract), shadow-DOM mount with Tailwind
isolation, inline + modal + drop-in-button presenters, the full checkout UI
(`PayPanel`, `CoinSelect` with the post-detection coin lock, `Terminal`), the i18n
seam (`en` only), theming (accent + light/dark), modal a11y (focus trap, scroll lock,
Escape) and its attribution badge, the three build formats (ESM, UMD, IIFE) with
examples, and a Vitest + jsdom suite.

Published under MIT. `src/core/config.ts` maps production → `https://api.coinfat.com`
and development → `https://test-api.coinfat.com`; the packaged script targets both.

Style isolation, the focus trap and the badge's clearance — the three things jsdom
cannot judge — are covered by a hermetic Playwright suite (`npm run test:browser`,
chromium/firefox/webkit) against `dist/coinfat.iife.js`.
