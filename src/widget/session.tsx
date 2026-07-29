import type {CheckoutApiClient} from "../core/api.js";
import {BRAND} from "../core/brand.js";
import {CheckoutController} from "../core/checkout.js";
import type {
  CheckoutCallbacks,
  CheckoutTheme,
  WidgetDisplay,
  WidgetLayout
} from "../core/options.js";
import {Checkout} from "../ui/Checkout.js";
import {closeConfirmReason} from "../ui/closeGuard.js";
import {Modal} from "../ui/Modal.js";
import {
  resolveStrings,
  type CheckoutStringsOverride
} from "../ui/strings/index.js";
import {I18nProvider} from "../ui/strings/context.js";
import {
  applyAccent,
  createShadowHost,
  renderApp,
  resolveElement,
  type ShadowMount
} from "./mount.js";

export interface CheckoutParams extends CheckoutCallbacks {
  /** The invoice ulid, created server-side with your secret API key. */
  invoice: string;
  display: WidgetDisplay;
  /** Target element or selector — required for `display: 'inline'`. */
  mount?: string | HTMLElement;
  /** 'wide' (two-column, collapses on narrow) or 'narrow'. Inline defaults 'wide', modal 'narrow'. */
  layout?: WidgetLayout;
  theme?: CheckoutTheme;
  /**
   * BCP-47 locale for copy and number formatting. Only `en` ships today; an unknown
   * tag falls back to English strings while `Intl` still formats amounts for the tag.
   */
  locale?: string;
  /** Override any payer-facing string, merged over the resolved locale. */
  strings?: CheckoutStringsOverride;
  /** Redirect to the invoice's success_url on completion. Defaults to false. */
  redirectOnComplete?: boolean;
}

/** Just under the 32-bit signed max, above any merchant stacking context. */
const OVERLAY_Z_INDEX = "2147483000";

export class CheckoutSession {
  private readonly controller: CheckoutController;
  private mount: ShadowMount | null = null;
  private opened = false;

  constructor(
    api: CheckoutApiClient,
    private readonly params: CheckoutParams
  ) {
    this.controller = new CheckoutController(params.invoice, api, {
      callbacks: this.composeCallbacks()
    });

    if (params.display === "inline") {
      this.mountInline();
    }
  }

  /** No-op for inline. */
  open(): void {
    if (this.params.display !== "modal" || this.opened) {
      return;
    }

    this.mountModal();
  }

  close(): void {
    if (this.opened) {
      this.destroy();
    }
  }

  /** Stop polling and remove the widget from the DOM. */
  destroy(): void {
    this.controller.stop();
    this.mount?.unmount();
    this.mount = null;
    this.opened = false;
  }

  private mountInline(): void {
    const target = resolveElement(this.params.mount);

    if (!target) {
      throw new Error(
        `${BRAND.slug}: \`mount\` (element or selector) is required for an inline checkout`
      );
    }

    this.mount = createShadowHost(this.params.theme);
    target.appendChild(this.mount.host);
    this.renderInto(this.params.layout ?? "wide", false);
    this.controller.start();
  }

  /**
   * The store's brand_color, unless an explicit `theme.accent` wins. Also called when
   * building a host, not just from `onReady`: that fires once per invoice, but
   * `close()` destroys the host, so a reopened modal has to seed from state.
   */
  private applyStoreAccent(brandColor?: string | null): void {
    const color =
      brandColor ?? this.controller.getState().invoice?.store.brand_color;

    if (this.mount && !this.params.theme?.accent && color) {
      applyAccent(this.mount.host, color);
    }
  }

  private mountModal(): void {
    this.mount = createShadowHost(this.params.theme);
    this.applyStoreAccent();
    // The host is the full-viewport layer; Modal paints the backdrop inside it.
    this.mount.host.style.position = "fixed";
    this.mount.host.style.inset = "0";
    this.mount.host.style.zIndex = OVERLAY_Z_INDEX;
    document.body.appendChild(this.mount.host);
    this.opened = true;
    this.renderInto(this.params.layout ?? "narrow", true);
    this.controller.start();
  }

  private renderInto(layout: WidgetLayout, modal: boolean): void {
    if (!this.mount) {
      return;
    }

    const checkout = (
      <Checkout
        controller={this.controller}
        layout={layout}
        onRequestClose={modal ? () => this.close() : undefined}
      />
    );

    const i18n = resolveStrings(this.params.locale, this.params.strings);
    const app = modal ? (
      <Modal
        layout={layout}
        onClose={() => this.close()}
        closeGuard={{
          reason: () => closeConfirmReason(this.controller.getState()),
          subscribe: (listener) => this.controller.subscribe(listener)
        }}>
        {checkout}
      </Modal>
    ) : (
      checkout
    );

    renderApp(this.mount, <I18nProvider value={i18n}>{app}</I18nProvider>);
  }

  /** Merchant callbacks, with the opt-in success_url redirect folded into onCompleted. */
  private composeCallbacks(): CheckoutCallbacks {
    const {
      onReady,
      onCoinSelected,
      onPaymentDetected,
      onCompleted,
      onExpired,
      onCanceled,
      onError
    } = this.params;

    return {
      onReady: (invoice) => {
        this.applyStoreAccent(invoice.store.brand_color);
        onReady?.(invoice);
      },
      onCoinSelected,
      onPaymentDetected,
      onExpired,
      onCanceled,
      onError,
      // The merchant's handler runs first: the redirect navigates away, so anything it
      // wants to do must already have happened. In a `finally`, because the controller
      // catches a throwing callback one frame too late to help here — the throw would
      // already have skipped the redirect the merchant asked for, turning their own bug
      // into a payer stranded on a paid invoice.
      onCompleted: (invoice) => {
        try {
          onCompleted?.(invoice);
        } finally {
          if (this.params.redirectOnComplete && invoice.success_url) {
            window.location.assign(invoice.success_url);
          }
        }
      }
    };
  }
}
