import { describe, expect, it } from "vitest"
import { CHECKOUT_MODE } from "@/checkout/popupCheckoutPolicy"
import { TotalCalculator } from "@/strategies/TotalStrategy"
import type { AttendeePassState } from "@/types/Attendee"
import type { DiscountProps } from "@/types/discounts"
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

function createAttendee(products: ProductsPass[]): AttendeePassState {
  return {
    id: "attendee-1",
    tenant_id: "tenant-1",
    popup_id: "popup-1",
    human_id: "human-1",
    application_id: null,
    name: "Main",
    category: "main",
    email: "main@example.com",
    gender: null,
    check_in_code: "",
    poap_url: null,
    created_at: null,
    updated_at: null,
    products,
  }
}

const noDiscount: DiscountProps = {
  discount_type: "percentage",
  discount_value: 0,
}

describe("TotalCalculator — mixed-category product lists", () => {
  it("under pass_system + patreon: ticket total = patreon price, housing total preserved separately", () => {
    // When patreon is selected under pass_system, ticket products are part of the
    // pass-system flow (PatreonPriceStrategy applies to ticket products).
    // Housing products must use simple_quantity semantics: price × quantity.
    // The total should be: patreonPrice + housingPrice×qty
    const ticket = createProduct({
      id: "ticket-1",
      category: "ticket",
      duration_type: "week",
      price: 100,
      original_price: 100,
      selected: true,
      quantity: 1,
    })
    const patreon = createProduct({
      id: "patreon-1",
      category: "patreon",
      duration_type: "week",
      price: 50,
      original_price: 50,
      selected: true,
      quantity: 1,
    })
    const housing = createProduct({
      id: "housing-1",
      category: "housing",
      duration_type: "week",
      price: 200,
      original_price: 200,
      selected: true,
      quantity: 2,
    })

    const attendee = createAttendee([ticket, patreon, housing])
    const result = new TotalCalculator(CHECKOUT_MODE.PASS_SYSTEM).calculate(
      [attendee],
      noDiscount,
    )

    // patreon price = 50; housing = 200 × 2 = 400
    // ticket is zeroed by patreon waiver (handled in PatreonPriceStrategy for ticket-only scope)
    // housing must be separately accounted for
    expect(result.total).toBe(450) // 50 (patreon) + 400 (housing)
  })

  it("zero-qty ticket and zero-qty housing: both totals = 0, no error thrown", () => {
    const ticket = createProduct({
      id: "ticket-1",
      category: "ticket",
      duration_type: "week",
      price: 100,
      original_price: 100,
      selected: false,
      quantity: 0,
    })
    const housing = createProduct({
      id: "housing-1",
      category: "housing",
      duration_type: "week",
      price: 200,
      original_price: 200,
      selected: false,
      quantity: 0,
    })
    const attendee = createAttendee([ticket, housing])
    expect(() => {
      const result = new TotalCalculator(CHECKOUT_MODE.PASS_SYSTEM).calculate(
        [attendee],
        noDiscount,
      )
      expect(result.total).toBe(0)
    }).not.toThrow()
  })

  it("under simple_quantity: mixed ticket+housing uses linear price×qty for all", () => {
    const ticket = createProduct({
      id: "ticket-1",
      category: "ticket",
      price: 100,
      original_price: 100,
      selected: true,
      quantity: 1,
    })
    const housing = createProduct({
      id: "housing-1",
      category: "housing",
      price: 200,
      original_price: 200,
      selected: true,
      quantity: 3,
    })
    const attendee = createAttendee([ticket, housing])
    const result = new TotalCalculator(CHECKOUT_MODE.SIMPLE_QUANTITY).calculate(
      [attendee],
      noDiscount,
    )
    expect(result.total).toBe(700) // 100×1 + 200×3
  })
})
