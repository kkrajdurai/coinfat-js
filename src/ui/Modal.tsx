import {
  Fragment,
  createContext,
  type ComponentChildren,
  type Ref
} from "preact";
import {useContext, useEffect, useId, useRef, useState} from "preact/hooks";
import {BRAND} from "../core/brand.js";
import type {WidgetLayout} from "../core/options.js";
import type {CloseConfirmReason} from "./closeGuard.js";
import {Button, BrandMarkIcon} from "./primitives.js";
import {useStrings} from "./strings/context.js";

export interface ModalProps {
  children: ComponentChildren;
  onClose: () => void;
  /**
   * Sizes the card. `wide` must clear the pay panel's `@md` (28rem) split point or
   * `layout: "wide"` is a silent no-op for modals — at `max-w-sm` it never could.
   * Still `w-full`, so it collapses back on a small viewport.
   */
  layout: WidgetLayout;
  /**
   * Consulted on every close attempt: a reason means the payer is asked to confirm
   * instead of closing. `subscribe` is used only while the prompt is up, to keep it
   * honest as the reason changes underneath it — retracting when it clears, rewording
   * when it changes.
   */
  closeGuard?: {
    reason: () => CloseConfirmReason | null;
    subscribe: (listener: () => void) => () => void;
  };
}

/**
 * The guarded close, for anything rendered inside the card that offers its own exit.
 * Null outside a modal — inline has nothing to close.
 */
const CloseRequestContext = createContext<(() => void) | null>(null);

export const useCloseRequest = (): (() => void) | null =>
  useContext(CloseRequestContext);

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Refcounted so two open modals (or a non-LIFO close) don't restore the host's scroll
// while one is still up. First lock captures the page's overflow, last unlock puts it
// back.
let scrollLocks = 0;
let priorOverflow = "";

function lockHostScroll(): () => void {
  if (scrollLocks++ === 0) {
    priorOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  return () => {
    if (--scrollLocks === 0) {
      document.body.style.overflow = priorOverflow;
    }
  };
}

/**
 * Modal chrome. The presenter positions the shadow host `fixed inset-0`, so this only
 * paints the backdrop, centres the card, and honours the a11y contract of
 * `role="dialog"`: focus moves in and is trapped, Escape and a backdrop click close,
 * the host page can't scroll, focus returns to the opener.
 *
 * `aria-modal` declares the background inert to assistive tech; the DOM `inert` is not
 * set on the merchant's page (the widget doesn't own it), so the keyboard trap is what
 * actually enforces it.
 */
export function Modal({children, onClose, layout, closeGuard}: ModalProps) {
  const strings = useStrings();
  const dialogRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLDivElement>(null);
  const [confirming, setConfirming] = useState<CloseConfirmReason | null>(null);

  // The prompt's safe action. Focus lives here rather than in `CloseConfirm` because it
  // has to be restorable from outside the prompt's own mount.
  const focusPrompt = () => {
    confirmRef.current?.querySelector<HTMLElement>("button")?.focus();
  };

  // The single exit every close attempt goes through — backdrop, Escape and the card's
  // own Close button alike. Guarding only the backdrop would leave Escape as a one-key
  // bypass of the warning.
  const requestClose = () => {
    // Already asking. The click that got here blurred the prompt to <body> — outside
    // the shadow root, so the dialog stops seeing keys — and re-setting `confirming`
    // to the value it already holds is a no-op Preact bails out of, so no render would
    // put focus back. Restore it explicitly instead.
    if (confirming) {
      focusPrompt();
      return;
    }

    const reason = closeGuard?.reason() ?? null;

    if (reason) {
      setConfirming(reason);
    } else {
      onClose();
    }
  };

  // Focus has to come back with the prompt, because dismissing it unmounts whichever
  // of its buttons held focus. Left alone, focus falls to the document and the dialog
  // stops receiving keys at all — Escape included, so the modal goes keyboard-dead.
  const dismissConfirm = () => {
    setConfirming(null);
    dialogRef.current?.focus();
  };

  // Focus the safe action when the prompt appears: Enter on an unread warning should
  // keep the payer where they are.
  //
  // MUST stay declared above the subscribe effect. Effects run in declaration order,
  // and `subscribe` fires its listener synchronously, so a reason that cleared between
  // the click and this flush retracts the prompt from inside that effect. Focusing
  // afterwards would land on a button about to unmount, dropping focus to <body> —
  // outside the shadow root, where the dialog sees no keys at all.
  //
  // Keyed on whether there IS a prompt, not on which one: rewording it from an 8s poll
  // must not haul the payer's focus back off the button they were reaching for.
  useEffect(() => {
    if (confirming) {
      focusPrompt();
    }
  }, [confirming !== null]);

  // Keep the open prompt honest about what it is warning over. Both transitions are
  // reachable while it sits there: the invoice settling (retract — otherwise "you
  // haven't sent your payment yet" reads over a paid one) and funds arriving (reword,
  // or "Close anyway" sits beside a claim that nothing was sent).
  useEffect(() => {
    if (!confirming || !closeGuard) {
      return;
    }

    return closeGuard.subscribe(() => {
      const next = closeGuard.reason();

      if (next) {
        setConfirming(next);
      } else {
        dismissConfirm();
      }
    });
  }, [confirming, closeGuard]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }

    // The opener is what had focus; restore it on close. Descend shadow roots, or an
    // opener inside one (the SDK's own drop-in button) reads as its unfocusable host.
    let opener = document.activeElement as HTMLElement | null;
    while (opener?.shadowRoot?.activeElement) {
      opener = opener.shadowRoot.activeElement as HTMLElement | null;
    }
    dialog.focus();

    const unlockScroll = lockHostScroll();

    return () => {
      unlockScroll();
      opener?.focus?.();
    };
  }, []);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      // Escape backs out of the prompt rather than the checkout: it is the key people
      // press to undo, so it must not close the very thing they were just warned about.
      if (confirming) {
        dismissConfirm();
      } else {
        requestClose();
      }
      return;
    }
    if (event.key !== "Tab") {
      return;
    }

    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }

    // While the prompt is up it is the whole trap. `display: none` already keeps the
    // checkout out of the tab order, so this is really a guard against `confirmRef`
    // being empty — which it silently was when the prop was named `ref`.
    const scope = confirming ? (confirmRef.current ?? dialog) : dialog;
    const items = Array.from(scope.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (items.length === 0) {
      // Nothing to move to (e.g. the loading skeleton) — keep focus on the dialog.
      event.preventDefault();
      return;
    }

    const first = items[0];
    const last = items[items.length - 1];
    // Inside a shadow tree, document.activeElement is the host; the real focus is on
    // the shadow root's activeElement.
    const active = (dialog.getRootNode() as ShadowRoot).activeElement;

    if (event.shiftKey && (active === first || active === dialog)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  // Click the dimmed area to close. Applied to every mask layer a click can land on;
  // a click on the card bubbles up with a different target and is left alone.
  const closeOnSelf = (event: MouseEvent) => {
    if (event.target === event.currentTarget) requestClose();
  };

  return (
    <Fragment>
      <div class="fixed inset-0 bg-black/50" onClick={closeOnSelf}>
        <div
          // The overlay scrolls (not the host page, which is locked), so a card taller
          // than the viewport stays fully reachable.
          //
          // `bottom-10` insets the scroll VIEWPORT to clear the attribution badge.
          // Bottom padding cannot do this: the badge is viewport-anchored, padding is
          // content-anchored, so an overflowing card scrolls the gutter away and drops
          // the badge onto an interactive control — which `pointer-events-none` then
          // lets the payer click blind. Insetting is the only gutter that holds at
          // every scroll position.
          class="absolute inset-x-0 top-0 bottom-10 overflow-y-auto">
          <div
            class="flex min-h-full items-center justify-center p-4"
            onClick={closeOnSelf}>
            <div
              ref={dialogRef}
              role="dialog"
              aria-modal="true"
              aria-label={strings.dialogLabel}
              tabIndex={-1}
              onKeyDown={onKeyDown}
              class={`relative w-full outline-none ${
                layout === "wide" ? "max-w-xl" : "max-w-sm"
              }`}>
              <div
                // Hidden, not unmounted: the checkout keeps its view state (a coin
                // picker mid-switch, a running rate lock) so backing out of the prompt
                // returns the payer exactly where they were. `display: none` already
                // takes it out of the tab order and the a11y tree, so no `aria-hidden`.
                class={confirming ? "hidden" : undefined}>
                <CloseRequestContext.Provider value={requestClose}>
                  {children}
                </CloseRequestContext.Provider>
              </div>

              {confirming ? (
                <CloseConfirm
                  containerRef={confirmRef}
                  reason={confirming}
                  onStay={dismissConfirm}
                  onLeave={onClose}
                />
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <PoweredBy />
    </Fragment>
  );
}

/**
 * The close warning, laid over the card rather than stacked as a second dialog: a
 * nested `role="dialog"` would mean two `aria-modal` elements, two focus traps and an
 * ambiguous Escape, all for two buttons. Here the dialog, the trap and the theme
 * already exist; the prompt only borrows them.
 *
 * A card in its own right rather than a layer over the checkout, so it sizes to its own
 * content: overlaying `inset-0` kept the pay panel's full height and marooned two
 * buttons in a tall empty box.
 */
function CloseConfirm({
  // NOT named `ref`: Preact strips that from props and, on a component, hands the
  // callback the component instance rather than the DOM node. The trap would then
  // scope itself to a non-element and throw on every Tab.
  containerRef,
  reason,
  onStay,
  onLeave
}: {
  containerRef: Ref<HTMLDivElement>;
  reason: CloseConfirmReason;
  onStay: () => void;
  onLeave: () => void;
}) {
  const strings = useStrings();
  const titleId = useId();
  const bodyId = useId();

  return (
    <div
      ref={containerRef}
      role="alertdialog"
      // The pattern wants the VISIBLE title referenced, not a duplicate `aria-label`,
      // and the message pointed at — or a screen reader announces the title and the
      // focused button and never the reason the payer is being stopped.
      // https://www.w3.org/WAI/ARIA/apg/patterns/alertdialog/
      //
      // No `aria-modal` here: the enclosing role="dialog" already declares it, and this
      // is nested inside that, not a second modal container.
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      class="rounded-2xl border border-border bg-card p-6 text-center text-card-foreground shadow-xl shadow-primary/5">
      <p id={titleId} class="font-heading text-base font-semibold">
        {strings.confirmCloseTitle}
      </p>
      <p id={bodyId} class="mt-2 text-xs leading-relaxed text-muted-foreground">
        {reason === "detected"
          ? strings.confirmCloseDetected
          : strings.confirmCloseAwaiting}
      </p>

      <div class="mt-5 flex flex-col gap-2">
        <Button onClick={onStay}>{strings.confirmCloseStay}</Button>
        <Button variant="outline" onClick={onLeave}>
          {strings.confirmCloseLeave}
        </Button>
      </div>
    </div>
  );
}

/**
 * Attribution, pinned to the mask rather than the card: a sibling of the scroll
 * container so it stays put while the overlay scrolls, and outside the dialog so the
 * focus trap never has to account for it. `pointer-events-none` keeps its corner
 * clickable-to-close like the rest of the mask — which is also why this is text, not a
 * link. Toned white rather than brand orange so it reads as a footer credit instead of
 * competing with the merchant's accent inside the card.
 */
function PoweredBy() {
  const strings = useStrings();

  return (
    <div
      aria-hidden="true"
      class="pointer-events-none fixed right-4 bottom-3.5 flex items-center gap-2 text-[11px] leading-none font-medium text-white/60 select-none">
      <span>{strings.poweredBy}</span>
      <span
        // Mark and wordmark are one lockup, so they sit tighter to each other than the
        // lead-in sits to them — at a single gap all three read as separate items.
        class="flex items-center gap-1">
        <BrandMarkIcon class="size-3 shrink-0 text-white/80" />
        <span class="font-heading font-semibold tracking-tight text-white/85">
          {BRAND.name}
        </span>
      </span>
    </div>
  );
}
