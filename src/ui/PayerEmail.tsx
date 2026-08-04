/**
 * "Email me when this confirms": the payer hands over an address and the backend mails
 * them once, on completion.
 *
 * An inline disclosure, not a dialog — the call `Faq` and `CloseConfirm` already made,
 * and it applies harder here: this is two rows of form, and inline (which most merchants
 * embed) has no overlay to lay a dialog over.
 *
 * There is deliberately no `<form>` element. Whether one inside a shadow root associates
 * with a `<form>` in the merchant's page is not something MDN states plainly, and the
 * failure mode — a stray submit navigating away from someone else's checkout — costs far
 * more than the Enter handler below saves.
 *
 * Lives in `PayPanel`, which is what confines it to the window the backend accepts: the
 * card swaps to `<Terminal>` on any terminal status, so the form cannot outlive the
 * invoice, and it still shows while a detected payment is confirming — which the backend
 * allows and is exactly when a payer wants to stop watching the page.
 */

import {useEffect, useId, useRef, useState} from "preact/hooks";
import type {CheckoutApiError} from "../core/api.js";
import type {CheckoutController} from "../core/checkout.js";
import {CheckIcon, MailIcon, Button} from "./primitives.js";
import {useStrings} from "./strings/context.js";
import type {CheckoutStrings} from "./strings/index.js";

export interface PayerEmailProps {
  /** `invoice.payer_email` — masked, or null while none is stored. */
  payerEmail: string | null;
  saving: boolean;
  error: CheckoutApiError | null;
  controller: CheckoutController;
}

export interface EmailFailure {
  message: string;
  /** Belongs under the input, as a verdict on what the payer typed. */
  field: boolean;
  /** The invoice stopped accepting addresses — take the whole thing off screen. */
  stale: boolean;
}

/**
 * Where a failure belongs on screen. The 429 branch is the load-bearing one: two
 * separate limits answer with it — the shared per-invoice request throttle, and a cap of
 * five address changes for the invoice's lifetime — and once the cap is reached EVERY
 * submission is rejected, including one carrying the address already stored. So a 429 is
 * never evidence that what the payer typed was wrong, and must not be rendered against
 * the field. Server copy is quoted verbatim; 4xx text localises backend-side.
 */
export function emailFailure(
  error: CheckoutApiError | null,
  strings: CheckoutStrings
): EmailFailure | null {
  if (!error) {
    return null;
  }

  const {status} = error;
  const invalid = status === 422 ? error.errors?.email?.[0] : undefined;

  if (invalid) {
    return {message: invalid, field: true, stale: false};
  }

  // A 422 carrying NO errors at all is the invoice refusing the whole operation — it is
  // no longer pending, and the poll is already on its way to a terminal state. One that
  // names some other field is still just a validation failure: taking the control away
  // over it would be unrecoverable on an invoice that is still live.
  if (status === 422 && !error.errors) {
    return {message: error.message, field: false, stale: true};
  }

  // A 5xx, a transport failure, or a 4xx with nothing worth quoting.
  const usable = status >= 400 && status < 500 && error.message;

  return {
    message: usable ? error.message : strings.networkError,
    field: false,
    stale: false
  };
}

export function PayerEmail({
  payerEmail,
  saving,
  error,
  controller
}: PayerEmailProps) {
  const strings = useStrings();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  const submission = useRef(0);
  const fieldId = useId();
  const noteId = useId();
  const errorId = useId();

  // Focus follows the disclosure, in both directions. Opening: the payer asked for the
  // field, so put the caret in it rather than making them tap twice. Closing: the
  // element holding focus is the one being unmounted, and letting focus fall to <body>
  // takes the whole modal keyboard-dead — its Escape and Tab handlers are bound to the
  // dialog, which no longer has focus inside it. `Modal.tsx` and `Checkout.tsx`'s
  // `closeFaq` both restore focus for exactly this reason.
  //
  // In an effect because in each direction the element to focus does not exist until
  // after the re-render; guarded by `wasOpen` so mounting closed does not steal focus
  // from wherever the payer actually is.
  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
    } else if (wasOpen.current) {
      triggerRef.current?.focus();
    }

    wasOpen.current = open;
  }, [open]);

  const failure = emailFailure(error, strings);
  const saved = payerEmail ?? "";

  const submit = () => {
    const email = value.trim();

    // `saving` guards the double-submit that would otherwise abort its own predecessor
    // and leave this reading the superseded call's state below.
    if (!email || saving) {
      return;
    }

    const seq = ++submission.current;

    void controller.setPayerEmail(email).then(() => {
      // `emailError` is the controller's latest verdict, not this call's — a superseded
      // submission returns without recording one. The `saving` guard above makes that
      // unreachable today; this keeps it so if the guard ever moves.
      if (seq !== submission.current) {
        return;
      }

      // Never rejects — success and failure both land on state, so that is where the
      // outcome has to be read from. Collapsing on failure would hide the message.
      if (!controller.getState().emailError) {
        setOpen(false);
        setValue("");
      }
    });
  };

  // Whatever the payer most recently needs told. A failure outranks the confirmation:
  // it is the newer news, and the one they have to act on.
  const announcement = failure
    ? failure.message
    : payerEmail
      ? strings.emailSaved(saved)
      : "";

  return (
    <div
      // Escape backs out of the form, not out of the checkout — the same collision the
      // FAQ has with the modal's handler. Local to this subtree, since the trigger that
      // reopens the form is inside it.
      onKeyDown={(event: KeyboardEvent) => {
        if (open && event.key === "Escape") {
          event.stopPropagation();
          setOpen(false);
        }
      }}>
      <span
        // Mounted whatever the state, only the text swapping: a live region inserted
        // with its content already in place is not announced, and the form collapses
        // out from under the payer on success.
        role="status"
        class="sr-only">
        {announcement}
      </span>

      {failure?.stale ? (
        <p class="rounded-xl bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {failure.message}
        </p>
      ) : open ? (
        <div class="space-y-2 rounded-xl border border-border p-3">
          <label for={fieldId} class="block text-xs font-medium">
            {strings.emailLabel}
          </label>
          <input
            ref={inputRef}
            id={fieldId}
            // `type="email"` and `inputmode` for the keyboard it summons on a phone —
            // NOT for validation. There is no <form> to validate against, and the
            // backend's verdict is the one worth showing anyway.
            type="email"
            inputMode="email"
            autocomplete="email"
            spellcheck={false}
            placeholder={strings.emailPlaceholder}
            value={value}
            // Described by the message whenever there is one, invalid only when it is a
            // verdict on the address. A 429 is context the payer needs read to them —
            // it just is not evidence that what they typed is wrong.
            aria-invalid={failure?.field ? "true" : undefined}
            aria-describedby={failure ? errorId : noteId}
            onInput={(event) =>
              setValue((event.target as HTMLInputElement).value)
            }
            onKeyDown={(event: KeyboardEvent) => {
              if (event.key === "Enter") {
                // No form, so nothing to submit by default — but a merchant's own form
                // may be listening further up, and this is not its business.
                event.preventDefault();
                submit();
              }
            }}
            class="w-full min-w-0 rounded-lg border border-border bg-transparent px-3 py-2 text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />

          {failure ? (
            <p id={errorId} class="text-xs text-destructive">
              {failure.message}
            </p>
          ) : null}

          <Button onClick={submit} busy={saving} disabled={!value.trim()}>
            {strings.emailSubmit}
          </Button>

          <p id={noteId} class="text-xs text-muted-foreground">
            {strings.emailNote}
          </p>
        </div>
      ) : payerEmail ? (
        <div class="flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-xs">
          <span class="text-success">
            <CheckIcon />
          </span>
          <span class="min-w-0 flex-1 break-words text-muted-foreground">
            {strings.emailSaved(saved)}
          </span>
          <button
            ref={triggerRef}
            type="button"
            onClick={() => setOpen(true)}
            class="shrink-0 rounded-md px-1 py-0.5 font-medium underline-offset-2 transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {strings.emailChange}
          </button>
        </div>
      ) : (
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpen(true)}
          class="flex w-full items-center justify-center gap-2 rounded-xl border border-border px-3 py-2 text-xs font-medium text-muted-foreground transition hover:bg-muted/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <MailIcon />
          {strings.emailNotify}
        </button>
      )}
    </div>
  );
}
