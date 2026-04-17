import {
  checkAndClearPurchasePending,
  markPurchasePending,
  readAndClearPendingPaymentRedirectState,
  savePendingPaymentRedirectState,
} from "./usePaymentRedirect"

describe("usePaymentRedirect helpers", () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  it("saves redirect state and clears it after the first read", () => {
    savePendingPaymentRedirectState({
      paymentId: "payment-123",
      popupSlug: "popup-a",
    })

    expect(readAndClearPendingPaymentRedirectState()).toEqual({
      paymentId: "payment-123",
      popupSlug: "popup-a",
    })
    expect(readAndClearPendingPaymentRedirectState()).toBeNull()
  })

  it("drops invalid redirect state payloads", () => {
    sessionStorage.setItem("pending_payment_redirect", "{invalid-json")

    expect(readAndClearPendingPaymentRedirectState()).toBeNull()
    expect(sessionStorage.getItem("pending_payment_redirect")).toBeNull()
  })

  it("preserves purchase pending one-shot semantics", () => {
    markPurchasePending()

    expect(checkAndClearPurchasePending()).toBe(true)
    expect(checkAndClearPurchasePending()).toBe(false)
  })
})
