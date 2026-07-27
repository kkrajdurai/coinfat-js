/**
 * Coin + network selection: pick a coin, then a network, then confirm — which POSTs
 * the network id to `controller.select`. Two entry points: the no-coin-yet state, and
 * switching coins from the pay panel (with a Cancel).
 *
 * The data is the wallets endpoint's embedded `networks[]` (fetched once), NOT a
 * per-coin request. A sole coin, or a coin's sole network, auto-selects.
 *
 * Post-detection there is no picker at all — the pay panel drops the change-coin
 * affordance once a transfer lands (the backend would 422 `coin_locked` anyway).
 */

import {useEffect, useId, useMemo, useState} from "preact/hooks";
import type {CheckoutApiError} from "../core/api.js";
import type {CheckoutController} from "../core/checkout.js";
import type {
  StoreInvoicePayment,
  Wallet,
  WalletNetwork
} from "../core/types.js";
import {ArrowLeftIcon, Button, CheckIcon, Spinner} from "./primitives.js";
import {useStrings} from "./strings/context.js";

export interface CoinSwitch {
  /** Show the picker rather than the pay panel. */
  picking: boolean;
  /** Offer the change-coin affordance: a real alternative exists, pre-detection. */
  canSwitch: boolean;
  /** The chosen network, to pre-fill the picker when switching. */
  selectedNetworkId: string | undefined;
  /** Open the picker from the pay panel. */
  startSwitch: () => void;
  /** Return to the pay panel, abandoning a switch. */
  cancelSwitch: () => void;
}

/**
 * The state machine routing between the picker and the pay panel. Kept out of the view
 * so the interdependent flags read as one unit.
 */
export function useCoinSwitch(
  payment: StoreInvoicePayment | null,
  wallets: Wallet[] | null
): CoinSwitch {
  const detected = !!payment?.detected_at;
  const [switching, setSwitching] = useState(false);

  // Close the switcher once the selected network actually changes — the switch (or
  // the first pick) landed.
  const selectedNetworkId = payment?.wallet_network?.id;
  useEffect(() => {
    setSwitching(false);
  }, [selectedNetworkId]);

  // Only offer the switch when another option exists — a second coin, or a second
  // network on the only coin.
  const coins = wallets ?? [];
  const soleCoinNetworks = coins[0]?.networks ?? [];
  const hasAlternatives = coins.length > 1 || soleCoinNetworks.length > 1;

  return {
    // No coin yet → pick one. Switching → the same picker with a Cancel. Detection
    // forces the pay panel back regardless of `switching`, which is what makes a
    // stale coin-change race resolve to the confirming view.
    picking: !payment || (switching && !detected),
    canSwitch: !detected && hasAlternatives,
    selectedNetworkId,
    startSwitch: () => setSwitching(true),
    cancelSwitch: () => setSwitching(false)
  };
}

export interface CoinSelectProps {
  controller: CheckoutController;
  wallets: Wallet[] | null;
  walletsError: CheckoutApiError | null;
  /** A select is in flight. */
  mutating: boolean;
  /** The network already chosen, to pre-select when switching coins. */
  selectedNetworkId?: string;
  /** Present only when switching from an existing payment — dismisses the picker. */
  onCancel?: () => void;
}

/** Search only earns its keep past this many coins; below it the grid is scannable. */
const SEARCH_THRESHOLD = 6;

const SECTION_LABEL =
  "text-xs font-medium tracking-[0.12em] text-muted-foreground uppercase";

const OPTION_BASE =
  "flex items-center gap-2 rounded-xl border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset";

function optionClass(selected: boolean): string {
  return `${OPTION_BASE} ${
    selected
      ? "border-primary bg-primary/10"
      : "border-border hover:bg-muted/50"
  }`;
}

/**
 * Both pickers are single-select, so each group is a `radiogroup` of `radio`s — not
 * toggle buttons, whose `aria-pressed` would misreport them as independent. They stay
 * individually tab-focusable rather than adopting APG's roving tabindex: for a compact
 * list that is enough to announce "checked, N of M".
 */

/** A third-party icon 404 must not leave a broken-image glyph in the picker. */
function hideBrokenImage(event: Event): void {
  (event.currentTarget as HTMLImageElement).style.display = "none";
}

export function CoinSelect({
  controller,
  wallets,
  walletsError,
  mutating,
  selectedNetworkId,
  onCancel
}: CoinSelectProps) {
  const strings = useStrings();

  if (!wallets) {
    return walletsError ? (
      <div class="mt-4 space-y-3 text-center">
        <p class="text-sm text-muted-foreground">{strings.optionsError}</p>
        <Button variant="outline" onClick={() => void controller.loadWallets()}>
          {strings.retry}
        </Button>
      </div>
    ) : (
      <div class="mt-4 flex items-center justify-center py-8 text-muted-foreground">
        <Spinner />
      </div>
    );
  }

  return (
    <Picker
      wallets={wallets}
      selectedNetworkId={selectedNetworkId}
      mutating={mutating}
      onConfirm={(networkId) => void controller.select(networkId)}
      onCancel={onCancel}
    />
  );
}

interface PickerProps {
  wallets: Wallet[];
  selectedNetworkId?: string;
  mutating: boolean;
  onConfirm: (networkId: string) => void;
  onCancel?: () => void;
}

function Picker({
  wallets,
  selectedNetworkId,
  mutating,
  onConfirm,
  onCancel
}: PickerProps) {
  const strings = useStrings();

  const [coinId, setCoinId] = useState<string | null>(() =>
    initialCoinId(wallets, selectedNetworkId)
  );
  const [networkId, setNetworkId] = useState<string | null>(
    selectedNetworkId ?? null
  );

  const coin = wallets.find((wallet) => wallet.id === coinId) ?? null;
  const networks = coin?.networks ?? [];

  // Derived, not reset-on-change: the explicit pick if it still belongs to the open
  // coin, else the coin's sole network. No effect, so there is no frame in which a
  // stale network from the previous coin is live and postable.
  const activeNetworkId = networks.some((network) => network.id === networkId)
    ? networkId
    : soleOrNull(networks);

  // Confirm means "commit a change": a no-op re-select of the current network would
  // never fire the `wallet_network.id` change that closes the switcher, so disable it.
  const unchanged = !activeNetworkId || activeNetworkId === selectedNetworkId;

  return (
    <div class="mt-4 space-y-4">
      <CoinPicker wallets={wallets} selectedId={coinId} onSelect={setCoinId} />

      {coin ? (
        <NetworkPicker
          networks={networks}
          selectedId={activeNetworkId}
          onSelect={setNetworkId}
        />
      ) : null}

      <div class="flex gap-2">
        {onCancel ? (
          <Button variant="outline" onClick={onCancel}>
            <ArrowLeftIcon />
            {strings.cancel}
          </Button>
        ) : null}
        <Button
          onClick={() => activeNetworkId && onConfirm(activeNetworkId)}
          disabled={unchanged}
          busy={mutating}>
          {strings.proceed}
        </Button>
      </div>
    </div>
  );
}

function CoinPicker({
  wallets,
  selectedId,
  onSelect
}: {
  wallets: Wallet[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const strings = useStrings();
  const labelId = useId();
  const [query, setQuery] = useState("");
  const searchable = wallets.length > SEARCH_THRESHOLD;

  const shown = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) {
      return wallets;
    }
    return wallets.filter(
      (wallet) =>
        wallet.symbol.toLowerCase().includes(term) ||
        wallet.name.toLowerCase().includes(term)
    );
  }, [wallets, query]);

  return (
    <div class="space-y-2">
      <p id={labelId} class={SECTION_LABEL}>
        {strings.chooseCoin}
      </p>

      {searchable ? (
        <input
          type="search"
          value={query}
          onInput={(event) => setQuery(event.currentTarget.value)}
          placeholder={strings.searchCoins}
          aria-label={strings.searchCoins}
          class="w-full rounded-xl border border-border bg-muted/30 px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring"
        />
      ) : null}

      <div
        role="radiogroup"
        aria-labelledby={labelId}
        // Row height is pinned and the cap is exactly 3.5 rows (3.5 × 4.875rem + 3 ×
        // 0.5rem gap), so a longer list always leaves a clean HALF row peeking as a
        // "more below" cue. An arbitrary cap reads as a clipped grid instead; a whole-
        // row cap removes the cue. A list that fits still renders flush, no scrollbar.
        class="grid max-h-[18.5625rem] auto-rows-[minmax(4.875rem,auto)] grid-cols-2 gap-2 overflow-y-auto @xs:grid-cols-3">
        {shown.map((wallet) => {
          const selected = wallet.id === selectedId;
          return (
            <button
              key={wallet.id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onSelect(wallet.id)}
              class={`${optionClass(selected)} flex-col justify-center px-2 py-3 text-center`}>
              {wallet.svg_icon ? (
                <img
                  src={wallet.svg_icon}
                  alt=""
                  onError={hideBrokenImage}
                  class="size-7 rounded-full"
                />
              ) : null}
              <span
                class={`text-xs font-semibold ${selected ? "text-primary" : ""}`}>
                {wallet.symbol.toUpperCase()}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function NetworkPicker({
  networks,
  selectedId,
  onSelect
}: {
  networks: WalletNetwork[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const strings = useStrings();
  const labelId = useId();

  return (
    <div class="space-y-2">
      <p id={labelId} class={SECTION_LABEL}>
        {strings.chooseNetwork}
      </p>

      {networks.length === 0 ? (
        <p class="rounded-xl bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          {strings.noNetworks}
        </p>
      ) : (
        <div role="radiogroup" aria-labelledby={labelId} class="space-y-2">
          {networks.map((network) => {
            const selected = network.id === selectedId;
            // The network's mark is its chain's native coin, not the token —
            // USDT-on-Tron shows TRX. Guarded: the nested wallet may not be loaded.
            const logo = network.execution_fee_wallet ?? network.wallet;

            return (
              <button
                key={network.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => onSelect(network.id)}
                class={`${optionClass(selected)} w-full p-2.5 text-start`}>
                {logo?.svg_icon ? (
                  <img
                    src={logo.svg_icon}
                    alt=""
                    onError={hideBrokenImage}
                    class="size-6 shrink-0 rounded-full"
                  />
                ) : null}
                <span class="min-w-0 flex-1 truncate text-sm font-medium">
                  {network.name}
                </span>
                {selected ? (
                  <span class="text-primary">
                    <CheckIcon />
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

const soleOrNull = (networks: WalletNetwork[]): string | null =>
  networks.length === 1 ? networks[0].id : null;

/** The coin to open on: the pre-selected network's coin, or the sole coin, else none. */
function initialCoinId(
  wallets: Wallet[],
  selectedNetworkId?: string
): string | null {
  if (selectedNetworkId) {
    const owner = wallets.find((wallet) =>
      (wallet.networks ?? []).some(
        (network) => network.id === selectedNetworkId
      )
    );
    if (owner) {
      return owner.id;
    }
  }

  return wallets.length === 1 ? wallets[0].id : null;
}
