import { describe, expect, it } from "vitest"
import { CHECKOUT_MODE } from "@/checkout/popupCheckoutPolicy"
import { getPurchaseStrategy } from "@/strategies/PurchaseStrategy"
import type { ProductsPass } from "@/types/Products"

function createProduct(overrides: Partial<ProductsPass>): ProductsPass {
  return {
    id: overrides.id ?? "product-1",
    name: overrides.name ?? "Product",
    slug: overrides.slug ?? "product",
    popup_id: overrides.popup_id ?? "popup-1",
    attendee_category: overrides.attendee_category ?? "main",
    category: overrides.category ?? "ticket",
    duration_type: overrides.duration_type ?? "week",
    is_active: overrides.is_active ?? true,
    price: overrides.price ?? 100,
    quantity: overrides.quantity,
    purchased: overrides.purchased,
    max_quantity: overrides.max_quantity ?? 1,
    compare_price: overrides.compare_price ?? null,
  } as ProductsPass
}

describe("getPurchaseStrategy", () => {
  it("does not inherit monthly ownership in simple_quantity", () => {
    const strategy = getPurchaseStrategy(CHECKOUT_MODE.SIMPLE_QUANTITY)
    const products = [createProduct({ id: "week-1", duration_type: "week" })]
    const purchased = [
      createProduct({ id: "month-1", duration_type: "month", purchased: true }),
    ]

    const result = strategy.applyPurchaseRules(products, purchased)

    expect(result[0]?.purchased).toBe(false)
  })

  it("keeps month-to-week inheritance in pass_system", () => {
    const strategy = getPurchaseStrategy(CHECKOUT_MODE.PASS_SYSTEM)
    const products = [createProduct({ id: "week-1", duration_type: "week" })]
    const purchased = [
      createProduct({ id: "month-1", duration_type: "month", purchased: true }),
    ]

    const result = strategy.applyPurchaseRules(products, purchased)

    expect(result[0]?.purchased).toBe(true)
  })
})
