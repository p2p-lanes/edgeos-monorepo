// @vitest-environment node
// Tests for the pure payment error-dispatch helper and extractCartMeta.
// No React, no DOM, no mocks — everything is deterministic pure-function logic.

import { describe, expect, it } from "vitest"
import { dispatchPaymentError, extractCartMeta } from "./errorDispatch"

// ---------------------------------------------------------------------------
// extractCartMeta
// ---------------------------------------------------------------------------

describe("extractCartMeta", () => {
  it("returns cid and sig from a populated ref", () => {
    const ref = { current: { cartId: "cart-abc", restoreToken: "tok-xyz" } }
    expect(extractCartMeta(ref)).toEqual({ cid: "cart-abc", sig: "tok-xyz" })
  })

  it("returns undefined for null values inside ref.current", () => {
    const ref = { current: { cartId: null, restoreToken: null } }
    expect(extractCartMeta(ref)).toEqual({ cid: undefined, sig: undefined })
  })

  it("returns undefined when ref itself is null", () => {
    expect(extractCartMeta(null)).toEqual({ cid: undefined, sig: undefined })
  })

  it("returns undefined when ref is undefined", () => {
    expect(extractCartMeta(undefined)).toEqual({
      cid: undefined,
      sig: undefined,
    })
  })

  it("returns cid only when restoreToken is null", () => {
    const ref = { current: { cartId: "cart-1", restoreToken: null } }
    const result = extractCartMeta(ref)
    expect(result.cid).toBe("cart-1")
    expect(result.sig).toBeUndefined()
  })

  it("returns sig only when cartId is null", () => {
    const ref = { current: { cartId: null, restoreToken: "sig-1" } }
    const result = extractCartMeta(ref)
    expect(result.cid).toBeUndefined()
    expect(result.sig).toBe("sig-1")
  })
})

// ---------------------------------------------------------------------------
// dispatchPaymentError — previous_payment_completed
// ---------------------------------------------------------------------------

describe("dispatchPaymentError — previous_payment_completed", () => {
  it("open-ticketing + redirect_url → navigate href, block resubmit, persistent banner", () => {
    const result = dispatchPaymentError(
      {
        code: "previous_payment_completed",
        redirect_url: "https://example.com/success",
      },
      "open-ticketing",
      "my-popup",
    )
    expect(result).not.toBeNull()
    expect(result!.messageKey).toBe("openCheckout.previous_payment_completed")
    expect(result!.blockResubmit).toBe(true)
    expect(result!.setPersistentError).toBe(true)
    expect(result!.navigate).toEqual({
      type: "href",
      url: "https://example.com/success",
    })
  })

  it("open-ticketing + no redirect_url → no navigation, block resubmit, persistent banner (F1 stranded-buyer fix)", () => {
    const result = dispatchPaymentError(
      { code: "previous_payment_completed" },
      "open-ticketing",
      "my-popup",
    )
    expect(result).not.toBeNull()
    expect(result!.messageKey).toBe("openCheckout.previous_payment_completed")
    expect(result!.blockResubmit).toBe(true)
    expect(result!.setPersistentError).toBe(true)
    expect(result!.navigate).toBeNull()
  })

  it("open-ticketing + empty redirect_url → no navigation (empty string is falsy)", () => {
    const result = dispatchPaymentError(
      { code: "previous_payment_completed", redirect_url: "" },
      "open-ticketing",
      "my-popup",
    )
    expect(result).not.toBeNull()
    expect(result!.navigate).toBeNull()
  })

  it("application + popupSlug → router-push to /passes, block resubmit, persistent banner", () => {
    const result = dispatchPaymentError(
      { code: "previous_payment_completed" },
      "application",
      "edge-popup",
    )
    expect(result).not.toBeNull()
    expect(result!.messageKey).toBe("checkout.previous_payment_completed")
    expect(result!.blockResubmit).toBe(true)
    expect(result!.setPersistentError).toBe(true)
    expect(result!.navigate).toEqual({
      type: "router-push",
      path: "/portal/edge-popup/passes",
    })
  })

  it("application + null slug → no navigation, still blocks resubmit and shows persistent banner", () => {
    const result = dispatchPaymentError(
      { code: "previous_payment_completed" },
      "application",
      null,
    )
    expect(result).not.toBeNull()
    expect(result!.navigate).toBeNull()
    expect(result!.blockResubmit).toBe(true)
    expect(result!.setPersistentError).toBe(true)
  })

  it("application ignores redirect_url (navigation always uses router-push to /passes)", () => {
    const result = dispatchPaymentError(
      {
        code: "previous_payment_completed",
        redirect_url: "https://should-be-ignored.com",
      },
      "application",
      "my-popup",
    )
    expect(result).not.toBeNull()
    expect(result!.navigate).toEqual({
      type: "router-push",
      path: "/portal/my-popup/passes",
    })
  })
})

// ---------------------------------------------------------------------------
// dispatchPaymentError — payment_cancel_failed / concurrent_payment_in_progress
// ---------------------------------------------------------------------------

describe("dispatchPaymentError — payment_cancel_failed / concurrent_payment_in_progress", () => {
  it("payment_cancel_failed (open-ticketing) → retryable: no block, persistent banner, no nav", () => {
    const result = dispatchPaymentError(
      { code: "payment_cancel_failed" },
      "open-ticketing",
      "slug",
    )
    expect(result).not.toBeNull()
    expect(result!.messageKey).toBe("openCheckout.payment_cancel_failed")
    expect(result!.blockResubmit).toBe(false)
    expect(result!.setPersistentError).toBe(true)
    expect(result!.navigate).toBeNull()
  })

  it("concurrent_payment_in_progress (open-ticketing) → same retryable treatment as cancel_failed", () => {
    const result = dispatchPaymentError(
      { code: "concurrent_payment_in_progress" },
      "open-ticketing",
      "slug",
    )
    expect(result).not.toBeNull()
    expect(result!.messageKey).toBe("openCheckout.payment_cancel_failed")
    expect(result!.blockResubmit).toBe(false)
    expect(result!.setPersistentError).toBe(true)
    expect(result!.navigate).toBeNull()
  })

  it("payment_cancel_failed (application) → checkout prefix, retryable", () => {
    const result = dispatchPaymentError(
      { code: "payment_cancel_failed" },
      "application",
      "slug",
    )
    expect(result).not.toBeNull()
    expect(result!.messageKey).toBe("checkout.payment_cancel_failed")
    expect(result!.blockResubmit).toBe(false)
  })

  it("concurrent_payment_in_progress (application) → checkout prefix, retryable", () => {
    const result = dispatchPaymentError(
      { code: "concurrent_payment_in_progress" },
      "application",
      "slug",
    )
    expect(result).not.toBeNull()
    expect(result!.messageKey).toBe("checkout.payment_cancel_failed")
    expect(result!.blockResubmit).toBe(false)
  })

  it("502 payment_cancel_failed → same retryable treatment (backend reuses code on both 409 and 502)", () => {
    // The backend returns detail.code = "payment_cancel_failed" on both
    // 409 (sibling race) and 502 (SimpleFi cancel API error). The hook
    // receives the same code either way and should treat both as retryable.
    const result = dispatchPaymentError(
      { code: "payment_cancel_failed" },
      "open-ticketing",
      "slug",
    )
    expect(result).not.toBeNull()
    expect(result!.blockResubmit).toBe(false)
    expect(result!.messageKey).toBe("openCheckout.payment_cancel_failed")
  })
})

// ---------------------------------------------------------------------------
// dispatchPaymentError — pending_payment_exists
// ---------------------------------------------------------------------------

describe("dispatchPaymentError — pending_payment_exists", () => {
  it("open-ticketing → openCheckout prefix, no block, persistent banner, no nav", () => {
    const result = dispatchPaymentError(
      { code: "pending_payment_exists" },
      "open-ticketing",
      "slug",
    )
    expect(result).not.toBeNull()
    expect(result!.messageKey).toBe("openCheckout.pending_payment_wait")
    expect(result!.blockResubmit).toBe(false)
    expect(result!.setPersistentError).toBe(true)
    expect(result!.navigate).toBeNull()
  })

  it("application → checkout prefix (defensive: backend only sends this in open-ticketing)", () => {
    const result = dispatchPaymentError(
      { code: "pending_payment_exists" },
      "application",
      "slug",
    )
    expect(result).not.toBeNull()
    expect(result!.messageKey).toBe("checkout.pending_payment_wait")
    expect(result!.blockResubmit).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// dispatchPaymentError — unrecognised / null codes
// ---------------------------------------------------------------------------

describe("dispatchPaymentError — unrecognised codes fall through", () => {
  it("returns null for an unrecognised code", () => {
    expect(
      dispatchPaymentError(
        { code: "some_unknown_error" },
        "open-ticketing",
        null,
      ),
    ).toBeNull()
  })

  it("returns null when code is undefined", () => {
    expect(dispatchPaymentError({}, "open-ticketing", null)).toBeNull()
  })

  it("returns null when detail is empty object", () => {
    expect(dispatchPaymentError({}, "application", "slug")).toBeNull()
  })
})
