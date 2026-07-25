import type {ComponentChildren} from "preact";
import {useEffect, useRef} from "preact/hooks";
import type {WidgetLayout} from "../core/options.js";
import {useStrings} from "./strings/context.js";

export interface ModalProps {
  children: ComponentChildren;
  onClose: () => void;
  /**
   * Sizes the card. `narrow` stays compact; `wide` widens it past the pay panel's
   * `@md` (28rem) split point so a modal can actually go two-column — at `max-w-sm`
   * it never could, which made `layout: "wide"` a silent no-op for modals. Still
   * `w-full`, so it collapses back on a small viewport like any other container.
   */
  layout: WidgetLayout;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Refcounted so two SDK modals open at once (or a non-LIFO close) don't restore the
// host's scroll while one is still up. First lock captures the page's own overflow;
// the last unlock puts it back.
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
 * paints the backdrop and centres the card — plus the a11y contract a `role="dialog"`
 * promises: focus moves in on open and is trapped, Escape and a backdrop click close
 * it, the host page can't scroll behind it, and focus returns to the opener on close.
 *
 * `aria-modal` declares the background inert to assistive tech; we don't set the DOM
 * `inert` on the merchant's page (the widget doesn't own it), so the keyboard trap is
 * what actually enforces it.
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

  return (
    // The overlay itself scrolls (not the host page, which is locked), so a card
    // taller than the viewport — a long coin list, an underpaid breakdown — stays
    // fully reachable instead of clipping above the fold.
    <div class="fixed inset-0 overflow-y-auto bg-black/50">
      <div
        // Click the dimmed area around the card (this wrapper) to close; clicks on
        // the card bubble to a different target and are left alone.
        class="flex min-h-full items-center justify-center p-4"
        onClick={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}>
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
  );
}
