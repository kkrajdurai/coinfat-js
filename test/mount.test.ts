/**
 * The shadow-DOM mount seam. jsdom can't verify visual style ISOLATION (it doesn't
 * apply CSS), but it does exercise the structure and the theming logic: the shadow
 * root and injected stylesheet, the once-per-page `@property` registration, the accent
 * guard, and teardown. True cross-browser isolation is a separate browser-mode check.
 */

import {afterEach, describe, expect, it} from "vitest";
import {
  applyAccent,
  createShadowHost,
  renderApp,
  resolveElement
} from "../src/widget/mount.js";
import {h} from "preact";

const PROPERTY_ATTR = "style[data-coinfat-properties]";

afterEach(() => {
  document
    .querySelectorAll("[data-coinfat], " + PROPERTY_ATTR)
    .forEach((node) => node.remove());
});

describe("createShadowHost", () => {
  it("attaches an open shadow root with the theme and an app root", () => {
    const {host, appRoot} = createShadowHost();

    expect(host.shadowRoot).not.toBeNull();
    const style = host.shadowRoot!.querySelector("style");
    expect(style?.textContent).toContain("--cf-primary");
    expect(style?.textContent).toContain(":host");
    // The whole point of the isolation: no :root, which never matches in a shadow tree.
    expect(style?.textContent).not.toContain(":root");
    // The app root lives inside the shadow, not the light DOM.
    expect(appRoot.getRootNode()).toBe(host.shadowRoot);
  });

  it("registers @property rules in the host document exactly once", () => {
    createShadowHost();
    createShadowHost();
    // Exactly one shared style node across the two widgets — not zero (which would
    // mean registration silently no-op'd, e.g. `theme.css?inline` compiling to "").
    expect(document.querySelectorAll(PROPERTY_ATTR).length).toBe(1);
  });

  it("resolves the theme mode onto the host", () => {
    expect(
      createShadowHost({mode: "dark"}).host.getAttribute("data-theme")
    ).toBe("dark");
    expect(
      createShadowHost({mode: "light"}).host.getAttribute("data-theme")
    ).toBeNull();
  });

  it("renders into the app root and tears down on unmount", () => {
    const mount = createShadowHost();
    document.body.appendChild(mount.host);

    renderApp(mount, h("span", {class: "cf-probe"}, "hi"));
    expect(mount.host.shadowRoot!.querySelector(".cf-probe")?.textContent).toBe(
      "hi"
    );

    mount.unmount();
    expect(mount.host.isConnected).toBe(false);
    expect(mount.host.shadowRoot!.querySelector(".cf-probe")).toBeNull();
  });
});

describe("applyAccent", () => {
  it("sets the accent and a legible foreground for a dark accent", () => {
    const host = document.createElement("div");
    applyAccent(host, "#1a2b3c");

    expect(host.style.getPropertyValue("--cf-accent")).toBe("#1a2b3c");
    // Dark accent → white foreground (WCAG luminance below the threshold).
    expect(host.style.getPropertyValue("--cf-primary-foreground")).toBe(
      "#ffffff"
    );
  });

  it("picks a dark foreground for a light accent", () => {
    const host = document.createElement("div");
    applyAccent(host, "#ffe680");
    expect(host.style.getPropertyValue("--cf-primary-foreground")).toBe(
      "#181818"
    );
  });

  it("ignores an unparseable accent instead of breaking --cf-primary", () => {
    const host = document.createElement("div");
    applyAccent(host, "not-a-color");
    // Nothing set — var(--cf-accent, --cf-brand) keeps falling back to the brand.
    expect(host.style.getPropertyValue("--cf-accent")).toBe("");
  });
});

describe("resolveElement", () => {
  it("resolves a selector, an element, or nothing", () => {
    const el = document.createElement("div");
    el.id = "slot";
    document.body.appendChild(el);

    expect(resolveElement("#slot")).toBe(el);
    expect(resolveElement(el)).toBe(el);
    expect(resolveElement("#missing")).toBeNull();
    expect(resolveElement(undefined)).toBeNull();

    el.remove();
  });
});
