/**
 * Local dev harness (`npm run dev`). Not part of the published bundle.
 *
 * Append `?invoice=<ulid>` and run the backend locally. Without either it renders
 * the skeleton and then a not-found state, which still exercises the shadow-DOM +
 * Tailwind pipeline.
 */
import {Coinfat} from "./index.js";

const coinfat = Coinfat({
  apiBase: "http://localhost:8000/api/v1"
});

const invoice =
  new URLSearchParams(location.search).get("invoice") ??
  "REPLACE_WITH_INVOICE_ULID";

coinfat.checkout({
  invoice,
  display: "inline",
  mount: "#inline",
  layout: "wide",
  onReady: (inv) => console.log("ready", inv.status),
  onCompleted: () => console.log("completed")
});

coinfat.button({invoice, mount: "#button"});
