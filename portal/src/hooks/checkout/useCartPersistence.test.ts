// @vitest-environment node

import { describe, expect, it, vi } from "vitest"

vi.mock("@/hooks/useCartApi", () => ({
  EMPTY_CART: {},
  useCart: vi.fn(),
  useClearCart: vi.fn(),
  useSaveCart: vi.fn(),
}))

import type { CartSelectionState } from "./useCartPersistence"
import { buildPersistedCartState } from "./useCartPersistence"

describe("buildPersistedCartState", () => {
  it("records a stay for abandoned-cart review without treating it as a hold", () => {
    const state = {
      selectedPasses: [],
      housing: null,
      accommodations: [
        {
          accommodationId: "room-1",
          productId: "shadow-room-1",
          name: "Double room",
          propertyId: "property-1",
          propertyName: "Hotel",
          checkIn: "2026-09-01",
          checkOut: "2026-09-03",
          nights: 2,
          guestCount: 2,
          guests: ["Taylor Buyer", ""],
          subtotal: 100,
          tax: 10,
          totalPrice: 110,
        },
      ],
      merch: [],
      patron: null,
      selectedMealPlans: [],
      dynamicItems: {},
      promoCode: "",
      promoCodeValid: false,
      insurance: false,
      currentStep: "accommodation",
    } satisfies CartSelectionState

    expect(buildPersistedCartState(state).accommodations).toEqual([
      {
        accommodation_id: "room-1",
        check_in: "2026-09-01",
        check_out: "2026-09-03",
        guest_count: 2,
        guests: ["Taylor Buyer"],
      },
    ])
  })
})
