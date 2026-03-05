const PURCHASE_PENDING_KEY = "cart_purchase_pending"

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
