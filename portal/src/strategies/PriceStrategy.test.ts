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
    tenant_id: overrides.tenant_id ?? "tenant-1",
    attendee_category_id: overrides.attendee_category_id ?? null,
    category: overrides.category ?? "ticket",
    duration_type: overrides.duration_type ?? "week",
    is_active: overrides.is_active ?? true,
    price: overrides.price ?? 100,
    original_price: overrides.original_price ?? overrides.price ?? 100,
    quantity: overrides.quantity ?? 1,
    selected: overrides.selected,
    purchased: overrides.purchased,
    max_per_order: overrides.max_per_order ?? 1,
    compare_price: overrides.compare_price ?? null,
    discountable: overrides.discountable ?? true,
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

  it("takes the scholarship off the current catalog price, not compare_price", () => {
    const strategy = getPriceStrategy(CHECKOUT_MODE.PASS_SYSTEM)
    expect(
      strategy.calculatePrice(
        createProduct({ price: 925, original_price: 925, compare_price: 1000 }),
        false,
        30,
      ),
    ).toBe(647.5)
  })

  it("keeps non-discountable products at their catalog price", () => {
    const strategy = getPriceStrategy(CHECKOUT_MODE.PASS_SYSTEM)
    expect(
      strategy.calculatePrice(
        createProduct({ price: 925, discountable: false }),
        false,
        30,
      ),
    ).toBe(925)
  })
})
