import type {CheckoutApiClient} from "../core/api.js";
import {BRAND} from "../core/brand.js";
import type {CheckoutTheme} from "../core/options.js";
import {resolveStrings} from "../ui/strings/index.js";
import {
  applyAccent,
  createShadowHost,
  renderApp,
  resolveElement,
  type ShadowMount
} from "./mount.js";
import {CheckoutSession, type CheckoutParams} from "./session.js";

export interface ButtonParams {
  /** The invoice ulid, created server-side with your secret API key. */
  invoice: string;
  /** Target element or selector to render the button into. */
  mount: string | HTMLElement;
  /** Button text. Defaults to "Pay with crypto". */
  label?: string;
  theme?: CheckoutTheme;
  /** Options for the modal checkout the button opens (callbacks, layout, etc.). */
  checkout?: Omit<CheckoutParams, "invoice" | "display" | "mount">;
}

/** A drop-in "Pay with crypto" button that opens the checkout in a modal. */
export class CheckoutButton {
  private mount: ShadowMount | null = null;
  private session: CheckoutSession | null = null;
  private brandAbort: AbortController | null = null;

  constructor(
    private readonly api: CheckoutApiClient,
    private readonly params: ButtonParams
  ) {
    this.render();
  }

  destroy(): void {
    this.brandAbort?.abort();
    this.session?.destroy();
    this.session = null;
    this.mount?.unmount();
    this.mount = null;
  }

  private render(): void {
    const target = resolveElement(this.params.mount);

    if (!target) {
      throw new Error(
        `${BRAND.slug}: \`mount\` (element or selector) is required for the button`
      );
    }

    this.mount = createShadowHost(this.params.theme);
    target.appendChild(this.mount.host);

    // The modal it opens carries its own provider; the button's lone label only
    // needs the resolved default, and the `??` skips the table lookup entirely when
    // the merchant gave a label — honouring the checkout's locale/strings otherwise.
    const label =
      this.params.label ??
      resolveStrings(
        this.params.checkout?.locale,
        this.params.checkout?.strings
      ).strings.payWithCrypto;

    renderApp(
      this.mount,
      <button
        type="button"
        class="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => this.openCheckout()}>
        {label}
      </button>
    );

    // The button paints before the modal fetches anything, so on its own it can't
    // know the store's brand_color and would sit in the default orange while opening
    // a brand-coloured checkout. Mirror `openCheckout`'s precedence exactly: whatever
    // accent the modal will use, the button wears — and only when the merchant fixed
    // none do we look the store's colour up. Best-effort: a failure keeps the default.
    const fixedAccent = (this.params.checkout?.theme ?? this.params.theme)
      ?.accent;

    if (fixedAccent) {
      applyAccent(this.mount.host, fixedAccent);
    } else {
      this.matchStoreBrand();
    }
  }

  private matchStoreBrand(): void {
    const controller = new AbortController();
    this.brandAbort = controller;

    this.api
      .show(this.params.invoice, controller.signal)
      .then((invoice) => {
        if (this.mount && invoice.store.brand_color) {
          applyAccent(this.mount.host, invoice.store.brand_color);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (this.brandAbort === controller) {
          this.brandAbort = null;
        }
      });
  }

  private openCheckout(): void {
    if (!this.session) {
      this.session = new CheckoutSession(this.api, {
        ...this.params.checkout,
        invoice: this.params.invoice,
        display: "modal",
        theme: this.params.checkout?.theme ?? this.params.theme
      });
    }

    this.session.open();
  }
}
