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

describe("getPurchaseStrategy — ticket-scoped monthly inheritance", () => {
  it("non-ticket (housing) with duration_type=week is NOT marked purchased via month inheritance", () => {
    const strategy = getPurchaseStrategy(CHECKOUT_MODE.PASS_SYSTEM)
    // Simulate: attendee has a month-duration ticket purchased, but we're checking a housing product
    const housingWeek = createProduct({
      id: "housing-week",
      category: "housing",
      duration_type: "week",
    })
    const monthTicketPurchased = createProduct({
      id: "month-ticket",
      category: "ticket",
      duration_type: "month",
      purchased: true,
    })
    const result = strategy.applyPurchaseRules(
      [housingWeek],
      [monthTicketPurchased],
    )
    expect(result[0]?.purchased).toBe(false)
  })

  it("ticket week product IS marked purchased via month inheritance in pass_system", () => {
    const strategy = getPurchaseStrategy(CHECKOUT_MODE.PASS_SYSTEM)
    const weekTicket = createProduct({
      id: "week-ticket",
      category: "ticket",
      duration_type: "week",
    })
    const monthTicketPurchased = createProduct({
      id: "month-ticket",
      category: "ticket",
      duration_type: "month",
      purchased: true,
    })
    const result = strategy.applyPurchaseRules(
      [weekTicket],
      [monthTicketPurchased],
    )
    expect(result[0]?.purchased).toBe(true)
  })
})
