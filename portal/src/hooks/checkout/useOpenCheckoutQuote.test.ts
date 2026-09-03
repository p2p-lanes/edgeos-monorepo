import { describe, expect, it, vi } from "vitest"

vi.mock("@/client", () => ({
  CheckoutService: { previewOpenTicketing: vi.fn() },
}))

import { buildOpenCheckoutPreviewRequest } from "./useOpenCheckoutQuote"

describe("buildOpenCheckoutPreviewRequest", () => {
  it("combines selected checkout products into one selected-flow quote request", () => {
    const request = buildOpenCheckoutPreviewRequest({
      passes: [{ productId: "ticket", quantity: 2 }],
      housing: null,
      accommodations: [],
      merch: [{ productId: "shirt", quantity: 1 }],
      patron: null,
      mealPlans: [],
      dynamicItems: { extras: [{ productId: "shirt", quantity: 2 }] },
      promoCode: "WELCOME",
      insurance: false,
    } as never)

    expect(request).toEqual({
      products: [
        { product_id: "ticket", quantity: 2 },
        { product_id: "shirt", quantity: 3 },
      ],
      coupon_code: "WELCOME",
      insurance: false,
    })
  })

  it("keeps an incomplete buyer absent so the server returns an estimate", () => {
    const request = buildOpenCheckoutPreviewRequest({
      passes: [{ productId: "ticket", quantity: 1 }],
      housing: null,
      accommodations: [],
      merch: [],
      patron: null,
      mealPlans: [],
      dynamicItems: {},
      promoCode: "",
      insurance: true,
    } as never)

    expect(request).toEqual({
      products: [{ product_id: "ticket", quantity: 1 }],
      coupon_code: null,
      insurance: true,
    })
  })

  it("keeps same-room stays distinct so the server can quote their dates", () => {
    const request = buildOpenCheckoutPreviewRequest({
      passes: [],
      housing: null,
      accommodations: [
        {
          productId: "room-product",
          accommodationId: "room-1",
          checkIn: "2026-09-01",
          checkOut: "2026-09-03",
          guestCount: 1,
          guests: ["Taylor Buyer"],
        },
        {
          productId: "room-product",
          accommodationId: "room-1",
          checkIn: "2026-09-10",
          checkOut: "2026-09-12",
          guestCount: 1,
          guests: ["Taylor Buyer"],
        },
      ],
      merch: [],
      patron: null,
      mealPlans: [],
      dynamicItems: {},
      promoCode: "",
      insurance: false,
    } as never)

    expect(request.products).toHaveLength(2)
    expect(request.products.map((line) => line.purchase_metadata)).toEqual([
      expect.objectContaining({ check_in: "2026-09-01" }),
      expect.objectContaining({ check_in: "2026-09-10" }),
    ])
  })
})
