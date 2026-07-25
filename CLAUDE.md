# coinfat-js — Agent Guide

This is the **embedded crypto checkout SDK** for Coinfat. A merchant drops it onto
their site to let their customer pay a Coinfat invoice inline or in a modal —
without leaving the merchant's page and without the merchant's secret API key ever
touching the browser.

This file is the source of truth for **how the project is built and why**. Read it
fully before changing anything. The SDK is **feature-complete**; see
[Status](#status) for the shipped surface.

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

These were decided deliberately. Do not revisit without a reason.

- **Preact** (not React) for the UI — ~4KB, keeps the embed light on customers'
  devices. `react`/`react-dom` are aliased to `preact/compat` in tsconfig if ever
  needed, but prefer plain Preact.
- **Shadow DOM** for style isolation — the widget renders inside a shadow root so
  host-page CSS can't break it and Tailwind's reset can't leak out. See
  [Shadow DOM + Tailwind](#shadow-dom--tailwind-v4-the-tricky-part).
- **Tailwind v4** with Coinfat's design tokens (brand orange `#ff8201`, oklch
  neutrals, Sora/Jakarta fonts, radius 0.625rem). Utilities are the _port vehicle_
  for the design (see below).
- **Polling, not realtime, for v1.** The engine polls `checkout.show` every 8s until
  a terminal status — exactly the baseline the hosted page uses. Realtime, if it
  lands, is a later and purely additive refetch-kick. Do not add it in v1.
- **Widget types:** `inline` (mounted in the merchant's markup, always fully
  rendered) and `modal` (overlay, opened via `.open()`), plus a **drop-in button**
  that opens the modal. No "compact" variant — dropped.
- **Layout is explicit** (`layout: 'wide' | 'narrow'`), not auto-detected. But
  `wide` (two-column) must responsive-collapse to single-column on narrow
  containers — a merchant picks the arrangement, the component honors physics.
- **Success:** fire `onCompleted`; redirect to `success_url` **only** if
  `redirectOnComplete` is set.
- **Env switch:** `Coinfat({ environment: 'production' | 'development' })` maps to a
  base URL; `/api/v1` is pinned by the SDK. **Defaults to `development`** — flip the
  default in `core/config.ts` when production should be the assumed target.
- **Translation seam, English-only bundle.** All payer-facing copy the SDK authors
  routes through a string table (`src/ui/strings/`), selected by a `locale` option and
  overridable per-key by a `strings` option. Only the `en` table ships today; adding a
  locale is a drop-in data file (recipe at the top of `src/ui/strings/index.ts`).
  Server-authored 4xx messages localise backend-side, not here. **Deferred:** bundling
  more locales, plural-rule machinery, RTL, and locale auto-negotiation — the seam
  exists, the packs do not.
- **Out of v1:** realtime, framework wrappers (React/Vue), a deep
  appearance/customization API (only the accent + light/dark seam exists).

---

## The design principle: port the _pattern_, not the pixels

The reference is Coinfat's own hosted checkout page. It is React; **do not copy the
JSX**. Port the _pattern_ — the flow, the state machine, and the Tailwind classes
(which transfer almost verbatim and are how we replicate the look). Everything worth
porting is already ported: the state machine into `src/core/checkout.ts`, the 8s poll
into its `subscribe` loop, and the pay/terminal/picker views into `src/ui/`.

The hosted page is a full-viewport layout. **Ours is not 1-1** — inline lives in a
merchant's slot and modal is a constrained card, so build compact, container-aware
layouts. Follow the _pattern_ and the design tokens; invent the layout.

---

## Repository layout

```
src/
  core/            framework-neutral — no Preact imports
    types.ts       backend Checkout resource types (keep in sync with the backend)
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
    primitives.tsx Button, LinkButton, Spinner, CopyField, RateLock, SVG icons
    payment.ts     pay-panel arithmetic + notice logic (no Preact — unit-tested)
    Modal.tsx      modal chrome (backdrop + centered card)
    useCheckout.ts Preact hook binding a component to a CheckoutController
    format.ts      display formatting for Money/Coin
    strings/       payer-facing copy: types + en table + resolve/context (i18n seam)
  widget/          mounting + presenters
    mount.ts       createShadowHost(): shadow root + injected CSS + Preact render
    session.tsx    CheckoutSession: inline + modal presenters, callback composition
    button.tsx     CheckoutButton: drop-in "Pay with crypto" button
  index.ts         public API — the Coinfat(...) factory
  dev.tsx          local dev harness (not published)
test/              Vitest specs for the framework-neutral core (not published)
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
`locale?: "fr"` (picks a bundled table; only `en` today) and `strings?:
{sendExactly?: "…"}` (a `CheckoutStringsOverride` merged over the locale). `locale`
also drives `Intl` **fiat** formatting (the amount-due); crypto amounts render verbatim
and are never grouped.

Callbacks are owned by the **controller**, not the view, so each transition fires once
per invoice — closing and reopening the modal must not replay `onReady`/`onCompleted`
(and with it the opt-in `success_url` redirect).

`onError` receives a **`CheckoutApiError`** (exported from the entry point), carrying
`status`, the server's `message`, any field `errors` from a 422, and `retryAfter` from
a 429. Narrow with `instanceof` to read them.

**`select()` and `requote()` never reject.** They are called fire-and-forget from click
handlers and timers, so a rejection would surface as an `unhandledrejection` on the
merchant's page. Failures land on `state.error`, exactly as `refetch()` already did.

`CheckoutState` is `{invoice, wallets, walletsError, isLoading, notFound, error,
isTerminal, mutating}` — one `mutating` flag covers both select and requote, since
they supersede each other.

---

## Shadow DOM + Tailwind v4 (the tricky part)

Tailwind v4 emits its theme variables (spacing, default palette, etc.) to `:root`,
which **does not exist inside a shadow tree**. Our solution (in `src/widget/mount.ts`):

1. `theme.css` uses `@theme inline { --color-*: var(--cf-*) }` + defines the `--cf-*`
   values on `:host` — the same pattern the frontend uses. Utilities compile to
   `var(--cf-*)` references that resolve from `:host`.
2. The stylesheet is imported as a string (`import css from "../ui/theme.css?inline"`)
   and its `:root` selectors are rewritten to `:host` before injection, so Tailwind's
   own defaults land on the shadow host too.
3. All tokens are prefixed `--cf-` because CSS custom properties **inherit through the
   shadow boundary** — an unprefixed `--primary` on the host page would leak in.
4. Tailwind's `@property --tw-*` rules are **also injected into the host document**
   (`registerCustomProperties()`), once per page. This is the one deliberate exception
   to "everything lives in the shadow root" — **do not "clean it up"**. `@property`
   inside a shadow tree is ignored by every current engine, which leaves
   `--tw-border-style` and the `--tw-*-shadow` chain unregistered and makes every
   `.border` / `.shadow-*` utility invalid at computed-value time: the widget renders
   with no borders and no shadows. It is safe to put outside the shadow root because
   `@property` declares only `--tw-*` custom properties, all `inherits: false` — no
   selectors, no styles, nothing that can touch the merchant's page.

The accent seam: `--cf-accent` (set from a merchant `theme.accent` override at mount,
else from the store's `brand_color` on first invoice load — `mount.ts` `applyAccent`,
called by `session.tsx` `onReady`) wins over the default brand orange. Dark mode:
`:host([data-theme="dark"])`, resolved from `theme.mode` at mount and, for `'auto'`,
re-resolved live on OS theme changes (`followSystemMode`).

Verify after any CSS change: `npm run build` then confirm `dist/coinfat.js` contains
`--cf-primary`, contains `:host`, and contains **zero** `:root`. Note this invariant
is weaker than it looks — Tailwind 4.3 already emits `:root, :host` on its own, so the
`replaceAll(":root", ":host")` in `mount.ts` is currently a no-op. Keep the check as a
regression guard, not as proof the isolation works.

---

## Backend contract

The public checkout surface this SDK is built against:

- `GET  /api/v1/checkout/{ulid}` — the `Checkout` resource (payer-safe; branding in
  `store`; no merchant-private fields). Its `supported_wallets` is a coin list
  **without** networks — do not use it to drive the coin picker.
- `GET  /api/v1/checkout/{ulid}/wallets` — the invoice's **payable** coins, each
  grouped with its **active** networks; coins with no active network are omitted. This
  is the coin/network picker's data source. Static per invoice — fetch it **once**, not
  in the 8s poll. Returns the standard `Wallet` / `WalletNetwork` resources — the
  anonymous caller sees the payer-safe subset modelled in `src/core/types.ts`; a
  network's icon is `execution_fee_wallet ?? wallet`.
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
- `npm run build` — `vite build` (ES + UMD) then a second `vite build` for the IIFE
  `<script>` global (`vite.config.iife.ts`), then `tsc` declarations. All self-contained.
- `npm run typecheck` — `tsc -b` (covers `src` and `test`).
- `npm test` — Vitest + jsdom, run once. `npm run test:watch` to iterate.
- `npm run format` — Prettier (config mirrors the frontend: 80 cols, no trailing
  commas, `bracketSameLine`, `bracketSpacing: false`, double quotes).

Prefer official scaffolding commands over hand-written boilerplate. Use sub-agents
for bulky parallel work and review their output — and hold them to the documentation
rule below.

---

## Commit messages

This repository is public. Commit messages are part of what ships, and history is not
rewritten, so a message is permanent the moment it lands.

- **No attribution trailers.** Never append `Claude-Session:`, `Co-Authored-By: Claude`,
  or any session/tool identifier. `attribution` is set to empty in
  [`.claude/settings.json`](./.claude/settings.json); treat this line as the backstop.
- Describe the change and the reasoning behind it. Do not describe internal systems,
  deployment status, commercial arrangements, or anything a reader outside the team
  would have no business knowing.

---

## Reporting rule: be concise

Answer plainly and stop. This applies to **every agent and sub-agent**, and to review
output as much as to authoring — repeat it in sub-agent prompts.

- Lead with the answer or the recommendation. No restating the question, no recap of
  what you just did if the diff already shows it.
- Findings: one line each — file:line, the defect, the fix. Expand only what the user
  asks to have expanded.
- Skip the tour of the options you rejected and the caveats nobody asked for.
- Long output needs a reason: a real trade-off, an explanation the user requested, or
  a decision that is theirs to make.

Grounding claims in current docs (below) is **not** an exception to this — cite the
URL, don't narrate the reading.

---

## Documentation rule (non-negotiable)

**Never answer from memory about a library's API, defaults, or behaviour. Fetch the
current docs first.** This repo's whole surface — Tailwind v4's `@theme`/`@property`
emission, Preact's hook and render semantics, Vite 8 library mode, TS 6 — is on
fast-moving majors where model training data is stale or plain wrong. The last review
found a real bug (Tailwind v4 `@property` rules being inert inside a shadow root)
that only surfaced by reading the compiled output against current docs.

This applies to **every agent and sub-agent** working in this repo, and to review as
much as to authoring. A sub-agent prompt that involves a library API must repeat this
rule.

### How

**Context7 MCP** is configured project-scoped in [`.mcp.json`](./.mcp.json) and
auto-enabled in [`.claude/settings.json`](./.claude/settings.json). Two tools:

1. `mcp__context7__resolve-library-id` — name → Context7 library ID (call first).
2. `mcp__context7__query-docs` — version-specific docs for that ID.

The anonymous tier works with no key, which is what `.mcp.json` assumes. For higher
rate limits, export a `CONTEXT7_API_KEY` in your own environment. Never put a key in
`.mcp.json` or anywhere else in the tree — this repo is public.

If the Context7 tools are not present in a given session (MCP config changes need a
client restart), that is **not** a licence to fall back on memory — use `WebFetch`
against the official docs sites instead. Both paths are pre-allowlisted in
`.claude/settings.json`.

### Versions to pin lookups to

Query the **installed** major/minor, not "latest" in the abstract. As of this
writing:

| Library               | Installed | Docs                                                 |
| --------------------- | --------- | ---------------------------------------------------- |
| `preact`              | 10.29.x   | https://preactjs.com/guide/v10/                      |
| `tailwindcss`         | 4.3.x     | https://tailwindcss.com/docs                         |
| `@tailwindcss/vite`   | 4.3.x     | https://tailwindcss.com/docs/installation/using-vite |
| `vite`                | 8.1.x     | https://vite.dev/guide/build#library-mode            |
| `typescript`          | 6.0.x     | https://www.typescriptlang.org/docs/                 |
| `@preact/preset-vite` | 2.10.x    | https://github.com/preactjs/preset-vite              |

Re-read this table against `package.json` / `node_modules` before trusting it — it is
a convenience, not the source of truth.

Web platform behaviour (Shadow DOM, `@property` registration scope, constructable
stylesheets, `matchMedia`, `AbortController`) is equally in scope: check MDN, don't
assume.

---

## Status

The SDK is **feature-complete**. Shipped: the framework-neutral core (config, api
incl. the wallets endpoint, poll/state engine, the `CheckoutApiError` contract),
shadow-DOM mount with Tailwind isolation, inline + modal + drop-in-button presenters,
the full checkout UI (`PayPanel`, `CoinSelect` coin/network picker with the
post-detection coin lock, `Terminal` states), the i18n string seam (`en` only), theming
(accent from `brand_color`/override + light/dark), modal a11y (focus trap, scroll lock,
Escape), the three build formats (ESM, UMD, IIFE) with examples, and a Vitest + jsdom
suite.

Published under MIT. `src/core/config.ts` maps production →
`https://api.coinfat.com` and development → `https://test-api.coinfat.com`; the
packaged script targets both, so a merchant's `environment` choice is the only switch.

**Open:** a real cross-browser test (Playwright / vitest browser mode) for actual style
isolation and the modal focus trap — jsdom verifies those only structurally.
