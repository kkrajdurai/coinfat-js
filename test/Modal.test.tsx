/**
 * Modal chrome a11y: dialog semantics, Escape / backdrop close, host scroll lock,
 * focus restore, and the Tab focus trap. Rendered in plain DOM (not a shadow root),
 * so `getRootNode()` resolves to `document` — the trap logic is identical.
 */

import {render} from "preact";
import {act} from "preact/test-utils";
import {afterEach, describe, expect, it, vi} from "vitest";
import {BRAND} from "../src/core/brand.js";
import {Modal} from "../src/ui/Modal.js";

let host: HTMLDivElement | null = null;
let opener: HTMLButtonElement | null = null;

function open(
  onClose: () => void,
  children?: preactChildren,
  layout: "wide" | "narrow" = "narrow"
) {
  host = document.createElement("div");
  document.body.appendChild(host);
  act(() => {
    render(
      <Modal layout={layout} onClose={onClose}>
        {children ?? <button>Pay</button>}
      </Modal>,
      host!
    );
  });
  return host.querySelector<HTMLElement>('[role="dialog"]')!;
}

type preactChildren = Parameters<typeof Modal>[0]["children"];

function close() {
  if (host) {
    act(() => render(null, host!));
    host.remove();
    host = null;
  }
}

function key(el: Element, k: string, shiftKey = false) {
  el.dispatchEvent(
    new KeyboardEvent("keydown", {key: k, shiftKey, bubbles: true})
  );
}

afterEach(() => {
  close();
  opener?.remove();
  opener = null;
});

describe("Modal", () => {
  it("exposes dialog semantics", () => {
    const dialog = open(() => {});
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-label")).toBeTruthy();
  });

  it("widens the card for the wide layout", () => {
    // At max-w-sm (24rem) the card can never reach the pay panel's @md (28rem)
    // split, which made layout:"wide" a no-op for modals.
    expect(open(() => {}).className).toContain("max-w-sm");
    close();
    expect(open(() => {}, undefined, "wide").className).toContain("max-w-xl");
  });

  it("closes on Escape and on a click outside the card, but not on the card", () => {
    const onClose = vi.fn();
    const dialog = open(onClose);

    key(dialog, "Escape");
    expect(onClose).toHaveBeenCalledTimes(1);

    // A click on the card itself must not close.
    dialog.click();
    expect(onClose).toHaveBeenCalledTimes(1);

    // A click on the dimmed wrapper around the card closes.
    dialog.parentElement!.click();
    expect(onClose).toHaveBeenCalledTimes(2);

    // And so does the outer mask — the scroll region is inset from its bottom edge to
    // clear the attribution badge, so that strip is clickable mask in its own right.
    host!.querySelector<HTMLElement>(".fixed.inset-0")!.click();
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it("credits Coinfat outside the dialog, without anything for the trap to catch", () => {
    const dialog = open(() => {});
    const badge = host!.querySelector<HTMLElement>('div[aria-hidden="true"]')!;

    expect(badge.textContent).toContain(BRAND.name);
    // Outside the dialog and inert: the focus trap enumerates focusables within
    // dialogRef only, and `pointer-events-none` keeps the corner it covers clickable
    // through to the mask beneath.
    expect(dialog.contains(badge)).toBe(false);
    expect(badge.querySelectorAll("a, button, input, [tabindex]")).toHaveLength(
      0
    );
    expect(badge.className).toContain("pointer-events-none");
  });

  it("locks host-page scroll and restores it on close", () => {
    expect(document.body.style.overflow).toBe("");
    open(() => {});
    expect(document.body.style.overflow).toBe("hidden");
    close();
    expect(document.body.style.overflow).toBe("");
  });

  it("returns focus to the opener on close", () => {
    opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    expect(document.activeElement).toBe(opener);

    open(() => {}); // focus moves into the dialog
    expect(document.activeElement).not.toBe(opener);

    close();
    expect(document.activeElement).toBe(opener);
  });

  it("traps Tab within the dialog", () => {
    const dialog = open(
      () => {},
      <>
        <button>A</button>
        <button>B</button>
      </>
    );
    const [a, b] = Array.from(dialog.querySelectorAll("button"));

    b.focus();
    key(b, "Tab");
    expect(document.activeElement).toBe(a); // past the last → wraps to first

    key(a, "Tab", true);
    expect(document.activeElement).toBe(b); // shift past the first → wraps to last
  });
});
