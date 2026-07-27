import {render, type ComponentChild} from "preact";
import {BRAND} from "../core/brand.js";
import type {CheckoutTheme, ThemeMode} from "../core/options.js";
import themeCss from "../ui/theme.css?inline";

/*
 * A `:root` outside the shadow root never matches inside it, so any Tailwind theme
 * block still emitted that way is rewritten to `:host`. Tailwind 4.3 already emits
 * `:root, :host`, so this is a guardrail rather than load-bearing today. The bundler
 * constant-folds it, which is what keeps `dist` free of `:root` at all.
 */
const SCOPED_THEME = themeCss.replaceAll(":root", ":host");

/*
 * Tailwind v4 registers its internal `--tw-*` variables with `@property`, and those
 * rules are inert inside a shadow tree — the spec makes registrations document-global
 * rather than tree-scoped, but no engine ships that
 * (https://drafts.css-houdini.org/css-properties-values-api/#registering-custom-properties).
 * Tailwind's own fallback block is gated behind an `@supports` that only matches
 * older Safari/Firefox, so on Chrome `--tw-border-style` and the `--tw-*-shadow`
 * chain stay unset, every `var()` in `.border` / `.shadow-*` is invalid at
 * computed-value time, and the widget renders with no borders and no shadows.
 *
 * So the rules are lifted out and also injected into the host DOCUMENT, where
 * registration does work. They stay in the shadow sheet too — harmless today, and
 * correct on any engine that ships the spec'd behaviour later.
 */
const AT_PROPERTY_RULE = /@property\s+--[\w-]+\s*\{[^}]*\}/g;
const PROPERTY_RULES = (SCOPED_THEME.match(AT_PROPERTY_RULE) ?? []).join("\n");
/** The marker merchants can hang their own `[data-coinfat] { … }` rules off. */
const HOST_ATTR = `data-${BRAND.slug}`;
const PROPERTY_STYLE_ATTR = `${HOST_ATTR}-properties`;

export interface ShadowMount {
  host: HTMLElement;
  appRoot: HTMLElement;
  unmount: () => void;
}

/** Create a style-isolated shadow host with the theme injected. Not yet attached. */
export function createShadowHost(options: CheckoutTheme = {}): ShadowMount {
  registerCustomProperties();

  const host = document.createElement("div");
  host.setAttribute(HOST_ATTR, "");

  const shadow = host.attachShadow({mode: "open"});

  const style = document.createElement("style");
  style.textContent = SCOPED_THEME;
  shadow.appendChild(style);

  const appRoot = document.createElement("div");
  // Base typography lives on this inner element, not just `:host`. `:host` is part of
  // the outer document, so a merchant's `* { font-family: … !important }` beats it and
  // the widget would inherit the page font; an outer selector cannot reach an element
  // inside the shadow tree, so pinning it here is immune. See `.cf-app` in theme.css.
  appRoot.className = "cf-app";
  shadow.appendChild(appRoot);

  if (options.accent) {
    applyAccent(host, options.accent);
  }

  const mode = options.mode ?? "auto";
  applyMode(host, mode);
  // 'auto' should keep following the OS across a mid-checkout theme toggle, not just
  // resolve once at mount.
  const stopFollowing = followSystemMode(host, mode);

  return {
    host,
    appRoot,
    unmount: () => {
      stopFollowing();
      render(null, appRoot);
      host.remove();
    }
  };
}

/**
 * Point the accent at `hex`: `--cf-accent` drives `--cf-primary`, and
 * `--cf-primary-foreground` is recomputed to stay legible on it (its default is a
 * near-black tuned for the brand orange, which a dark accent would render invisible).
 */
export function applyAccent(host: HTMLElement, hex: string): void {
  // Gate on a parseable hex: an unparseable value is still a VALID custom-property
  // token, so setting --cf-accent to garbage makes var(--cf-accent, …) skip the
  // brand fallback and leaves --cf-primary invalid-at-computed-value — every button
  // loses its fill. `readableOn` returning null is the same "can't parse it" signal.
  const foreground = readableOn(hex);

  if (!foreground) {
    return;
  }

  host.style.setProperty("--cf-accent", hex);
  host.style.setProperty("--cf-primary-foreground", foreground);
}

export function renderApp(mount: ShadowMount, vnode: ComponentChild): void {
  render(vnode, mount.appRoot);
}

/**
 * Inject Tailwind's `@property` registrations into the host document — the only
 * scope where browsers honour them (see PROPERTY_RULES). Idempotent across every
 * widget on the page and across two copies of the SDK, and never removed on
 * unmount: another widget may still rely on them.
 *
 * The one thing the widget puts outside its shadow root, and safe there because
 * `@property` declares only `--tw-*` custom properties, all `inherits: false` — no
 * selectors, no styles, nothing that can reach the merchant's page.
 */
function registerCustomProperties(): void {
  if (
    !PROPERTY_RULES ||
    document.querySelector(`style[${PROPERTY_STYLE_ATTR}]`)
  ) {
    return;
  }

  const style = document.createElement("style");
  style.setAttribute(PROPERTY_STYLE_ATTR, "");
  style.textContent = PROPERTY_RULES;
  (document.head ?? document.documentElement).appendChild(style);
}

/**
 * Black or white, whichever stays legible on `hex`: WCAG relative luminance against
 * the 0.179 threshold that maximises the worse of the two contrast ratios. Null for
 * anything it cannot parse, which leaves the default in place.
 * https://www.w3.org/WAI/GL/wiki/Relative_luminance
 */
function readableOn(hex: string): string | null {
  const match = /^#?([\da-f]{3}|[\da-f]{6})$/i.exec(hex.trim());

  if (!match) {
    return null;
  }

  const digits =
    match[1].length === 3
      ? match[1].replace(/./g, (char) => char + char)
      : match[1];

  const channel = (offset: number) => {
    const value = parseInt(digits.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };

  const luminance =
    0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);

  return luminance > 0.179 ? "#181818" : "#ffffff";
}

function applyMode(host: HTMLElement, mode: ThemeMode): void {
  const dark = mode === "dark" || (mode === "auto" && prefersDark());

  if (dark) {
    host.setAttribute("data-theme", "dark");
  } else {
    host.removeAttribute("data-theme");
  }
}

/** Re-resolve 'auto' on OS theme changes. Returns a no-op teardown for other modes. */
function followSystemMode(host: HTMLElement, mode: ThemeMode): () => void {
  if (mode !== "auto" || typeof matchMedia !== "function") {
    return () => {};
  }

  const query = matchMedia("(prefers-color-scheme: dark)");
  const onChange = () => applyMode(host, "auto");
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function prefersDark(): boolean {
  return (
    typeof matchMedia === "function" &&
    matchMedia("(prefers-color-scheme: dark)").matches
  );
}

export function resolveElement(
  target?: string | HTMLElement
): HTMLElement | null {
  if (!target) {
    return null;
  }

  return typeof target === "string"
    ? document.querySelector<HTMLElement>(target)
    : target;
}
