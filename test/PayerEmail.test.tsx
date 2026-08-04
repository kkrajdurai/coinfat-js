/**
 * The notification sign-up: where each kind of failure is allowed to appear, and the
 * three states the payer moves between.
 */

import {render} from "preact";
import {act} from "preact/test-utils";
import {afterEach, describe, expect, it} from "vitest";
import {CheckoutApiError} from "../src/core/api.js";
import {CheckoutController} from "../src/core/checkout.js";
import type {Checkout} from "../src/core/types.js";
import {emailFailure, PayerEmail} from "../src/ui/PayerEmail.js";
import {I18nProvider} from "../src/ui/strings/context.js";
import {en, resolveStrings} from "../src/ui/strings/index.js";
import {fakeApi, invoice, sleep} from "./helpers.js";

let host: HTMLDivElement | null = null;

interface MountOptions {
  payerEmail?: string | null;
  saving?: boolean;
  error?: CheckoutApiError | null;
  controller?: CheckoutController;
}

function mount({
  payerEmail = null,
  saving = false,
  error = null,
  controller = new CheckoutController("inv_1", fakeApi({}), {pollMs: 999_999})
}: MountOptions = {}): HTMLDivElement {
  host = document.createElement("div");
  document.body.appendChild(host);

  act(() => {
    render(
      <I18nProvider value={resolveStrings()}>
        <PayerEmail
          payerEmail={payerEmail}
          saving={saving}
          error={error}
          controller={controller}
        />
      </I18nProvider>,
      host!
    );
  });

  return host;
}

const input = (root: HTMLElement) =>
  root.querySelector<HTMLInputElement>("input");

/** The prompt/Change/submit buttons, whichever the current state renders. */
const button = (root: HTMLElement, text: string) =>
  Array.from(root.querySelectorAll("button")).find((node) =>
    node.textContent?.includes(text)
  );

const click = (element: HTMLElement) =>
  act(() => {
    element.click();
  });

/** Open the form and type into it. */
function typeInto(root: HTMLElement, value: string) {
  click(button(root, en.emailNotify) ?? button(root, en.emailChange)!);

  const field = input(root)!;
  field.value = value;
  act(() => {
    field.dispatchEvent(new Event("input", {bubbles: true}));
  });

  return field;
}

const key = (target: HTMLElement, name: string) =>
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", {key: name, bubbles: true})
    );
  });

afterEach(() => {
  if (host) {
    render(null, host);
    host.remove();
    host = null;
  }
});

describe("emailFailure", () => {
  it("puts a 422's field message against the input", () => {
    const failure = emailFailure(
      new CheckoutApiError(
        "The email field must be a valid email address.",
        422,
        {
          email: ["The email field must be a valid email address."]
        }
      ),
      en
    );

    expect(failure).toMatchObject({
      message: "The email field must be a valid email address.",
      field: true,
      stale: false
    });
  });

  it("treats a 422 with no field errors as the window having closed", () => {
    // "A notification address can only be added while the invoice is awaiting payment."
    const failure = emailFailure(
      new CheckoutApiError("No longer awaiting payment.", 422),
      en
    );

    expect(failure).toMatchObject({stale: true, field: false});
  });

  it("never blames the field for a 429", () => {
    // Two limits share this status, and once the five-change cap is reached EVERY
    // submission is rejected — including one carrying the address already stored. So a
    // 429 says nothing about what the payer typed.
    const failure = emailFailure(
      new CheckoutApiError(
        "This invoice has reached the maximum number of notification address changes.",
        429
      ),
      en
    );

    expect(failure?.field).toBe(false);
    expect(failure?.stale).toBe(false);
    expect(failure?.message).toContain("maximum number");
  });

  it("falls back to our own copy when the server sent nothing worth quoting", () => {
    const failure = emailFailure(new CheckoutApiError("", 0), en);

    expect(failure?.message).toBe(en.networkError);
  });
});

describe("PayerEmail", () => {
  it("offers the prompt, and nothing else, before an address is stored", () => {
    const el = mount();

    expect(el.textContent).toContain(en.emailNotify);
    expect(input(el)).toBeNull();
  });

  it("opens the field, and puts the caret in it", () => {
    const el = mount();
    click(button(el, en.emailNotify)!);

    const field = input(el)!;
    expect(field).not.toBeNull();
    // The payer asked for the field; a second tap to reach it is a wasted one.
    expect(document.activeElement).toBe(field);
  });

  it("submits what was typed and collapses on success", async () => {
    let sent: string | null = null;
    const controller = new CheckoutController(
      "inv_1",
      fakeApi({
        show: async () => invoice(),
        setPayerEmail: async (_u: string, email: string): Promise<Checkout> => {
          sent = email;
          return invoice({payer_email: "j***@example.com"});
        }
      }),
      {pollMs: 999_999}
    );

    controller.start();
    await sleep(5);

    const el = mount({controller});
    typeInto(el, "jane@example.com");
    click(button(el, en.emailSubmit)!);
    await act(async () => {
      await sleep(5);
    });

    expect(sent).toBe("jane@example.com");
    expect(input(el)).toBeNull();
  });

  it("keeps the field open on failure, so the message has something to sit under", async () => {
    const controller = new CheckoutController(
      "inv_1",
      fakeApi({
        show: async () => invoice(),
        setPayerEmail: async () => {
          throw new CheckoutApiError("Must be a valid email address.", 422, {
            email: ["Must be a valid email address."]
          });
        }
      }),
      {pollMs: 999_999}
    );

    controller.start();
    await sleep(5);

    const el = mount({controller});
    typeInto(el, "nope");
    click(button(el, en.emailSubmit)!);
    await act(async () => {
      await sleep(5);
    });

    expect(input(el)).not.toBeNull();
    expect(input(el)!.value).toBe("nope");
  });

  it("marks the input invalid for a field error, but not for a 429", () => {
    const invalid = mount({
      error: new CheckoutApiError("Must be valid.", 422, {
        email: ["Must be valid."]
      })
    });
    typeInto(invalid, "nope");
    expect(input(invalid)!.getAttribute("aria-invalid")).toBe("true");

    render(null, host!);
    host!.remove();

    const limited = mount({
      error: new CheckoutApiError("Too many changes.", 429)
    });
    typeInto(limited, "jane@example.com");
    expect(limited.textContent).toContain("Too many changes.");
    // The address may well be fine — the invoice simply will not take another change.
    expect(input(limited)!.getAttribute("aria-invalid")).toBeNull();
  });

  it("keeps a 422 naming some other field recoverable", () => {
    // Only a 422 with NO errors at all means the invoice has stopped accepting
    // addresses. Taking the control away over a validation failure would strand a payer
    // on an invoice that is still live.
    const el = mount({
      error: new CheckoutApiError("Validation failed.", 422, {
        something_else: ["Nope."]
      })
    });

    expect(button(el, en.emailNotify)).toBeDefined();
  });

  it("describes the input with a 429 without marking it invalid", () => {
    const el = mount({error: new CheckoutApiError("Too many changes.", 429)});
    typeInto(el, "jane@example.com");

    const field = input(el)!;
    const described = el.querySelector(
      `#${field.getAttribute("aria-describedby")}`
    );

    // Unwired, the message is on screen but unreachable to a screen reader.
    expect(described?.textContent).toBe("Too many changes.");
    expect(field.getAttribute("aria-invalid")).toBeNull();
  });

  it("announces a failure, not just the confirmation", () => {
    const el = mount();
    typeInto(el, "nope");
    const region = el.querySelector('[role="status"]')!;
    expect(region.textContent).toBe("");

    act(() => {
      render(
        <I18nProvider value={resolveStrings()}>
          <PayerEmail
            payerEmail={null}
            saving={false}
            error={
              new CheckoutApiError("Must be valid.", 422, {
                email: ["Must be valid."]
              })
            }
            controller={
              new CheckoutController("inv_1", fakeApi({}), {pollMs: 999_999})
            }
          />
        </I18nProvider>,
        el
      );
    });

    // The visible <p> is inserted dynamically, so it is never announced on its own.
    expect(el.querySelector('[role="status"]')).toBe(region);
    expect(region.textContent).toBe("Must be valid.");
  });

  it("hands focus back to the trigger when the form collapses", async () => {
    const controller = new CheckoutController(
      "inv_1",
      fakeApi({
        show: async () => invoice(),
        setPayerEmail: async (): Promise<Checkout> =>
          invoice({payer_email: "j***@example.com"})
      }),
      {pollMs: 999_999}
    );

    controller.start();
    await sleep(5);

    const el = mount({controller});
    const field = typeInto(el, "jane@example.com");

    // Escape unmounts the input, which is holding focus. Dropped on <body>, focus is
    // outside the modal's dialog — and its Escape and Tab handlers are bound there, so
    // the whole checkout goes keyboard-dead.
    key(field, "Escape");
    expect(document.activeElement).toBe(button(el, en.emailNotify));

    // And the same on the success path, where it is the submit button that vanishes.
    // `payerEmail` is a fixed prop here, so the trigger it collapses back to is still
    // the prompt rather than Change — what matters is that it is not <body>.
    typeInto(el, "jane@example.com");
    click(button(el, en.emailSubmit)!);
    await act(async () => {
      await sleep(5);
    });

    expect(document.activeElement).toBe(button(el, en.emailNotify));
  });

  it("takes the whole offer away once the invoice stops accepting addresses", () => {
    const el = mount({
      error: new CheckoutApiError(
        "A notification address can only be added while the invoice is awaiting payment.",
        422
      )
    });

    expect(el.textContent).toContain("awaiting payment");
    expect(button(el, en.emailNotify)).toBeUndefined();
    expect(input(el)).toBeNull();
  });

  it("shows the masked address back, so a typo is catchable", () => {
    const el = mount({payerEmail: "j***@example.com"});

    expect(el.textContent).toContain("j***@example.com");
    expect(button(el, en.emailChange)).toBeDefined();
    expect(input(el)).toBeNull();
  });

  it("announces the stored address through a region that was already mounted", () => {
    // The point is that the region PRE-EXISTS the news: one inserted with its text
    // already in place is not announced, and the form collapses out from under the payer
    // on success. So it has to be there — and empty — beforehand.
    const el = mount();
    const before = el.querySelector('[role="status"]');
    expect(before).not.toBeNull();
    expect(before!.textContent).toBe("");

    act(() => {
      render(
        <I18nProvider value={resolveStrings()}>
          <PayerEmail
            payerEmail="j***@example.com"
            saving={false}
            error={null}
            controller={
              new CheckoutController("inv_1", fakeApi({}), {pollMs: 999_999})
            }
          />
        </I18nProvider>,
        el
      );
    });

    // The same node, now carrying the news — not a fresh one carrying it from birth.
    expect(el.querySelector('[role="status"]')).toBe(before);
    expect(before!.textContent).toContain("j***@example.com");
  });

  it("reopens the field from the stored state", () => {
    const el = mount({payerEmail: "j***@example.com"});
    click(button(el, en.emailChange)!);

    // Empty, never seeded with the mask: a PUT of the mask string would store it
    // verbatim as the new address.
    expect(input(el)!.value).toBe("");
  });

  it("submits on Enter", async () => {
    let calls = 0;
    const controller = new CheckoutController(
      "inv_1",
      fakeApi({
        show: async () => invoice(),
        setPayerEmail: async (): Promise<Checkout> => {
          calls++;
          return invoice({payer_email: "j***@example.com"});
        }
      }),
      {pollMs: 999_999}
    );

    controller.start();
    await sleep(5);

    const el = mount({controller});
    const field = typeInto(el, "jane@example.com");
    key(field, "Enter");
    await act(async () => {
      await sleep(5);
    });

    expect(calls).toBe(1);
  });

  it("collapses on Escape without letting it reach the modal", () => {
    const el = mount();
    const field = typeInto(el, "jane@");

    let escaped = false;
    host!.addEventListener("keydown", () => {
      escaped = true;
    });

    key(field, "Escape");

    expect(input(el)).toBeNull();
    // Unstopped, this key would raise the modal's "Close checkout?" prompt instead —
    // a surprising answer to "never mind".
    expect(escaped).toBe(false);
  });

  it("will not submit an empty field", () => {
    const el = mount();
    click(button(el, en.emailNotify)!);

    expect(button(el, en.emailSubmit)).toHaveProperty("disabled", true);
  });
});
