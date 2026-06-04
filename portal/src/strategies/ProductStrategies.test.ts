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
      max_per_order: 1,
    })
    const h2 = createProduct({
      id: "h2",
      category: "housing",
      selected: true,
      duration_type: "week",
      max_per_order: 1,
    })
    const h3 = createProduct({
      id: "h3",
      category: "housing",
      selected: true,
      duration_type: "week",
      max_per_order: 1,
    })
    // h4 is the one being selected — reaching 4 weeks total
    const h4 = createProduct({
      id: "h4",
      category: "housing",
      selected: false,
      duration_type: "week",
      max_per_order: 1,
    })
    const monthHousing = createProduct({
      id: "h-month",
      category: "housing",
      selected: false,
      duration_type: "month",
      max_per_order: 1,
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
      max_per_order: 1,
    })
    const monthMerch = createProduct({
      id: "m-month",
      category: "merch",
      selected: false,
      duration_type: "month",
      max_per_order: 1,
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

  it("non-ticket category under pass_system uses SimpleQuantityProductStrategy (toggles selected)", () => {
    const merch = createProduct({
      id: "m1",
      category: "merch",
      selected: false,
      max_per_order: 1,
    })
    const attendees = [createAttendee([merch])]
    const strategy = getProductStrategy(merch, false, CHECKOUT_MODE.PASS_SYSTEM)
    const result = strategy.handleSelection(attendees, "attendee-1", merch)
    expect(result[0]?.products[0]?.selected).toBe(true)
  })

  it("ticket under simple_quantity uses SimpleQuantityProductStrategy (toggles selected)", () => {
    const ticket = createProduct({
      id: "t1",
      category: "ticket",
      selected: false,
      duration_type: "week",
      max_per_order: 1,
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
      max_per_order: 1,
    })
    const t2 = createProduct({
      id: "t2",
      category: "ticket",
      selected: true,
      duration_type: "week",
      max_per_order: 1,
    })
    const t3 = createProduct({
      id: "t3",
      category: "ticket",
      selected: true,
      duration_type: "week",
      max_per_order: 1,
    })
    const t4 = createProduct({
      id: "t4",
      category: "ticket",
      selected: false,
      duration_type: "week",
      max_per_order: 1,
    })
    const monthTicket = createProduct({
      id: "t-month",
      category: "ticket",
      selected: false,
      duration_type: "month",
      max_per_order: 1,
    })
    const attendees = [createAttendee([t1, t2, t3, t4, monthTicket])]
    const strategy = getProductStrategy(t4, false, CHECKOUT_MODE.PASS_SYSTEM)
    const result = strategy.handleSelection(attendees, "attendee-1", t4)
    // WeekStrategy auto-selects month when ≥4 weeks active
    expect(result[0]?.products.find((p) => p.id === "t-month")?.selected).toBe(
      true,
    )
    // Non-purchased weeks are cleared so the cart shows only the month
    // (otherwise the user pays for month + 4 weeks simultaneously).
    for (const id of ["t1", "t2", "t3", "t4"]) {
      expect(result[0]?.products.find((p) => p.id === id)?.selected).toBe(false)
    }
  })

  it("auto-upgrade to month keeps purchased weeks selected (cannot retroactively refund)", () => {
    const t1 = createProduct({
      id: "t1",
      category: "ticket",
      selected: true,
      purchased: true,
      duration_type: "week",
      max_per_order: 1,
    })
    const t2 = createProduct({
      id: "t2",
      category: "ticket",
      selected: true,
      duration_type: "week",
      max_per_order: 1,
    })
    const t3 = createProduct({
      id: "t3",
      category: "ticket",
      selected: true,
      duration_type: "week",
      max_per_order: 1,
    })
    const t4 = createProduct({
      id: "t4",
      category: "ticket",
      selected: false,
      duration_type: "week",
      max_per_order: 1,
    })
    const monthTicket = createProduct({
      id: "t-month",
      category: "ticket",
      selected: false,
      duration_type: "month",
      max_per_order: 1,
    })
    const attendees = [createAttendee([t1, t2, t3, t4, monthTicket])]
    const strategy = getProductStrategy(t4, false, CHECKOUT_MODE.PASS_SYSTEM)
    const result = strategy.handleSelection(attendees, "attendee-1", t4)
    expect(result[0]?.products.find((p) => p.id === "t-month")?.selected).toBe(
      true,
    )
    // Purchased week stays as-is; non-purchased ones get cleared.
    expect(result[0]?.products.find((p) => p.id === "t1")?.selected).toBe(true)
    expect(result[0]?.products.find((p) => p.id === "t2")?.selected).toBe(false)
    expect(result[0]?.products.find((p) => p.id === "t3")?.selected).toBe(false)
    expect(result[0]?.products.find((p) => p.id === "t4")?.selected).toBe(false)
  })
})

describe("WeekProductStrategy — attendeeVisibleProductIds (wide scope)", () => {
  // Reproduces the Sonoma layout: Month sits in one section, Weeks in another.
  // Strict scope alone wouldn't promote (Month not in week scope), but the
  // attendee-wide visible set crosses sections, so 4 weeks → Month locals.
  it("promotes Month in a different section when both share the attendee-visible set", () => {
    const w1 = createProduct({
      id: "w1-locals",
      category: "ticket",
      selected: true,
      duration_type: "week",
      max_per_order: 1,
    })
    const w2 = createProduct({
      id: "w2-locals",
      category: "ticket",
      selected: true,
      duration_type: "week",
      max_per_order: 1,
    })
    const w3 = createProduct({
      id: "w3-locals",
      category: "ticket",
      selected: true,
      duration_type: "week",
      max_per_order: 1,
    })
    const w4 = createProduct({
      id: "w4-locals",
      category: "ticket",
      selected: false,
      duration_type: "week",
      max_per_order: 1,
    })
    const monthLocals = createProduct({
      id: "month-locals",
      category: "ticket",
      selected: false,
      duration_type: "month",
      max_per_order: 1,
    })
    // Decoy: a Month from the OTHER tier (regular). Must NOT be promoted.
    const monthRegular = createProduct({
      id: "month-regular",
      category: "ticket",
      selected: false,
      duration_type: "month",
      max_per_order: 1,
    })
    const attendees = [
      createAttendee([w1, w2, w3, w4, monthLocals, monthRegular]),
    ]
    const strategy = getProductStrategy(w4, false, CHECKOUT_MODE.PASS_SYSTEM)

    // Strict scope = "WEEKLY PASSES (Locals)" section (only weeks).
    // Wide scope = visible products across both sections (weeks + month locals).
    const strictScope = ["w1-locals", "w2-locals", "w3-locals", "w4-locals"]
    const wideScope = [
      "w1-locals",
      "w2-locals",
      "w3-locals",
      "w4-locals",
      "month-locals",
    ]

    const result = strategy.handleSelection(
      attendees,
      "attendee-1",
      w4,
      undefined,
      strictScope,
      wideScope,
    )

    const monthL = result[0]?.products.find((p) => p.id === "month-locals")
    const monthR = result[0]?.products.find((p) => p.id === "month-regular")
    expect(monthL?.selected).toBe(true)
    // Regular month was outside the wide scope — never touched.
    expect(monthR?.selected).toBe(false)
    // The 4 weeks should be cleared (promoted to month).
    for (const id of strictScope) {
      expect(result[0]?.products.find((p) => p.id === id)?.selected).toBe(false)
    }
  })

  it("falls back to legacy (no scope) when neither scope is provided", () => {
    // Sanity: existing legacy test in this file passes with no scope arg.
    // This test re-asserts that wide scope is optional and not required.
    const t1 = createProduct({
      id: "t1",
      category: "ticket",
      selected: true,
      duration_type: "week",
      max_per_order: 1,
    })
    const t2 = createProduct({
      id: "t2",
      category: "ticket",
      selected: true,
      duration_type: "week",
      max_per_order: 1,
    })
    const t3 = createProduct({
      id: "t3",
      category: "ticket",
      selected: true,
      duration_type: "week",
      max_per_order: 1,
    })
    const t4 = createProduct({
      id: "t4",
      category: "ticket",
      selected: false,
      duration_type: "week",
      max_per_order: 1,
    })
    const month = createProduct({
      id: "t-month",
      category: "ticket",
      selected: false,
      duration_type: "month",
      max_per_order: 1,
    })
    const attendees = [createAttendee([t1, t2, t3, t4, month])]
    const strategy = getProductStrategy(t4, false, CHECKOUT_MODE.PASS_SYSTEM)
    const result = strategy.handleSelection(attendees, "attendee-1", t4)
    expect(result[0]?.products.find((p) => p.id === "t-month")?.selected).toBe(
      true,
    )
  })
})

describe("ExclusivityGuard — section scope (tech-summit reproduction)", () => {
  // Reproduces: GA + VIP both exclusive, multi-unit (max_per_order=null), duration_type=full.
  // Pre-state: GA quantity=1 selected, VIP quantity=0 not selected.
  // Action: user clicks +1 on VIP.
  // Expected: VIP quantity=1 selected, GA quantity=0 NOT selected.
  it("clicking + on VIP cancels GA when both are exclusive multi-unit full passes in same section", () => {
    const ga = {
      ...createProduct({
        id: "ga",
        name: "General Admission",
        category: "ticket",
        duration_type: "full",
        quantity: 1,
        selected: true,
      }),
      max_per_order: null,
      exclusive: true,
    } as ProductsPass
    const vip = {
      ...createProduct({
        id: "vip",
        name: "VIP Pass",
        category: "ticket",
        duration_type: "full",
        quantity: 0,
        selected: false,
      }),
      max_per_order: null,
      exclusive: true,
    } as ProductsPass
    const attendees = [createAttendee([ga, vip])]
    const strategy = getProductStrategy(vip, false, CHECKOUT_MODE.PASS_SYSTEM)

    // Simulate the stepper +1: caller passes product with quantity=1 and the section scope.
    const result = strategy.handleSelection(
      attendees,
      "attendee-1",
      { ...vip, quantity: 1 },
      undefined,
      ["ga", "vip"],
    )

    const updatedGa = result[0]?.products.find((p) => p.id === "ga")
    const updatedVip = result[0]?.products.find((p) => p.id === "vip")
    expect(updatedVip?.quantity).toBe(1)
    expect(updatedVip?.selected).toBe(true)
    expect(updatedGa?.quantity).toBe(0)
    expect(updatedGa?.selected).toBe(false)
  })

  it("clicking + on GA cancels VIP (symmetric)", () => {
    const ga = {
      ...createProduct({
        id: "ga",
        name: "General Admission",
        category: "ticket",
        duration_type: "full",
        quantity: 0,
        selected: false,
      }),
      max_per_order: null,
      exclusive: true,
    } as ProductsPass
    const vip = {
      ...createProduct({
        id: "vip",
        name: "VIP Pass",
        category: "ticket",
        duration_type: "full",
        quantity: 1,
        selected: true,
      }),
      max_per_order: null,
      exclusive: true,
    } as ProductsPass
    const attendees = [createAttendee([ga, vip])]
    const strategy = getProductStrategy(ga, false, CHECKOUT_MODE.PASS_SYSTEM)
    const result = strategy.handleSelection(
      attendees,
      "attendee-1",
      { ...ga, quantity: 1 },
      undefined,
      ["ga", "vip"],
    )
    const updatedGa = result[0]?.products.find((p) => p.id === "ga")
    const updatedVip = result[0]?.products.find((p) => p.id === "vip")
    expect(updatedGa?.quantity).toBe(1)
    expect(updatedGa?.selected).toBe(true)
    expect(updatedVip?.quantity).toBe(0)
    expect(updatedVip?.selected).toBe(false)
  })
})

describe("EditProductStrategy — month upgrade while editing", () => {
  const month = (overrides: Partial<ProductsPass> = {}) =>
    createProduct({
      id: "month",
      duration_type: "month",
      price: 400,
      max_per_order: 1,
      ...overrides,
    })
  const week = (id: string, overrides: Partial<ProductsPass> = {}) =>
    createProduct({
      id,
      duration_type: "week",
      price: 100,
      max_per_order: 1,
      ...overrides,
    })

  // Owns Week 1. Selecting the month should give up the owned week for credit
  // (edit=true) so the price collapses to month - credit.
  it("selecting month credits owned weeks", () => {
    const attendees = [
      createAttendee([
        month(),
        week("w1", { purchased: true, selected: true }),
      ]),
    ]
    const strategy = getProductStrategy(
      month(),
      true,
      CHECKOUT_MODE.PASS_SYSTEM,
    )
    const result = strategy.handleSelection(attendees, "attendee-1", month())

    const m = result[0]?.products.find((p) => p.id === "month")
    const w1 = result[0]?.products.find((p) => p.id === "w1")
    expect(m?.selected).toBe(true)
    expect(w1?.edit).toBe(true)
    expect(w1?.selected).toBe(false)
  })

  // Owns Week 1 (given up for credit) and added Weeks 2-4. Selecting the month
  // must drop the newly added weeks and keep the owned week credited.
  it("selecting month deselects newly added weeks and keeps owned week credited", () => {
    const attendees = [
      createAttendee([
        month(),
        week("w1", { purchased: true, edit: true, selected: false }),
        week("w2", { selected: true }),
        week("w3", { selected: true }),
        week("w4", { selected: true }),
      ]),
    ]
    const strategy = getProductStrategy(
      month(),
      true,
      CHECKOUT_MODE.PASS_SYSTEM,
    )
    const result = strategy.handleSelection(attendees, "attendee-1", month())

    const products = result[0]?.products
    expect(products?.find((p) => p.id === "month")?.selected).toBe(true)
    expect(products?.find((p) => p.id === "w1")?.edit).toBe(true)
    for (const id of ["w2", "w3", "w4"]) {
      expect(products?.find((p) => p.id === id)?.selected).toBe(false)
    }
  })

  // Deselecting the month restores the owned week as kept (not credited).
  it("deselecting month restores owned weeks to kept", () => {
    const attendees = [
      createAttendee([
        month({ selected: true }),
        week("w1", { purchased: true, edit: true, selected: false }),
      ]),
    ]
    const selectedMonth = month({ selected: true })
    const strategy = getProductStrategy(
      selectedMonth,
      true,
      CHECKOUT_MODE.PASS_SYSTEM,
    )
    const result = strategy.handleSelection(
      attendees,
      "attendee-1",
      selectedMonth,
    )

    const m = result[0]?.products.find((p) => p.id === "month")
    const w1 = result[0]?.products.find((p) => p.id === "w1")
    expect(m?.selected).toBe(false)
    expect(w1?.edit).toBe(false)
    expect(w1?.selected).toBe(true)
  })

  // The reported bug: owns Week 1 (kept) and selects the remaining weeks. The
  // 4th selection completes the set and must auto-promote to the month, just
  // like WeekProductStrategy does in normal checkout (bypassed while editing).
  it("completing the week set auto-promotes to month and credits the owned week", () => {
    const scope = ["month", "w1", "w2", "w3", "w4"]
    const attendees = [
      createAttendee([
        month(),
        week("w1", { purchased: true, selected: true }),
        week("w2", { selected: true }),
        week("w3", { selected: true }),
        week("w4", { selected: false }),
      ]),
    ]
    const w4 = week("w4", { selected: false })
    const strategy = getProductStrategy(w4, true, CHECKOUT_MODE.PASS_SYSTEM)
    const result = strategy.handleSelection(
      attendees,
      "attendee-1",
      w4,
      undefined,
      scope,
      scope,
    )

    const products = result[0]?.products
    expect(products?.find((p) => p.id === "month")?.selected).toBe(true)
    // Owned week is given up for credit, newly added weeks are dropped.
    expect(products?.find((p) => p.id === "w1")?.edit).toBe(true)
    for (const id of ["w2", "w3", "w4"]) {
      expect(products?.find((p) => p.id === id)?.selected).toBe(false)
    }
  })

  // Below the threshold there is no promotion: selecting a 2nd week with one
  // owned must keep the weeks as-is (no month yet).
  it("does not promote before the full week set is active", () => {
    const scope = ["month", "w1", "w2", "w3", "w4"]
    const attendees = [
      createAttendee([
        month(),
        week("w1", { purchased: true, selected: true }),
        week("w2", { selected: false }),
        week("w3", { selected: false }),
        week("w4", { selected: false }),
      ]),
    ]
    const w2 = week("w2", { selected: false })
    const strategy = getProductStrategy(w2, true, CHECKOUT_MODE.PASS_SYSTEM)
    const result = strategy.handleSelection(
      attendees,
      "attendee-1",
      w2,
      undefined,
      scope,
      scope,
    )

    const products = result[0]?.products
    expect(products?.find((p) => p.id === "month")?.selected).toBeFalsy()
    expect(products?.find((p) => p.id === "w2")?.selected).toBe(true)
    expect(products?.find((p) => p.id === "w1")?.selected).toBe(true)
  })

  // Reported bug: owns a week and adds a day pass. Day passes are driven by
  // quantity, which the plain edit toggle ignored — the "+" did nothing.
  it("adding a day pass updates its quantity while editing", () => {
    const attendees = [
      createAttendee([
        week("w1", { purchased: true, selected: true }),
        createProduct({
          id: "day",
          duration_type: "day",
          price: 99,
          quantity: 0,
          max_per_order: 5,
        }),
      ]),
    ]
    const dayClick = createProduct({
      id: "day",
      duration_type: "day",
      price: 99,
      quantity: 1,
      max_per_order: 5,
    })
    const strategy = getProductStrategy(
      dayClick,
      true,
      CHECKOUT_MODE.PASS_SYSTEM,
    )
    const result = strategy.handleSelection(attendees, "attendee-1", dayClick)

    const day = result[0]?.products.find((p) => p.id === "day")
    expect(day?.quantity).toBe(1)
    expect(day?.selected).toBe(true)
    // Owned week is untouched — adding a day is not a month upgrade.
    expect(result[0]?.products.find((p) => p.id === "w1")?.edit).toBeFalsy()
  })

  // Reported bug: a quantity-based full pass (max_per_order null/>1) reads its
  // selection from quantity, so upgrading credited the week but the tile never
  // showed selected because quantity stayed 0.
  it("upgrading to a quantity-based full pass sets its quantity and credits the week", () => {
    const fullPass = createProduct({
      id: "full",
      duration_type: "full",
      price: 400,
      quantity: 1,
      max_per_order: 5,
    })
    const attendees = [
      createAttendee([
        createProduct({
          id: "full",
          duration_type: "full",
          price: 400,
          quantity: 0,
          max_per_order: 5,
          selected: false,
        }),
        week("w1", { purchased: true, selected: true }),
      ]),
    ]
    const strategy = getProductStrategy(
      fullPass,
      true,
      CHECKOUT_MODE.PASS_SYSTEM,
    )
    const result = strategy.handleSelection(attendees, "attendee-1", fullPass)

    const full = result[0]?.products.find((p) => p.id === "full")
    const w1 = result[0]?.products.find((p) => p.id === "w1")
    expect(full?.selected).toBe(true)
    expect(full?.quantity).toBeGreaterThanOrEqual(1)
    expect(w1?.edit).toBe(true)
    expect(w1?.selected).toBe(false)
  })

  // A Full pass is NOT an auto-upgrade target: completing the week set with
  // only a full available must keep the weeks selected, never promote to full.
  it("completing the week set does not auto-promote to a full pass", () => {
    const scope = ["full", "w1", "w2", "w3", "w4"]
    const attendees = [
      createAttendee([
        createProduct({
          id: "full",
          duration_type: "full",
          price: 400,
          quantity: 0,
          max_per_order: 5,
          selected: false,
        }),
        week("w1", { selected: true }),
        week("w2", { selected: true }),
        week("w3", { selected: true }),
        week("w4", { selected: false }),
      ]),
    ]
    const w4 = week("w4", { selected: false })
    const strategy = getProductStrategy(w4, true, CHECKOUT_MODE.PASS_SYSTEM)
    const result = strategy.handleSelection(
      attendees,
      "attendee-1",
      w4,
      undefined,
      scope,
      scope,
    )

    const products = result[0]?.products
    expect(products?.find((p) => p.id === "full")?.selected).toBeFalsy()
    for (const id of ["w1", "w2", "w3", "w4"]) {
      expect(products?.find((p) => p.id === id)?.selected).toBe(true)
    }
  })
})
