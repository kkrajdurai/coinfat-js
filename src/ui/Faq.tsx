/**
 * The payer FAQ: the questions a crypto checkout gets asked, answered without leaving
 * the card.
 *
 * A view swapped INTO the card rather than a panel laid over it — the same call
 * `CloseConfirm` documents in Modal.tsx. A second `role="dialog"` would mean two
 * `aria-modal` elements, two focus traps and an ambiguous Escape; and inline, which has
 * no overlay to lay anything over, would need a second implementation of the thing most
 * merchants actually embed.
 *
 * Content comes from the string table, so it translates and a merchant can replace it —
 * see `strings/types.ts`. Nothing here fetches: every fact an answer can name is already
 * on the loaded invoice.
 */

import {useEffect, useId, useRef, useState} from "preact/hooks";
import type {Checkout as Invoice} from "../core/types.js";
import {chainName} from "./payment.js";
import {ArrowLeftIcon, ExpandIcon, LinkButton} from "./primitives.js";
import {useStrings} from "./strings/context.js";
import type {CheckoutStrings, FaqContext, FaqEntry} from "./strings/index.js";

/** What the answers may interpolate, read off the invoice. */
export function faqContext(invoice: Invoice): FaqContext {
  const payment = invoice.active_payment;
  const network = payment?.wallet_network ?? null;

  return {
    status: invoice.status,
    // Cased exactly as `paymentAmounts` does it, so the FAQ and the chain warning name
    // the coin the same way on the same screen.
    symbol: payment ? payment.wallet.symbol.toUpperCase() : "",
    // The CHAIN, not the pair — `wallet_network.name` calls USDT-on-Tron
    // "USDT (Tron)", which would read as "on USDT (Tron)" mid-sentence.
    network: network ? chainName(network) : "",
    confirmations: network?.confirmation ?? 0,
    store: invoice.store.name
  };
}

/**
 * Which questions apply, by id. Kept here rather than in the string tables so a locale
 * carries copy and nothing else: translating must never mean re-encoding when a
 * question is relevant. An entry with no rule — including any a merchant adds — always
 * shows.
 *
 * Most of the table is about paying, and a settled invoice cannot be paid: it keeps its
 * `active_payment`, so nothing else here would filter those out.
 */
const pending = ({status}: FaqContext): boolean => status === "pending";

const RELEVANT: Record<string, (context: FaqContext) => boolean> = {
  "how-to-pay": pending,
  "where-to-get-crypto": pending,
  "wrong-coin": (context) =>
    pending(context) && !!context.symbol && !!context.network,
  "wrong-amount": (context) => pending(context) && !!context.symbol,
  timer: pending,
  "how-long": (context) =>
    pending(context) && !!context.network && context.confirmations > 0,
  // Still worth answering once it is paid; pointless once it never can be.
  "paid-next": ({status}) => status === "pending" || status === "completed",
  // The only question a dead invoice raises, and the reason the trigger stays put on
  // terminal states at all.
  "expired-next": ({status}) => status === "expired" || status === "canceled"
};

/**
 * The entries to show for this invoice. Exported because the header trigger must not
 * appear when there is nothing behind it — an empty `strings.faq`, or a set of
 * questions that all need a coin the payer has yet to choose.
 */
export function faqEntries(
  strings: CheckoutStrings,
  context: FaqContext
): FaqEntry[] {
  // `hasOwn`, not a bare lookup: the ids are merchant-supplied, and one of `__proto__`
  // resolves to a non-callable inherited value that throws through the whole card.
  return strings.faq.filter((entry) =>
    Object.hasOwn(RELEVANT, entry.id) ? RELEVANT[entry.id](context) : true
  );
}

export function Faq({
  entries,
  context,
  invoice,
  onClose
}: {
  entries: FaqEntry[];
  context: FaqContext;
  invoice: Invoice;
  onClose: () => void;
}) {
  const strings = useStrings();
  const backRef = useRef<HTMLButtonElement>(null);
  // One answer at a time: the list is the navigation, and a screen of expanded answers
  // buries it.
  const [openId, setOpenId] = useState<string | null>(null);

  // The FAQ replaces the card's body, so focus has to come with it — otherwise it sits
  // on a trigger that is still there but no longer describes the view.
  useEffect(() => {
    backRef.current?.focus();
  }, []);

  const {store} = invoice;
  const contact = store.website_url || mailto(store.support_email);

  return (
    <div class="mt-4">
      <div class="flex items-center gap-2">
        <button
          ref={backRef}
          type="button"
          aria-label={strings.faqBack}
          onClick={onClose}
          class="-ms-1 inline-flex rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <ArrowLeftIcon />
        </button>
        <h2 class="font-heading text-sm font-semibold">{strings.faqTitle}</h2>
      </div>

      <div
        // The cap is a runaway guard for a merchant-extended `strings.faq`, NOT the
        // everyday case: at 37rem the bundled table clears its tallest open answer (the
        // rate-lock one, 547px) in a slot as narrow as 300px, so the stock FAQ never
        // scrolls and never clips a question through the middle of its letterforms —
        // which reads as broken rather than as "more below". The browser suite sweeps
        // every answer at that width, so lengthening one of them fails loudly rather
        // than silently starting to clip. `overscroll-contain` keeps a flick at the end
        // of a list that does scroll off the host page behind it.
        class="mt-3 max-h-[37rem] divide-y divide-border overflow-y-auto overscroll-contain">
        {entries.map((entry) => (
          <FaqItem
            key={entry.id}
            entry={entry}
            context={context}
            open={entry.id === openId}
            onToggle={() =>
              setOpenId((current) => (current === entry.id ? null : entry.id))
            }
          />
        ))}
      </div>

      {contact ? (
        <div class="mt-4">
          <LinkButton href={contact} variant="outline">
            {strings.faqContact(store.name)}
          </LinkButton>
        </div>
      ) : null}
    </div>
  );
}

/**
 * One disclosure. The heading wrapper and the `aria-expanded`/`aria-controls` pair are
 * the accordion pattern; `role="region"` on the answers is deliberately NOT, since the
 * APG warns off it past roughly six panels — eight of them would flood a screen
 * reader's landmark list.
 * https://www.w3.org/WAI/ARIA/apg/patterns/accordion/
 */
function FaqItem({
  entry,
  context,
  open,
  onToggle
}: {
  entry: FaqEntry;
  context: FaqContext;
  open: boolean;
  onToggle: () => void;
}) {
  const panelId = useId();

  return (
    <div>
      <h3>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={onToggle}
          class="flex w-full items-start gap-3 rounded-md py-3 text-start text-xs font-medium transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <span class="min-w-0 flex-1">{entry.q(context)}</span>
          <span class={open ? "text-primary" : "text-muted-foreground"}>
            <ExpandIcon open={open} />
          </span>
        </button>
      </h3>
      <p
        id={panelId}
        // Hidden, not unmounted: `aria-controls` above has to keep pointing at
        // something, and `display: none` is what takes a collapsed answer out of the
        // a11y tree.
        class={
          open
            ? "pb-3 pe-7 text-xs leading-relaxed text-muted-foreground"
            : "hidden"
        }>
        {entry.a(context)}
      </p>
    </div>
  );
}

/** A support address is only useful as a link. Absent one, there is nothing to link. */
const mailto = (email: string | null): string | null =>
  email ? `mailto:${email}` : null;
