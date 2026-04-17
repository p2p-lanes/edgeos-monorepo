import { describe, expect, it } from "vitest"
import { CHECKOUT_MODE } from "@/checkout/popupCheckoutPolicy"
import { getPriceStrategy } from "@/strategies/PriceStrategy"
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
    original_price: overrides.original_price ?? overrides.price ?? 100,
    quantity: overrides.quantity ?? 1,
    selected: overrides.selected,
    purchased: overrides.purchased,
    max_quantity: overrides.max_quantity ?? 1,
    compare_price: overrides.compare_price ?? null,
  } as ProductsPass
}

describe("DefaultPriceStrategy.calculatePrice — patreon waiver ticket-scoping", () => {
  it("zeros ticket price under pass_system when patreon purchased", () => {
    const strategy = getPriceStrategy(CHECKOUT_MODE.PASS_SYSTEM)
    const ticket = createProduct({
      category: "ticket",
      price: 100,
      original_price: 100,
    })
    expect(strategy.calculatePrice(ticket, true, 0)).toBe(0)
  })

  it("does NOT zero housing price under pass_system when patreon purchased", () => {
    const strategy = getPriceStrategy(CHECKOUT_MODE.PASS_SYSTEM)
    const housing = createProduct({
      category: "housing",
      price: 200,
      original_price: 200,
    })
    expect(strategy.calculatePrice(housing, true, 0)).toBe(200)
  })

  it("does NOT zero merch price under pass_system when patreon purchased", () => {
    const strategy = getPriceStrategy(CHECKOUT_MODE.PASS_SYSTEM)
    const merch = createProduct({
      category: "merch",
      price: 50,
      original_price: 50,
    })
    expect(strategy.calculatePrice(merch, true, 0)).toBe(50)
  })

  it("does NOT zero ticket price under simple_quantity even when patreon purchased", () => {
    const strategy = getPriceStrategy(CHECKOUT_MODE.SIMPLE_QUANTITY)
    const ticket = createProduct({
      category: "ticket",
      price: 100,
      original_price: 100,
    })
    expect(strategy.calculatePrice(ticket, true, 0)).toBe(100)
  })

  it("does NOT zero housing price under simple_quantity when patreon purchased", () => {
    const strategy = getPriceStrategy(CHECKOUT_MODE.SIMPLE_QUANTITY)
    const housing = createProduct({
      category: "housing",
      price: 200,
      original_price: 200,
    })
    expect(strategy.calculatePrice(housing, true, 0)).toBe(200)
  })
})
