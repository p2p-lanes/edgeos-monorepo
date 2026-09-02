import { act, renderHook, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { CheckoutService } from "@/client"
import type { ProductsPass } from "@/types/Products"

vi.mock("@/client", () => ({
  CheckoutService: {
    restoreFlowCart: vi.fn(),
    upsertFlowCart: vi.fn(),
  },
}))

import type { CartSelectionState } from "./useCartPersistence"
import {
  type CartItemsSnapshot,
  getOpenCartScope,
  useOpenCartPersistence,
} from "./useOpenCartPersistence"

describe("getOpenCartScope", () => {
  it("keeps a named flow cart separate from the compatibility-default cart", () => {
    expect(getOpenCartScope("festival-2026", "merch-store")).toEqual({
      storageKey: "open-cart:festival-2026:merch-store",
      isNamedFlow: true,
    })
  })

  it("keeps two named flows of the same popup in different caches", () => {
    const main = getOpenCartScope("festival-2026", "main")
    const partner = getOpenCartScope("festival-2026", "partner")

    expect(main.storageKey).not.toBe(partner.storageKey)
    expect(main.storageKey).toBe("open-cart:festival-2026:main")
    expect(partner.storageKey).toBe("open-cart:festival-2026:partner")
  })

  it("preserves the compatibility cart key when an optional flow is omitted", () => {
    const scope = getOpenCartScope("festival-2026")

    expect(scope).toEqual({
      storageKey: "open-cart:festival-2026",
      isNamedFlow: false,
    })
    expect(scope.storageKey).not.toContain("undefined")
  })
})

describe("useOpenCartPersistence Sales Flow boundary", () => {
  it("ignores a signed restore that settles after the flow changes", async () => {
    const emptySnapshot: CartItemsSnapshot = {
      passes: [],
      recipients: [],
      housing: null,
      merch: [],
      patron: null,
      meal_plans: [],
      accommodations: [],
      dynamic_items: [],
      promo_code: null,
      insurance: false,
      current_step: null,
    }
    const oldSnapshot: CartItemsSnapshot = {
      ...emptySnapshot,
      merch: [{ product_id: "product-1", quantity: 1 }],
    }
    let resolveOldRestore!: (value: {
      id: string
      restore_token: string
      items: CartItemsSnapshot
    }) => void
    const oldRestore = new Promise<{
      id: string
      restore_token: string
      items: CartItemsSnapshot
    }>((resolve) => {
      resolveOldRestore = resolve
    })
    vi.mocked(CheckoutService.restoreFlowCart).mockImplementation(
      ({ flowSlug }) =>
        flowSlug === "main"
          ? (oldRestore as never)
          : (Promise.resolve({
              id: "cart-partner",
              restore_token: "token-partner",
              items: emptySnapshot,
            }) as never),
    )

    const selectionStateRef = {
      current: {
        selectedPasses: [],
        housing: null,
        accommodations: [],
        merch: [],
        patron: null,
        selectedMealPlans: [],
        dynamicItems: {},
        promoCode: "",
        promoCodeValid: false,
        insurance: false,
        currentStep: "passes",
      } satisfies CartSelectionState,
    }
    const hasRestoredCheckoutRef = { current: false }
    const paymentCompleteRef = { current: false }
    const setMerch = vi.fn()
    const products = [
      {
        id: "product-1",
        name: "T-shirt",
        price: 20,
        is_active: true,
        category: "merch",
      } as ProductsPass,
    ]
    const restorationSetters = {
      setHousing: vi.fn(),
      setAccommodations: vi.fn(),
      setMerch,
      setPatron: vi.fn(),
      setMealPlans: vi.fn(),
      setInsurance: vi.fn(),
      setDynamicItems: vi.fn(),
    }

    const { result, rerender } = renderHook(
      ({ flowSlug }: { flowSlug: string }) =>
        useOpenCartPersistence({
          popupSlug: "festival-2026",
          flowSlug,
          enabled: true,
          selectionStateRef,
          products,
          housingPricePerDay: true,
          restorationSetters,
          hasRestoredCheckoutRef,
          paymentCompleteRef,
          buyerEmail: "buyer@example.com",
          initialStep: "passes",
          cid: "cart-id",
          sig: "restore-token",
        }),
      { initialProps: { flowSlug: "main" } },
    )
    await waitFor(() =>
      expect(CheckoutService.restoreFlowCart).toHaveBeenCalledWith(
        expect.objectContaining({ flowSlug: "main" }),
      ),
    )

    rerender({ flowSlug: "partner" })
    await act(async () => result.current.restorationPromise)
    expect(result.current.cartMetaRef.current).toEqual({
      cartId: "cart-partner",
      restoreToken: "token-partner",
    })

    await act(async () => {
      resolveOldRestore({
        id: "cart-main",
        restore_token: "token-main",
        items: oldSnapshot,
      })
      await oldRestore
    })

    expect(result.current.cartMetaRef.current).toEqual({
      cartId: "cart-partner",
      restoreToken: "token-partner",
    })
    expect(setMerch).not.toHaveBeenCalled()
  })
})
