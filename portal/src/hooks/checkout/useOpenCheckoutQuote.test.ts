import { describe, expect, it } from "vitest"
import { buildOpenCheckoutPreviewRequest } from "./useOpenCheckoutQuote"

describe("buildOpenCheckoutPreviewRequest", () => {
  it("combines selected checkout products into one selected-flow quote request", () => {
    const request = buildOpenCheckoutPreviewRequest({
      passes: [{ productId: "ticket", quantity: 2 }],
      housing: null,
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
})
