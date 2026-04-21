import { describe, expect, it } from "vitest"
import { CHECKOUT_MODE } from "@/checkout/popupCheckoutPolicy"
import { getProductStrategy } from "@/strategies/ProductStrategies"
import type { AttendeePassState } from "@/types/Attendee"
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

describe("getProductStrategy — category-scoped selection", () => {
  // Discriminating test: WeekProductStrategy auto-selects a month pass when
  // 4+ weeks become selected. SimpleQuantityProductStrategy never does this.
  // So housing under pass_system should NOT auto-select a "month" housing product.
  it("housing under pass_system does NOT auto-upgrade to month (uses SimpleQuantity, not WeekStrategy)", () => {
    const h1 = createProduct({
      id: "h1",
      category: "housing",
      selected: true,
      duration_type: "week",
      max_quantity: 1,
    })
    const h2 = createProduct({
      id: "h2",
      category: "housing",
      selected: true,
      duration_type: "week",
      max_quantity: 1,
    })
    const h3 = createProduct({
      id: "h3",
      category: "housing",
      selected: true,
      duration_type: "week",
      max_quantity: 1,
    })
    // h4 is the one being selected — reaching 4 weeks total
    const h4 = createProduct({
      id: "h4",
      category: "housing",
      selected: false,
      duration_type: "week",
      max_quantity: 1,
    })
    const monthHousing = createProduct({
      id: "h-month",
      category: "housing",
      selected: false,
      duration_type: "month",
      max_quantity: 1,
    })
    const attendees = [createAttendee([h1, h2, h3, h4, monthHousing])]
    const strategy = getProductStrategy(h4, false, CHECKOUT_MODE.PASS_SYSTEM)
    const result = strategy.handleSelection(attendees, "attendee-1", h4)
    // SimpleQuantity: only h4 changes; month stays unselected
    // WeekStrategy: would auto-select the month product
    expect(result[0]?.products.find((p) => p.id === "h-month")?.selected).toBe(
      false,
    )
  })

  it("merch under pass_system uses SimpleQuantityProductStrategy (toggles selected without pass-system side effects)", () => {
    const merch = createProduct({
      id: "m1",
      category: "merch",
      selected: false,
      duration_type: "week",
      max_quantity: 1,
    })
    const monthMerch = createProduct({
      id: "m-month",
      category: "merch",
      selected: false,
      duration_type: "month",
      max_quantity: 1,
    })
    const m2 = createProduct({
      id: "m2",
      category: "merch",
      selected: true,
      duration_type: "week",
    })
    const m3 = createProduct({
      id: "m3",
      category: "merch",
      selected: true,
      duration_type: "week",
    })
    const m4 = createProduct({
      id: "m4",
      category: "merch",
      selected: true,
      duration_type: "week",
    })
    const attendees = [createAttendee([merch, m2, m3, m4, monthMerch])]
    const strategy = getProductStrategy(merch, false, CHECKOUT_MODE.PASS_SYSTEM)
    const result = strategy.handleSelection(attendees, "attendee-1", merch)
    expect(result[0]?.products.find((p) => p.id === "m-month")?.selected).toBe(
      false,
    )
  })

  it("supporter under pass_system uses SimpleQuantityProductStrategy (toggles selected)", () => {
    const supporter = createProduct({
      id: "s1",
      category: "supporter",
      selected: false,
      max_quantity: 1,
    })
    const attendees = [createAttendee([supporter])]
    const strategy = getProductStrategy(
      supporter,
      false,
      CHECKOUT_MODE.PASS_SYSTEM,
    )
    const result = strategy.handleSelection(attendees, "attendee-1", supporter)
    expect(result[0]?.products[0]?.selected).toBe(true)
  })

  it("ticket under simple_quantity uses SimpleQuantityProductStrategy (toggles selected)", () => {
    const ticket = createProduct({
      id: "t1",
      category: "ticket",
      selected: false,
      duration_type: "week",
      max_quantity: 1,
    })
    const attendees = [createAttendee([ticket])]
    const strategy = getProductStrategy(
      ticket,
      false,
      CHECKOUT_MODE.SIMPLE_QUANTITY,
    )
    const result = strategy.handleSelection(attendees, "attendee-1", ticket)
    expect(result[0]?.products[0]?.selected).toBe(true)
  })

  it("ticket under pass_system with duration_type=week auto-upgrades to month when 4 weeks selected (WeekStrategy active)", () => {
    const t1 = createProduct({
      id: "t1",
      category: "ticket",
      selected: true,
      duration_type: "week",
      max_quantity: 1,
    })
    const t2 = createProduct({
      id: "t2",
      category: "ticket",
      selected: true,
      duration_type: "week",
      max_quantity: 1,
    })
    const t3 = createProduct({
      id: "t3",
      category: "ticket",
      selected: true,
      duration_type: "week",
      max_quantity: 1,
    })
    const t4 = createProduct({
      id: "t4",
      category: "ticket",
      selected: false,
      duration_type: "week",
      max_quantity: 1,
    })
    const monthTicket = createProduct({
      id: "t-month",
      category: "ticket",
      selected: false,
      duration_type: "month",
      max_quantity: 1,
    })
    const attendees = [createAttendee([t1, t2, t3, t4, monthTicket])]
    const strategy = getProductStrategy(t4, false, CHECKOUT_MODE.PASS_SYSTEM)
    const result = strategy.handleSelection(attendees, "attendee-1", t4)
    // WeekStrategy auto-selects month when ≥4 weeks active
    expect(result[0]?.products.find((p) => p.id === "t-month")?.selected).toBe(
      true,
    )
  })
})
