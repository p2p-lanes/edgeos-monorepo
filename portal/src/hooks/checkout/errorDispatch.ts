/**
 * Pure error-dispatch helper for the payment-submit flow.
 *
 * Keeping the error-code → action mapping separate from the React hook lets
 * us test every branch without mounting the full checkout context.
 */

export type CartMeta = {
  cartId: string | null
  restoreToken: string | null
}

export type NavigateAction =
  | { type: "href"; url: string }
  | { type: "router-push"; path: string }

export type PaymentErrorDispatch = {
  /** i18n translation key — pass through t() before displaying */
  messageKey: string
  /** When true, set paymentCompleteRef.current = true to block resubmit */
  blockResubmit: boolean
  /** When true, surface via setPromoError (persistent banner) */
  setPersistentError: boolean
  /** Navigation to perform after surfacing the error, or null */
  navigate: NavigateAction | null
}

/**
 * Extracts cid/sig from the open-cart meta ref for inclusion in the purchase
 * request body. Both values are undefined (omitted) when not present.
 */
export function extractCartMeta(
  ref: { current: CartMeta } | null | undefined,
): { cid: string | undefined; sig: string | undefined } {
  return {
    cid: ref?.current.cartId ?? undefined,
    sig: ref?.current.restoreToken ?? undefined,
  }
}

/**
 * Maps a structured API error detail to the set of actions the hook must
 * perform. Returns null when the code is unrecognised (caller falls through
 * to generic error handling).
 */
export function dispatchPaymentError(
  detail: { code?: string; redirect_url?: string },
  submitMode: "application" | "open-ticketing",
  popupSlug: string | null,
): PaymentErrorDispatch | null {
  const prefix = submitMode === "open-ticketing" ? "openCheckout" : "checkout"

  if (detail.code === "previous_payment_completed") {
    // Buyer already has a completed purchase.  Navigate when possible so they
    // can see it.  When no redirect_url is available (open-ticketing without a
    // configured external success URL) or when the slug is absent (edge case),
    // fall back to a persistent banner so the buyer is not silently stranded.
    const navigate: NavigateAction | null =
      submitMode === "open-ticketing" && detail.redirect_url
        ? { type: "href", url: detail.redirect_url }
        : submitMode === "application" && popupSlug
          ? { type: "router-push", path: `/portal/${popupSlug}/passes` }
          : null

    return {
      messageKey: `${prefix}.previous_payment_completed`,
      blockResubmit: true,
      setPersistentError: true,
      navigate,
    }
  }

  if (
    detail.code === "payment_cancel_failed" ||
    detail.code === "concurrent_payment_in_progress"
  ) {
    // Transient / retryable: the prior payment cancel failed or a sibling
    // checkout raced this one.  Do NOT block resubmission.
    return {
      messageKey: `${prefix}.payment_cancel_failed`,
      blockResubmit: false,
      setPersistentError: true,
      navigate: null,
    }
  }

  if (detail.code === "pending_payment_exists") {
    // Open-checkout only: no valid cart continuity proof was supplied.
    // The sweeper will eventually expire the old payment; ask the buyer
    // to wait rather than blocking resubmission outright.
    return {
      messageKey: `${prefix}.pending_payment_wait`,
      blockResubmit: false,
      setPersistentError: true,
      navigate: null,
    }
  }

  return null
}
