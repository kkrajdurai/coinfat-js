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

  payWithCrypto: "Pay with crypto"
};
