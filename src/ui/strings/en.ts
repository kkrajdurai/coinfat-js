import type {CheckoutStrings} from "./types.js";

/** The default table. Every other locale falls back to it per-key. */
export const en: CheckoutStrings = {
  amountDue: "Amount due",
  status: {
    pending: "Awaiting payment",
    completed: "Paid",
    expired: "Expired",
    canceled: "Canceled"
  },
  close: "Close",
  dialogLabel: "Checkout",
  poweredBy: "Powered by",

  confirmCloseTitle: "Close checkout?",
  confirmCloseDetected:
    "Your payment is still being confirmed. Closing won't stop it.",
  confirmCloseAwaiting: "You haven't sent your payment yet.",
  confirmCloseStay: "Keep checkout open",
  confirmCloseLeave: "Close anyway",

  completedMessage: "Your payment was received. Thank you!",
  expiredMessage: "This payment link has expired.",
  canceledMessage: "This invoice was canceled.",
  continueToStore: "Continue",
  returnToStore: "Return to store",

  sendExactly: "Send exactly",
  qrAlt: (symbol) => `QR code for the ${symbol} deposit address`,
  qrZoomIn: (symbol) => `Enlarge the ${symbol} QR code`,
  qrZoomOut: (symbol) => `Shrink the ${symbol} QR code`,
  openInWallet: "Open in wallet",
  sendOnly: (symbol, network) =>
    `Send only ${symbol} on ${network}. Sending other tokens may result in loss of funds.`,
  noDepositAddress:
    "No deposit address is available for this network yet. Try another network, or contact the store.",
  listening: "Listening for your payment…",
  confirming: "Confirming your payment…",
  refreshRate: "Refresh rate",
  amountLocked: "Amount locked",
  copied: "Copied",
  copyAmount: (formatted) => `Copy the amount, ${formatted}`,
  copyAddress: "Copy the deposit address",
  summaryExpected: "Expected",
  summaryReceived: "Received",
  summaryRemaining: "Remaining",
  summaryOverpaid: "Overpaid",

  noticeOverpaid: (extra, symbol) =>
    `Paid in full, with ${extra} ${symbol} extra. The store will reconcile the surplus.`,
  noticeUnderpaid: (remaining, symbol) =>
    `Partial payment received. Send ${remaining} ${symbol} more to complete.`,
  noticeDetected: "Payment detected. Confirming on-chain…",

  networkError:
    "That didn't go through — check your connection. We'll keep trying.",
  loadErrorTitle: "Couldn't load this checkout",
  loadErrorDetail: "Something went wrong reaching the payment service.",
  retry: "Try again",
  notFoundTitle: "Invoice not found",
  notFoundDetail: "This checkout link is invalid or has been removed.",

  chooseCoin: "Choose a coin",
  chooseNetwork: "Choose a network",
  changeCoin: "Change coin",
  cancel: "Cancel",
  proceed: "Continue",
  searchCoins: "Search coins",
  noNetworks: "No networks are available for this coin.",
  optionsError: "Couldn't load the payment options.",

  emailNotify: "Email me when this payment confirms",
  emailLabel: "Email",
  emailPlaceholder: "you@example.com",
  emailSubmit: "Notify me",
  emailNote:
    "We'll send one email about this payment, once it confirms. Nothing else.",
  emailSaved: (masked) => `We'll email ${masked} once this payment confirms.`,
  emailChange: "Change",

  faq: [
    {
      id: "how-to-pay",
      q: () => "How do I pay?",
      a: () =>
        "Pick a coin and a network, then send the exact amount shown to the deposit address from your own wallet or exchange account. This page updates by itself once your transfer is spotted on the network."
    },
    {
      id: "where-to-get-crypto",
      q: () => "Where do I get crypto to pay with?",
      a: () =>
        "From a crypto exchange or a wallet app that lets you buy, then withdraw to the address on this page. Exchanges charge their own withdrawal fee, so check what will actually arrive — the fee comes out of the amount you send, not on top of it."
    },
    {
      id: "wrong-coin",
      q: () => "What if I use the wrong coin or network?",
      a: ({symbol, network}) =>
        `This address accepts ${symbol} on ${network} and nothing else. A different coin, or ${symbol} on a different chain, is sent to an address that cannot receive it and is usually unrecoverable — check both in your wallet before you confirm.`
    },
    {
      id: "wrong-amount",
      q: () => "What if I send the wrong amount?",
      a: ({symbol, store}) =>
        `Send too little and this page shows what is still owed — top it up with a second transfer to the same address. Send too much and the payment completes; ${store} will reconcile the surplus ${symbol}.`
    },
    {
      id: "timer",
      q: () => "The timer ran out. Do I have to start again?",
      a: () =>
        "No, but send promptly. The countdown holds the quoted amount, not your payment: if it lapses before your transfer is spotted, this page quotes a fresh amount at the current rate, and a transfer already on its way can land short of the new one. Once it is spotted the amount stops moving and simply keeps confirming."
    },
    {
      id: "how-long",
      q: () => "How long does it take to confirm?",
      a: ({network, confirmations}) =>
        `${network} needs ${confirmations} ${confirmations === 1 ? "confirmation" : "confirmations"} before this payment counts as complete — often a few minutes, though slower chains and busy ones take longer. You can leave this page open and watch it.`
    },
    {
      id: "paid-next",
      q: () => "I've paid. What happens now?",
      a: ({store}) =>
        `Nothing more to do. This page marks the payment complete once the network confirms it, and ${store} is notified too.`
    },
    {
      id: "expired-next",
      q: () => "This payment link is no longer active. What now?",
      a: ({store}) =>
        `Start again from ${store} — a new checkout quotes a fresh amount and a fresh address. If you already sent a transfer to the address on this page, do not send more; contact ${store} with the amount and the date.`
    },
    {
      id: "not-received",
      q: () => "What if I don't get what I paid for?",
      a: ({store}) =>
        `Your payment goes to ${store}, and the order, the delivery and any refund are theirs to settle. Contact them with the amount you sent and the date you sent it.`
    }
  ],
  faqTitle: "Common questions",
  faqOpen: "Common questions",
  faqBack: "Back to payment",
  faqContact: (store) => `Contact ${store}`,

  payWithCrypto: "Pay with crypto"
};
