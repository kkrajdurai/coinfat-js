/**
 * Modal chrome a11y: dialog semantics, Escape / backdrop close, host scroll lock, focus
 * restore, and the Tab trap. Rendered in plain DOM, so `getRootNode()` resolves to
 * `document` — the trap logic is identical.
 */

import {render} from "preact";
import {act} from "preact/test-utils";
import {afterEach, describe, expect, it, vi} from "vitest";
import {BRAND} from "../src/core/brand.js";
import {Modal, useCloseRequest} from "../src/ui/Modal.js";
import type {CloseConfirmReason} from "../src/ui/closeGuard.js";

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
    // At max-w-sm (24rem) the card never reaches the pay panel's @md (28rem) split,
    // which made layout:"wide" a no-op for modals.
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

    dialog.parentElement!.click();
    expect(onClose).toHaveBeenCalledTimes(2);

    // The outer mask too — the scroll region is inset from its bottom edge to clear the
    // badge, so that strip is clickable mask in its own right.
    host!.querySelector<HTMLElement>(".fixed.inset-0")!.click();
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it("credits Coinfat outside the dialog, without anything for the trap to catch", () => {
    const dialog = open(() => {});
    const badge = host!.querySelector<HTMLElement>('div[aria-hidden="true"]')!;

    expect(badge.textContent).toContain(BRAND.name);
    // Outside the dialog and inert: the trap enumerates focusables within dialogRef
    // only, and `pointer-events-none` keeps its corner clickable through to the mask.
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

  it("returns focus to an opener that lives in a shadow tree", () => {
    // The shape the SDK's own drop-in button opens from.
    const shadowHost = document.createElement("div");
    document.body.appendChild(shadowHost);
    const root = shadowHost.attachShadow({mode: "open"});
    const button = document.createElement("button");
    root.appendChild(button);
    button.focus();
    expect(root.activeElement).toBe(button);

    open(() => {});
    close();

    expect(root.activeElement).toBe(button);
    shadowHost.remove();
  });

  describe("the close guard", () => {
    // A stand-in for the controller: `reason` is what the modal consults, `poll()`
    // is a state change landing under an already-open prompt.
    let reason: CloseConfirmReason | null;
    let listeners: Array<() => void>;

    const poll = (next: CloseConfirmReason | null) => {
      reason = next;
      act(() => listeners.forEach((l) => l()));
    };
    const settle = () => poll(null);

    const guarded = (
      onClose: () => void,
      initial: CloseConfirmReason = "detected"
    ) => {
      reason = initial;
      listeners = [];
      host = document.createElement("div");
      document.body.appendChild(host);
      act(() => {
        render(
          <Modal
            layout="narrow"
            onClose={onClose}
            closeGuard={{
              reason: () => reason,
              subscribe: (listener) => {
                // Matches CheckoutController.subscribe, which calls back
                // synchronously — the detail the raise-time race turns on.
                listeners.push(listener);
                listener();
                return () => {
                  listeners = listeners.filter((l) => l !== listener);
                };
              }
            }}>
            <button>Pay</button>
          </Modal>,
          host!
        );
      });
      return host.querySelector<HTMLElement>('[role="dialog"]')!;
    };

    // Raising the prompt is a state update, so the dispatch has to be flushed.
    const escape = (dialog: HTMLElement) => act(() => key(dialog, "Escape"));
    const prompt = () =>
      host!.querySelector<HTMLElement>('[role="alertdialog"]');
    const button = (text: string) =>
      Array.from(host!.querySelectorAll("button")).find((b) =>
        b.textContent?.includes(text)
      )!;

    it("asks instead of closing, on every exit the modal owns", () => {
      const onClose = vi.fn();
      const dialog = guarded(onClose);

      act(() => dialog.parentElement!.click());
      expect(onClose).not.toHaveBeenCalled();
      expect(prompt()).toBeTruthy();

      act(() => button("Keep checkout open").click());
      expect(prompt()).toBeFalsy();

      // Escape is the bypass to watch: guarding only the backdrop leaves it one key away.
      escape(dialog);
      expect(onClose).not.toHaveBeenCalled();
      expect(prompt()).toBeTruthy();
    });

    it("closes for real once confirmed", () => {
      const onClose = vi.fn();
      const dialog = guarded(onClose);

      escape(dialog);
      act(() => button("Close anyway").click());
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("hands focus back to the dialog when the prompt goes away", () => {
      // The prompt's buttons unmount with it. Without this the dialog stops receiving
      // keys at all and Escape does nothing.
      const dialog = guarded(() => {});

      escape(dialog);
      act(() => button("Keep checkout open").click());

      expect(document.activeElement).toBe(dialog);
    });

    it("keeps the checkout mounted behind the prompt", () => {
      // Hidden, not unmounted — an unmount would reset a coin picker mid-switch.
      const dialog = guarded(() => {});
      escape(dialog);

      expect(button("Pay")).toBeTruthy();
      expect(button("Pay").closest("div[class~='hidden']")).toBeTruthy();
    });

    it("dismisses on Escape without closing the checkout", () => {
      const onClose = vi.fn();
      const dialog = guarded(onClose);

      escape(dialog);
      expect(prompt()).toBeTruthy();

      escape(dialog);
      expect(prompt()).toBeFalsy();
      expect(onClose).not.toHaveBeenCalled();
    });

    it("scopes the Tab trap to the prompt", () => {
      // The trap reads `confirmRef`. Naming that prop `ref` silently handed it a Preact
      // component instead of the div, so every Tab threw and focus walked out of the
      // widget entirely — onto the merchant's own page.
      const dialog = guarded(() => {});
      escape(dialog);

      const inPrompt = Array.from(prompt()!.querySelectorAll("button"));
      expect(inPrompt).toHaveLength(2);

      inPrompt[inPrompt.length - 1].focus();
      expect(() => key(dialog, "Tab")).not.toThrow();
      expect(document.activeElement).toBe(inPrompt[0]); // wrapped, not escaped
    });

    it("retracts itself if the invoice settles while it is up", () => {
      // Otherwise "you haven't sent your payment yet" sits over a paid invoice.
      const dialog = guarded(() => {});
      escape(dialog);
      expect(prompt()).toBeTruthy();

      settle();

      expect(prompt()).toBeFalsy();
      expect(document.activeElement).toBe(dialog);
    });

    it("rewords itself if the reason changes while it is up", () => {
      // The other half of the same hazard: funds arriving under a prompt that still
      // claims nothing has been sent, right next to "Close anyway".
      const dialog = guarded(() => {}, "awaiting");
      escape(dialog);
      expect(prompt()!.textContent).toContain("haven't sent");

      poll("detected");

      expect(prompt()!.textContent).toContain("still being confirmed");
    });

    it("keeps focus in the prompt when the mask is clicked again", () => {
      // The real click blurs the button to <body>, which is outside the shadow root, so
      // the dialog stops seeing keys. Re-setting the same state is a Preact no-op, so
      // only an explicit refocus saves it.
      const dialog = guarded(() => {});
      escape(dialog);
      (document.activeElement as HTMLElement).blur();

      act(() => dialog.parentElement!.click());

      expect(document.activeElement).toBe(button("Keep checkout open"));
    });

    it("focuses the safe action, not the destructive one", () => {
      const dialog = guarded(() => {});
      escape(dialog);

      expect(document.activeElement).toBe(button("Keep checkout open"));
    });

    it("survives the reason clearing in the same flush that raises the prompt", () => {
      // `subscribe` calls its listener synchronously, so a poll landing a terminal
      // invoice between the click and Preact's flush retracts the prompt from inside
      // the subscribe effect — while the focus effect is still queued behind it. Run
      // the other way round, the focus effect targets a button already unmounting and
      // focus falls to <body>, outside the shadow root, where the dialog sees no keys.
      //
      // Both the raise and the clear go inside one act(), because that is the whole
      // point: they land in the same flush.
      const dialog = guarded(() => {});

      act(() => {
        key(dialog, "Escape");
        reason = null;
      });

      expect(prompt()).toBeFalsy();
      expect(document.activeElement).toBe(dialog);
    });

    it("does not haul focus back when a poll rewords it", () => {
      // The reword arrives from an 8s timer. Moving focus off whatever the payer was
      // reaching for is the SDK yanking the pointer out of their hand.
      const dialog = guarded(() => {}, "awaiting");
      escape(dialog);
      button("Close anyway").focus();

      poll("detected");

      expect(document.activeElement).toBe(button("Close anyway"));
    });

    it("describes itself to assistive tech", () => {
      // Without aria-describedby the alertdialog announces its title and the focused
      // button, and never the reason the payer is being stopped.
      const dialog = guarded(() => {});
      escape(dialog);

      const labelled = prompt()!.getAttribute("aria-labelledby");
      const described = prompt()!.getAttribute("aria-describedby");

      // The visible title referenced, not duplicated into an aria-label.
      expect(prompt()!.getAttribute("aria-label")).toBeNull();
      expect(prompt()!.querySelector(`#${labelled}`)?.textContent).toBe(
        "Close checkout?"
      );
      expect(prompt()!.querySelector(`#${described}`)?.textContent).toContain(
        "still being confirmed"
      );
    });

    it("unsubscribes from the controller when the prompt goes", () => {
      const dialog = guarded(() => {});
      escape(dialog);
      expect(listeners).toHaveLength(1);

      act(() => button("Keep checkout open").click());
      expect(listeners).toHaveLength(0);

      escape(dialog);
      close();
      expect(listeners).toHaveLength(0);
    });

    it("offers the guarded close to the card's own exit", () => {
      // Checkout's Close button reaches the guard through this context. Without it the
      // card's own exit walks straight past the warning.
      const onClose = vi.fn();
      let seen: (() => void) | null = null;
      const Probe = () => {
        seen = useCloseRequest();
        return null;
      };

      reason = "detected";
      listeners = [];
      host = document.createElement("div");
      document.body.appendChild(host);
      act(() => {
        render(
          <Modal
            layout="narrow"
            onClose={onClose}
            closeGuard={{
              reason: () => reason,
              subscribe: (listener) => {
                // Matches CheckoutController.subscribe, which calls back
                // synchronously — the detail the raise-time race turns on.
                listeners.push(listener);
                listener();
                return () => {
                  listeners = listeners.filter((l) => l !== listener);
                };
              }
            }}>
            <Probe />
          </Modal>,
          host!
        );
      });

      expect(seen).toBeTypeOf("function");
      act(() => seen!());
      expect(onClose).not.toHaveBeenCalled();
      expect(prompt()).toBeTruthy();
    });
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
