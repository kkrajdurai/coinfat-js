import {Fragment, type ComponentChildren} from "preact";
import {useEffect, useRef} from "preact/hooks";
import {BRAND} from "../core/brand.js";
import type {WidgetLayout} from "../core/options.js";
import {BrandMarkIcon} from "./primitives.js";
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
}

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
export function Modal({children, onClose, layout}: ModalProps) {
  const strings = useStrings();
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }

    // The opener (the merchant's button) is what had focus; restore it on close.
    const opener = document.activeElement as HTMLElement | null;
    dialog.focus();

    const unlockScroll = lockHostScroll();

    return () => {
      unlockScroll();
      opener?.focus?.();
    };
  }, []);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      onClose();
      return;
    }
    if (event.key !== "Tab") {
      return;
    }

    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }

    const items = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));
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
    if (event.target === event.currentTarget) onClose();
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
              {children}
            </div>
          </div>
        </div>
      </div>

      <PoweredBy />
    </Fragment>
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
