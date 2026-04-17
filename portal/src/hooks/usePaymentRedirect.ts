const PURCHASE_PENDING_KEY = "cart_purchase_pending"
const PENDING_PAYMENT_REDIRECT_KEY = "pending_payment_redirect"

export type PendingPaymentRedirectState = {
  paymentId: string
  popupSlug: string
}

const isPendingPaymentRedirectState = (
  value: unknown,
): value is PendingPaymentRedirectState => {
  if (typeof value !== "object" || value === null) {
    return false
  }

  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.paymentId === "string" &&
    typeof candidate.popupSlug === "string"
  )
}

export const markPurchasePending = (): void => {
  try {
    sessionStorage.setItem(PURCHASE_PENDING_KEY, "true")
  } catch {
    /* noop */
  }
}

export const checkAndClearPurchasePending = (): boolean => {
  try {
    const pending = sessionStorage.getItem(PURCHASE_PENDING_KEY) === "true"
    if (pending) sessionStorage.removeItem(PURCHASE_PENDING_KEY)
    return pending
  } catch {
    return false
  }
}

export const savePendingPaymentRedirectState = (
  state: PendingPaymentRedirectState,
): void => {
  try {
    sessionStorage.setItem(PENDING_PAYMENT_REDIRECT_KEY, JSON.stringify(state))
  } catch {
    /* noop */
  }
}

export const readAndClearPendingPaymentRedirectState =
  (): PendingPaymentRedirectState | null => {
    try {
      const rawState = sessionStorage.getItem(PENDING_PAYMENT_REDIRECT_KEY)
      if (!rawState) {
        return null
      }

      sessionStorage.removeItem(PENDING_PAYMENT_REDIRECT_KEY)

      const parsedState: unknown = JSON.parse(rawState)
      return isPendingPaymentRedirectState(parsedState) ? parsedState : null
    } catch {
      try {
        sessionStorage.removeItem(PENDING_PAYMENT_REDIRECT_KEY)
      } catch {
        /* noop */
      }

      return null
    }
  }
