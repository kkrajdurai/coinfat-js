import {render, type ComponentChild} from "preact";
import {BRAND} from "../core/brand.js";
import type {CheckoutTheme, ThemeMode} from "../core/options.js";
import themeCss from "../ui/theme.css?inline";

/*
 * A `:root` never matches inside a shadow tree, so any theme block still emitted that
 * way is rewritten to `:host`. Tailwind 4.3 already emits `:root, :host`, so this is a
 * guardrail today; the bundler constant-folds it, which keeps `dist` free of `:root`.
 */
const SCOPED_THEME = themeCss.replaceAll(":root", ":host");

/*
 * Tailwind v4 registers its internal `--tw-*` variables with `@property`, and those
 * rules are INERT inside a shadow tree: the spec makes registrations document-global,
 * but no engine ships that
 * (https://drafts.css-houdini.org/css-properties-values-api/#registering-custom-properties).
 * Tailwind's own fallback is gated behind an `@supports` matching only older
 * Safari/Firefox, so on Chrome `--tw-border-style` and the `--tw-*-shadow` chain stay
 * unset, every `var()` in `.border` / `.shadow-*` is invalid at computed-value time,
 * and the widget renders with no borders and no shadows.
 *
 * So the rules are lifted out and also injected into the host DOCUMENT, where
 * registration works. They stay in the shadow sheet too — harmless today, correct on
 * any engine that later ships the spec'd behaviour.
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
  // Base typography is pinned on this inner element rather than only on `:host`, which
  // a merchant's `* { … !important }` can outrank. See `.cf-app` in theme.css.
  appRoot.className = "cf-app";
  shadow.appendChild(appRoot);

  if (options.accent) {
    applyAccent(host, options.accent);
  }

  const mode = options.mode ?? "auto";
  applyMode(host, mode);
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
  // Gate on a parseable hex: garbage is still a VALID custom-property token, so
  // setting it makes var(--cf-accent, …) skip the brand fallback and leaves
  // --cf-primary invalid-at-computed-value — every button loses its fill.
  const rgb = parseHex(hex);

  if (!rgb) {
    return;
  }

  host.style.setProperty("--cf-accent", hex);
  host.style.setProperty("--cf-primary-foreground", readableOn(rgb));
  // Both variants, so a live light/dark switch needs no JS: theme.css picks one.
  host.style.setProperty("--cf-accent-on-light", legibleOn(rgb, LIGHT_CARD));
  host.style.setProperty("--cf-accent-on-dark", legibleOn(rgb, DARK_CARD));
}

/**
 * The card behind accent-tinted text, mirroring `--cf-card` in theme.css. Duplicated
 * because the value is needed before the host is in the document, where nothing is
 * computed yet — keep the two in step.
 */
const LIGHT_CARD: Rgb = [255, 255, 255];
const DARK_CARD: Rgb = [23, 23, 23];

/** Small text, so the 4.5:1 floor rather than the 3:1 one for UI components. */
const MIN_CONTRAST = 4.5;

/**
 * The token's worst case is the status chip, where the accent is the label AND, at 10%,
 * the pill behind it — so the two converge as the accent moves. Aiming at the raw card
 * instead lands ~4:1 once that tint is composited in.
 */
const TINT = 0.1;

type Rgb = [number, number, number];

function parseHex(hex: string): Rgb | null {
  const match = /^#?([\da-f]{3}|[\da-f]{6})$/i.exec(hex.trim());

  if (!match) {
    return null;
  }

  const digits =
    match[1].length === 3
      ? match[1].replace(/./g, (char) => char + char)
      : match[1];

  return [0, 2, 4].map((i) => parseInt(digits.slice(i, i + 2), 16)) as Rgb;
}

const toHex = (rgb: Rgb) =>
  `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;

/** WCAG relative luminance. https://www.w3.org/WAI/GL/wiki/Relative_luminance */
function luminance([r, g, b]: Rgb): number {
  const channel = (value: number) => {
    const v = value / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };

  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * The accent nudged until it is legible AS TEXT on `surface`, by mixing toward white or
 * black — whichever the surface is further from. Returned unchanged when it already
 * passes, which is the common case; a merchant picking a mid-tone brand keeps it exactly.
 *
 * This is what `--cf-primary` cannot be: that one is a FILL, and a store branded
 * #000000 wants a black button. The same black as a status label on a near-black card
 * measures 1.15:1 — invisible.
 */
function legibleOn(accent: Rgb, surface: Rgb): string {
  const target: Rgb = luminance(surface) > 0.179 ? [0, 0, 0] : [255, 255, 255];
  const mix = (from: Rgb, to: Rgb, t: number) =>
    from.map((c, i) => c + (to[i] - c) * t) as Rgb;
  const passes = (candidate: Rgb) =>
    contrast(candidate, mix(surface, candidate, TINT)) >= MIN_CONTRAST;

  let best = accent;

  // 5% steps: enough to land just past the threshold without a solver.
  for (let t = 0; t <= 1.0001 && !passes(best); t += 0.05) {
    best = mix(accent, target, t);
  }

  return toHex(best);
}

export function renderApp(mount: ShadowMount, vnode: ComponentChild): void {
  render(vnode, mount.appRoot);
}

/**
 * Inject Tailwind's `@property` registrations into the host document — the only scope
 * where browsers honour them (see PROPERTY_RULES). Idempotent across widgets and even
 * two copies of the SDK, and never removed on unmount: another widget may still need
 * them. The one thing the widget puts outside its shadow root, and safe there because
 * `@property` declares only `--tw-*` properties, all `inherits: false` — no selectors,
 * no styles, nothing that can reach the merchant's page.
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
 * Black or white, whichever stays legible ON the accent — the 0.179 threshold
 * maximises the worse of the two contrast ratios.
 */
function readableOn(rgb: Rgb): string {
  return luminance(rgb) > 0.179 ? "#181818" : "#ffffff";
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
