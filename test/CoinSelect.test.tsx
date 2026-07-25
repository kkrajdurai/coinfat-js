/**
 * The coin/network picker. Covers the two-step flow, the sole-option auto-selects,
 * the switch pre-selection, and the wallets-fetch retry. The engine's select() plumbing
 * is covered in the engine specs; here we only assert the id the picker hands it.
 *
 * `act` flushes Preact's batched state updates and effects, so every interaction below
 * is settled synchronously by the time we assert.
 */

import {render} from "preact";
import {act} from "preact/test-utils";
import {afterEach, describe, expect, it} from "vitest";
import {CheckoutApiError} from "../src/core/api.js";
import {CheckoutController} from "../src/core/checkout.js";
import type {Wallet, WalletNetwork} from "../src/core/types.js";
import {CoinSelect} from "../src/ui/CoinSelect.js";
import {fakeApi, invoice} from "./helpers.js";

function net(id: string, name: string): WalletNetwork {
  // `wallet`/`execution_fee_wallet` left unset: the wallets endpoint may not load the
  // nested coin, and the row must render (name only) rather than throw on the icon.
  return {
    id,
    name,
    is_active: true,
    confirmation: 2,
    supports_consolidation: false,
    supports_execution_fee: false,
    execution_fee_wallet: null,
    created_at: "",
    updated_at: ""
  } as unknown as WalletNetwork;
}

function coin(
  id: string,
  symbol: string,
  name: string,
  networks: WalletNetwork[]
): Wallet {
  return {
    id,
    name,
    symbol,
    scale: 8,
    precision: 8,
    currency_scale: null,
    svg_icon: `https://cdn.test/${id}.svg`,
    unit_price: {amount: "1", currency: "USD", scale: 2},
    networks,
    created_at: "",
    updated_at: ""
  } as Wallet;
}

const BTC = coin("btc", "BTC", "Bitcoin", [
  net("btc-main", "Bitcoin"),
  net("btc-ln", "Lightning")
]);
const ETH = coin("eth", "ETH", "Ethereum", [net("eth-main", "Ethereum")]);

let host: HTMLDivElement | null = null;

interface MountOptions {
  selectedNetworkId?: string;
  onCancel?: () => void;
  wallets?: Wallet[] | null;
  walletsError?: CheckoutApiError | null;
}

function mount(opts: MountOptions = {}) {
  host = document.createElement("div");
  document.body.appendChild(host);

  let selected: string | null = null;
  let walletsCalls = 0;

  const controller = new CheckoutController(
    "inv_1",
    fakeApi({
      select: async (_ulid, networkId) => {
        selected = networkId;
        return invoice();
      },
      wallets: async () => {
        walletsCalls++;
        return [];
      }
    }),
    {pollMs: 999_999}
  );

  act(() => {
    render(
      <CoinSelect
        controller={controller}
        wallets={opts.wallets === undefined ? [BTC, ETH] : opts.wallets}
        walletsError={opts.walletsError ?? null}
        mutating={false}
        selectedNetworkId={opts.selectedNetworkId}
        onCancel={opts.onCancel}
      />,
      host!
    );
  });

  return {
    el: host,
    selected: () => selected,
    walletsCalls: () => walletsCalls
  };
}

function button(text: string): HTMLButtonElement {
  const match = Array.from(host!.querySelectorAll("button")).find((el) =>
    el.textContent?.trim().includes(text)
  );
  if (!match) {
    throw new Error(`no button containing "${text}"`);
  }
  return match;
}

const click = (text: string) => act(() => button(text).click());

afterEach(() => {
  if (host) {
    render(null, host);
    host.remove();
    host = null;
  }
});

describe("CoinSelect", () => {
  it("lists the payable coins and defers networks until a coin is chosen", () => {
    const {el} = mount();

    expect(el.textContent).toContain("BTC");
    expect(el.textContent).toContain("ETH");
    // Two coins, nothing pre-selected: no coin is open, so no network section yet.
    expect(el.textContent).not.toContain("Choose a network");
  });

  it("reveals a coin's networks and posts the chosen network id", () => {
    const flow = mount();

    click("BTC");
    expect(flow.el.textContent).toContain("Lightning");

    click("Lightning");
    click("Continue");

    // The id posted is the WalletNetwork id, not the coin's.
    expect(flow.selected()).toBe("btc-ln");
  });

  it("auto-selects a sole coin and its sole network", () => {
    const flow = mount({wallets: [ETH]});

    // Nothing tapped: the one coin and its one network resolve on their own, so
    // Continue is already live.
    expect(button("Continue").disabled).toBe(false);

    click("Continue");
    expect(flow.selected()).toBe("eth-main");
  });

  it("pre-selects the current network when switching and only enables Continue on a real change", () => {
    const flow = mount({selectedNetworkId: "btc-ln"});

    // Opened straight onto BTC's networks with Lightning already chosen.
    expect(flow.el.textContent).toContain("Choose a network");
    expect(button("Lightning").getAttribute("aria-checked")).toBe("true");

    // Re-confirming the same network is a no-op that would never close the switcher,
    // so Continue stays disabled until a different network is picked.
    expect(button("Continue").disabled).toBe(true);

    click("Bitcoin"); // the other network of the same coin
    expect(button("Continue").disabled).toBe(false);

    click("Continue");
    expect(flow.selected()).toBe("btc-main");
  });

  it("dismisses via Cancel only when switching", () => {
    let cancelled = false;
    mount({onCancel: () => (cancelled = true)});

    click("Cancel");
    expect(cancelled).toBe(true);
  });

  it("retries the wallets fetch after a failure", () => {
    const flow = mount({
      wallets: null,
      walletsError: new CheckoutApiError("boom", 500)
    });

    expect(flow.el.textContent).toContain("Couldn't load the payment options");

    click("Try again");
    expect(flow.walletsCalls()).toBe(1);
  });
});
