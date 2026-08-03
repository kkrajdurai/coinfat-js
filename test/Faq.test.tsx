/**
 * The FAQ: which questions apply to an invoice, the disclosure wiring, and the two
 * things it borrows from the card around it — Escape, and where focus goes.
 */

import {render} from "preact";
import {act} from "preact/test-utils";
import {afterEach, describe, expect, it} from "vitest";
import {CheckoutController} from "../src/core/checkout.js";
import type {Checkout, StoreInvoicePayment} from "../src/core/types.js";
import {Checkout as CheckoutView} from "../src/ui/Checkout.js";
import {Faq, faqContext, faqEntries} from "../src/ui/Faq.js";
import {I18nProvider} from "../src/ui/strings/context.js";
import {
  en,
  resolveStrings,
  type CheckoutStringsOverride
} from "../src/ui/strings/index.js";
import {fakeApi} from "./helpers.js";

const coin = (symbol: string) => ({amount: "0.5", wallet: "usdt", symbol});

// Complete enough for the pay panel to render too: these fixtures also go through the
// whole card, and a panel that throws mid-render leaves an empty host and a test that
// fails for the wrong reason.
function payment(over: Partial<StoreInvoicePayment> = {}): StoreInvoicePayment {
  return {
    ulid: "pay_1",
    status: "pending",
    wallet: {symbol: "USDT", scale: 6, precision: 6},
    wallet_network: {
      id: "net_1",
      // The pair, not the chain — `chainName` has to prefer the fee wallet.
      name: "USDT (Tron)",
      confirmation: 19,
      execution_fee_wallet: {name: "Tron"}
    },
    address: "TKihLd7k3yeZoekp1HaY6FUhSeB15F3UJM",
    deposit_uri: "tron:TKihLd7k3yeZoekp1HaY6FUhSeB15F3UJM",
    qr_code_url: "https://cdn.test/qr.png",
    expected_value: coin("USDT"),
    received_value: {...coin("USDT"), amount: "0"},
    overpaid: false,
    overpaid_value: {...coin("USDT"), amount: "0"},
    remaining_value: coin("USDT"),
    detected_at: null,
    rate_expires_at: new Date(Date.now() + 600_000).toISOString(),
    ...over
  } as unknown as StoreInvoicePayment;
}

function invoice(over: Partial<Checkout> = {}): Checkout {
  return {
    ulid: "inv_1",
    status: "pending",
    amount: {amount: "10", currency: "USD", scale: 2},
    supported_wallets: [],
    success_url: null,
    cancel_url: null,
    store: {
      name: "Acme",
      logo: null,
      brand_color: null,
      description: null,
      support_email: null,
      website_url: null
    },
    active_payment: payment(),
    ...over
  } as unknown as Checkout;
}

let host: HTMLDivElement | null = null;

function mount(node: Checkout, onClose = () => {}): HTMLDivElement {
  host = document.createElement("div");
  document.body.appendChild(host);

  const context = faqContext(node);

  // Through `act`, or the mount effect that moves focus has not run yet.
  act(() => {
    render(
      <I18nProvider value={resolveStrings()}>
        <Faq
          entries={faqEntries(en, context)}
          context={context}
          invoice={node}
          onClose={onClose}
        />
      </I18nProvider>,
      host!
    );
  });

  return host;
}

/** The ids the FAQ would offer for an invoice, in display order. */
const ask = (node: Checkout): string[] =>
  faqEntries(en, faqContext(node)).map((entry) => entry.id);

// Scoped to the disclosure buttons: the header trigger carries `aria-expanded` too.
const questions = (root: HTMLElement): HTMLButtonElement[] =>
  Array.from(root.querySelectorAll<HTMLButtonElement>("h3 button"));

const click = (element: HTMLElement) =>
  act(() => {
    element.click();
  });

afterEach(() => {
  if (host) {
    render(null, host);
    host.remove();
    host = null;
  }
});

describe("faqContext", () => {
  it("names the chain, not the coin/network pair", () => {
    expect(faqContext(invoice()).network).toBe("Tron");
  });

  it("carries the coin, the confirmations and the store", () => {
    expect(faqContext(invoice())).toMatchObject({
      symbol: "USDT",
      confirmations: 19,
      store: "Acme"
    });
  });

  it("upper-cases the coin, as the pay panel beside it does", () => {
    const node = invoice({
      active_payment: payment({wallet: {symbol: "usdt"} as never})
    });

    expect(faqContext(node).symbol).toBe("USDT");
  });

  it("is empty, not undefined, with no coin chosen", () => {
    expect(faqContext(invoice({active_payment: null}))).toMatchObject({
      symbol: "",
      network: "",
      confirmations: 0
    });
  });
});

describe("faqEntries", () => {
  it("drops the questions that need a coin the payer has not chosen", () => {
    const ids = faqEntries(en, faqContext(invoice({active_payment: null}))).map(
      (entry) => entry.id
    );

    expect(ids).not.toContain("wrong-coin");
    expect(ids).not.toContain("wrong-amount");
    expect(ids).not.toContain("how-long");
    // The coin-agnostic ones survive, so the trigger still has something behind it.
    expect(ids).toContain("how-to-pay");
  });

  it("shows every live question once a network is selected", () => {
    const ids = ask(invoice());

    expect(ids).toEqual([
      "how-to-pay",
      "where-to-get-crypto",
      "wrong-coin",
      "wrong-amount",
      "timer",
      "how-long",
      "paid-next",
      "not-received"
    ]);
  });

  // A settled invoice keeps its `active_payment`, so nothing but the status rules
  // stops "how do I pay" being answered on an invoice nobody can pay.
  it("answers a completed invoice with what is still worth asking", () => {
    expect(ask(invoice({status: "completed"}))).toEqual([
      "paid-next",
      "not-received"
    ]);
  });

  it("swaps in the dead-link question on expired and canceled", () => {
    for (const status of ["expired", "canceled"] as const) {
      expect(ask(invoice({status}))).toEqual(["expired-next", "not-received"]);
    }
  });

  it("never leaves a terminal invoice with an empty FAQ", () => {
    for (const status of ["completed", "expired", "canceled"] as const) {
      expect(ask(invoice({status})).length).toBeGreaterThan(0);
    }
  });

  it("drops the confirmation question when the network reports none", () => {
    const node = invoice({
      active_payment: payment({
        wallet_network: {
          id: "net_1",
          name: "Bitcoin",
          confirmation: 0,
          execution_fee_wallet: null
        } as never
      })
    });
    const ids = faqEntries(en, faqContext(node)).map((entry) => entry.id);

    expect(ids).not.toContain("how-long");
  });

  it("keeps an entry a merchant added under an id it has no rule for", () => {
    const extra = {id: "refunds", q: () => "Refunds?", a: () => "Ask us."};
    const {strings} = resolveStrings(undefined, {faq: [extra]});

    expect(faqEntries(strings, faqContext(invoice()))).toEqual([extra]);
  });

  // Merchant-supplied ids reach the rule table as keys. On a plain object lookup
  // `__proto__` yields a non-callable inherited value, which an optional call does not
  // guard — it throws, and takes the whole card with it.
  it("survives an entry id that collides with Object.prototype", () => {
    for (const id of [
      "__proto__",
      "hasOwnProperty",
      "toString",
      "constructor"
    ]) {
      const extra = {id, q: () => id, a: () => id};
      const {strings} = resolveStrings(undefined, {faq: [extra]});

      expect(faqEntries(strings, faqContext(invoice()))).toEqual([extra]);
    }
  });

  it("is empty when a merchant clears the table", () => {
    const {strings} = resolveStrings(undefined, {faq: []});

    expect(faqEntries(strings, faqContext(invoice()))).toEqual([]);
  });
});

describe("the FAQ view", () => {
  it("renders every applicable question collapsed", () => {
    const root = mount(invoice());
    const items = questions(root);
    const expected = ask(invoice()).length;

    expect(expected).toBeGreaterThan(1);
    expect(items).toHaveLength(expected);
    expect(items.every((item) => item.ariaExpanded === "false")).toBe(true);
    // Collapsed answers stay in the DOM for `aria-controls`, but out of the a11y tree.
    expect(root.querySelectorAll("p.hidden")).toHaveLength(expected);
  });

  it("interpolates the invoice into an answer", () => {
    const root = mount(invoice());
    click(questions(root)[2]);

    expect(root.textContent).toContain("USDT on Tron");
  });

  it("points each question at the answer it controls", () => {
    const root = mount(invoice());
    const first = questions(root)[0];
    const panel = root.querySelector(`#${first.getAttribute("aria-controls")}`);

    expect(panel?.textContent).toBe(en.faq[0].a(faqContext(invoice())));
  });

  it("opens and closes an answer", () => {
    const root = mount(invoice());
    const first = questions(root)[0];

    click(first);
    expect(first.ariaExpanded).toBe("true");
    expect(
      root.querySelector(`#${first.getAttribute("aria-controls")}`)?.className
    ).not.toContain("hidden");

    click(first);
    expect(first.ariaExpanded).toBe("false");
  });

  it("shows one answer at a time", () => {
    const root = mount(invoice());
    const [first, second] = questions(root);

    click(first);
    click(second);

    expect(first.ariaExpanded).toBe("false");
    expect(second.ariaExpanded).toBe("true");
  });

  it("takes focus, so the payer is not left on the trigger behind it", () => {
    const root = mount(invoice());

    expect(document.activeElement).toBe(
      root.querySelector(`[aria-label="${en.faqBack}"]`)
    );
  });

  it("links to the store's site when it has one", () => {
    const node = invoice();
    node.store.website_url = "https://acme.test";
    node.store.support_email = "help@acme.test";

    const link = mount(node).querySelector("a");
    expect(link?.getAttribute("href")).toBe("https://acme.test");
    expect(link?.textContent).toBe("Contact Acme");
  });

  it("falls back to the support address", () => {
    const node = invoice();
    node.store.support_email = "help@acme.test";

    expect(mount(node).querySelector("a")?.getAttribute("href")).toBe(
      "mailto:help@acme.test"
    );
  });

  it("offers no contact link when the invoice carries nowhere to go", () => {
    expect(mount(invoice()).querySelector("a")).toBeNull();
  });
});

describe("the FAQ inside the card", () => {
  async function card(
    node: Checkout,
    overrides?: CheckoutStringsOverride
  ): Promise<HTMLDivElement> {
    host = document.createElement("div");
    document.body.appendChild(host);

    const controller = new CheckoutController(
      "inv_1",
      fakeApi({show: async () => node, wallets: async () => []}),
      {pollMs: 999_999}
    );

    // Through `act`, or the subscribe effect never runs and no state ever arrives.
    act(() => {
      render(
        <I18nProvider value={resolveStrings(undefined, overrides)}>
          <CheckoutView controller={controller} layout="narrow" />
        </I18nProvider>,
        host!
      );
    });

    // Past the skeleton: the first fetch has to land before the card exists.
    await act(async () => {
      await controller.refetch();
    });

    // Guard, not decoration: a fixture the card throws on renders an empty host, and
    // every "no trigger" assertion below would pass on it.
    if (!host.textContent?.includes("Acme")) {
      throw new Error(`the invoice card never rendered: ${host.innerHTML}`);
    }

    return host;
  }

  const trigger = (root: HTMLElement) =>
    root.querySelector<HTMLButtonElement>(`[aria-label="${en.faqOpen}"]`)!;

  it("puts the trigger in the header and swaps the card over to it", async () => {
    const root = await card(invoice());
    expect(trigger(root).ariaExpanded).toBe("false");
    expect(root.textContent).toContain(en.amountDue);

    click(trigger(root));

    expect(trigger(root).ariaExpanded).toBe("true");
    expect(root.textContent).toContain(en.faqTitle);
    // Hidden, not unmounted — a running rate lock survives the detour.
    expect(root.querySelector(".hidden")?.textContent).toContain(en.amountDue);
  });

  it("hands focus back to the trigger on the way out", async () => {
    const root = await card(invoice());

    click(trigger(root));
    click(
      root.querySelector<HTMLButtonElement>(`[aria-label="${en.faqBack}"]`)!
    );

    expect(root.textContent).not.toContain(en.faqTitle);
    expect(document.activeElement).toBe(trigger(root));
  });

  it("is offered on a terminal invoice, where the questions still get asked", async () => {
    const root = await card(invoice({status: "expired"}));

    expect(trigger(root)).toBeTruthy();
    click(trigger(root));

    expect(root.textContent).toContain(en.faqTitle);
    expect(questions(root).length).toBeGreaterThan(0);
    // The live answers are gone with the invoice: "no, this page quotes a fresh
    // amount" is a promise an expired invoice cannot keep.
    expect(root.textContent).not.toContain(en.faq[0].q(faqContext(invoice())));
  });

  // The header is the FAQ's SIBLING, so a key pressed on the trigger or the close
  // button never passes through the FAQ's own subtree. Handled at the card for that
  // reason; both origins are swept here, and one alone would miss the regression.
  for (const from of ["the header trigger", "a question"] as const) {
    it(`closes on Escape from ${from}, without the modal seeing the key`, async () => {
      let escaped = 0;
      const root = await card(invoice());
      root.addEventListener("keydown", () => escaped++);

      click(trigger(root));
      const origin =
        from === "the header trigger" ? trigger(root) : questions(root)[0];

      act(() => {
        origin.dispatchEvent(
          new KeyboardEvent("keydown", {key: "Escape", bubbles: true})
        );
      });

      expect(root.textContent).not.toContain(en.faqTitle);
      // Reaching the host means reaching the dialog: Escape would raise the close
      // prompt instead of stepping back to the payment view.
      expect(escaped).toBe(0);
      expect(document.activeElement).toBe(trigger(root));
    });
  }

  it("lets Escape close the checkout when the FAQ is not showing", async () => {
    let escaped = 0;
    const root = await card(invoice());
    root.addEventListener("keydown", () => escaped++);

    act(() => {
      trigger(root).dispatchEvent(
        new KeyboardEvent("keydown", {key: "Escape", bubbles: true})
      );
    });

    expect(escaped).toBe(1);
  });

  it("leaves Tab alone, so the modal keeps its focus trap", async () => {
    let tabs = 0;
    const root = await card(invoice());
    root.addEventListener("keydown", () => tabs++);

    click(trigger(root));
    act(() => {
      questions(root)[0].dispatchEvent(
        new KeyboardEvent("keydown", {key: "Tab", bubbles: true})
      );
    });

    expect(tabs).toBe(1);
  });

  it("shows no trigger at all when a merchant clears the table", async () => {
    const root = await card(invoice(), {faq: []});

    expect(root.querySelector(`[aria-label="${en.faqOpen}"]`)).toBeNull();
  });
});
