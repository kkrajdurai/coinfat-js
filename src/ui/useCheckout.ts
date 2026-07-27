import {useEffect, useState} from "preact/hooks";
import type {CheckoutController, CheckoutState} from "../core/checkout.js";

/** Bind a Preact component to a CheckoutController's state. */
export function useCheckoutState(
  controller: CheckoutController
): CheckoutState {
  const [state, setState] = useState<CheckoutState>(() =>
    controller.getState()
  );

  // subscribe() emits the current state immediately and returns an unsubscribe.
  useEffect(() => controller.subscribe(setState), [controller]);

  return state;
}
