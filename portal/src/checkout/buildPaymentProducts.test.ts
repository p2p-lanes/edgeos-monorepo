import { describe, expect, it } from "vitest"
import { CHECKOUT_MODE } from "@/checkout/popupCheckoutPolicy"
import { buildPaymentProducts } from "@/hooks/checkout/buildPaymentProducts"
import type { AttendeePassState } from "@/types/Attendee"
import type { SelectedPatronItem } from "@/types/checkout"
import type { ProductsPass } from "@/types/Products"

function createProduct(overrides: Partial<ProductsPass>): ProductsPass {
  return {
    id: overrides.id ?? "product-1",
    tenant_id: overrides.tenant_id ?? "tenant-1",
    name: overrides.name ?? "Product",
    slug: overrides.slug ?? "product",
    popup_id: overrides.popup_id ?? "popup-1",
    attendee_category_id: overrides.attendee_category_id ?? null,
    category: overrides.category ?? "ticket",
    duration_type: overrides.duration_type ?? "week",
    is_active: overrides.is_active ?? true,
    price: overrides.price ?? 100,
    original_price: overrides.original_price,
    quantity: overrides.quantity,
    original_quantity: overrides.original_quantity,
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

describe("buildPaymentProducts", () => {
  it("keeps simple_quantity payloads linear and disables month upgrades", () => {
    const purchasedWeek = createProduct({
      id: "week-owned",
      duration_type: "week",
      purchased: true,
      quantity: 1,
    })
    const selectedMonth = createProduct({
      id: "month-new",
      duration_type: "month",
      selected: true,
      quantity: 2,
      max_per_order: 5,
    })
    const attendeePasses = [createAttendee([purchasedWeek, selectedMonth])]

    const result = buildPaymentProducts({
      attendeePasses,
      selectedPasses: [
        {
          productId: selectedMonth.id,
          product: selectedMonth,
          attendeeId: "attendee-1",
          attendee: attendeePasses[0],
          quantity: 2,
          price: 200,
        },
      ],
      housing: null,
      merch: [],
      patron: null,
      dynamicItems: {},
      isEditing: false,
      appCredit: 0,
      checkoutMode: CHECKOUT_MODE.SIMPLE_QUANTITY,
    })

    expect(result.isMonthUpgrade).toBe(false)
    expect(result.products).toEqual([
      {
        product_id: "month-new",
        attendee_id: "attendee-1",
        quantity: 2,
      },
    ])
  })

  it("keeps pass_system month upgrades enabled for upgraded attendee passes", () => {
    const purchasedWeek = createProduct({
      id: "week-owned",
      duration_type: "week",
      purchased: true,
      quantity: 1,
    })
    const selectedMonth = createProduct({
      id: "month-new",
      duration_type: "month",
      selected: true,
      quantity: 1,
    })
    const attendeePasses = [createAttendee([purchasedWeek, selectedMonth])]

    const result = buildPaymentProducts({
      attendeePasses,
      selectedPasses: [
        {
          productId: selectedMonth.id,
          product: selectedMonth,
          attendeeId: "attendee-1",
          attendee: attendeePasses[0],
          quantity: 1,
          price: 100,
        },
      ],
      housing: null,
      merch: [],
      patron: null,
      dynamicItems: {},
      isEditing: false,
      appCredit: 0,
      checkoutMode: CHECKOUT_MODE.PASS_SYSTEM,
      editPassesEnabled: true,
    })

    expect(result.isMonthUpgrade).toBe(true)
    expect(result.products).toEqual([
      {
        product_id: "month-new",
        attendee_id: "attendee-1",
        quantity: 1,
      },
    ])
  })

  it("disables month upgrade detection when edit_passes_enabled is false", () => {
    const purchasedWeek = createProduct({
      id: "week-owned",
      duration_type: "week",
      purchased: true,
      quantity: 1,
    })
    const selectedMonth = createProduct({
      id: "month-new",
      duration_type: "month",
      selected: true,
      quantity: 1,
    })
    const attendeePasses = [createAttendee([purchasedWeek, selectedMonth])]

    const result = buildPaymentProducts({
      attendeePasses,
      selectedPasses: [
        {
          productId: selectedMonth.id,
          product: selectedMonth,
          attendeeId: "attendee-1",
          attendee: attendeePasses[0],
          quantity: 1,
          price: 100,
        },
      ],
      housing: null,
      merch: [],
      patron: null,
      dynamicItems: {},
      isEditing: false,
      appCredit: 0,
      checkoutMode: CHECKOUT_MODE.PASS_SYSTEM,
      editPassesEnabled: false,
    })

    expect(result.isMonthUpgrade).toBe(false)
    // Only the newly selected month is sent — no purchased week injected.
    expect(result.products).toEqual([
      {
        product_id: "month-new",
        attendee_id: "attendee-1",
        quantity: 1,
      },
    ])
  })
})

// ---------------------------------------------------------------------------
// Patron path — unit_price_override contract
// ---------------------------------------------------------------------------

function makePatronProduct(id = "patron-prod"): ProductsPass {
  return createProduct({
    id,
    category: "patreon",
    price: 0,
    duration_type: undefined,
  })
}

function makePatronItem(
  overrides?: Partial<SelectedPatronItem>,
): SelectedPatronItem {
  return {
    productId: "patron-prod",
    product: makePatronProduct(),
    amount: 5000,
    isCustomAmount: false,
    ...overrides,
  }
}

describe("buildPaymentProducts — patron path", () => {
  it("emits quantity=1 and unit_price_override=amount for cart.patron", () => {
    const patron = makePatronItem({ amount: 5000 })
    const result = buildPaymentProducts({
      attendeePasses: [],
      selectedPasses: [
        {
          productId: "ticket-1",
          product: createProduct({ id: "ticket-1" }),
          attendeeId: "attendee-1",
          attendee: createAttendee([createProduct({ id: "ticket-1" })]),
          quantity: 1,
          price: 100,
        },
      ],
      housing: null,
      merch: [],
      patron,
      dynamicItems: {},
      isEditing: false,
      appCredit: 0,
    })

    const patronLine = result.products.find(
      (p) => p.product_id === "patron-prod",
    )
    expect(patronLine).toBeDefined()
    expect(patronLine?.quantity).toBe(1)
    expect(patronLine?.unit_price_override).toBe(5000)
  })

  it("patron entry is NOT emitted when cart.patron is null", () => {
    const result = buildPaymentProducts({
      attendeePasses: [],
      selectedPasses: [],
      housing: null,
      merch: [],
      patron: null,
      dynamicItems: {},
      isEditing: false,
      appCredit: 0,
    })

    expect(result.products.some((p) => p.product_id === "patron-prod")).toBe(
      false,
    )
  })

  it("non-patron dynamic items are not affected by patron path", () => {
    const patron = makePatronItem({ amount: 2500 })
    const result = buildPaymentProducts({
      attendeePasses: [],
      selectedPasses: [
        {
          productId: "ticket-1",
          product: createProduct({ id: "ticket-1" }),
          attendeeId: "attendee-1",
          attendee: createAttendee([createProduct({ id: "ticket-1" })]),
          quantity: 1,
          price: 100,
        },
      ],
      housing: null,
      merch: [],
      patron,
      dynamicItems: {
        "merch-step": [
          {
            productId: "merch-1",
            product: createProduct({ id: "merch-1", category: "merch" }),
            quantity: 2,
            price: 50,
            stepType: "merch-step",
          },
        ],
      },
      isEditing: false,
      appCredit: 0,
    })

    const patronLine = result.products.find(
      (p) => p.product_id === "patron-prod",
    )
    const merchLine = result.products.find((p) => p.product_id === "merch-1")

    expect(patronLine?.unit_price_override).toBe(2500)
    expect(patronLine?.quantity).toBe(1)
    expect(merchLine?.quantity).toBe(2)
    // merch line has no unit_price_override
    expect(merchLine?.unit_price_override).toBeUndefined()
  })

  it("patron amount travels as unit_price_override even for custom amounts", () => {
    const patron = makePatronItem({ amount: 7500, isCustomAmount: true })
    const result = buildPaymentProducts({
      attendeePasses: [],
      selectedPasses: [],
      housing: null,
      merch: [],
      patron,
      dynamicItems: {},
      isEditing: false,
      appCredit: 0,
    })

    const patronLine = result.products.find(
      (p) => p.product_id === "patron-prod",
    )
    expect(patronLine?.unit_price_override).toBe(7500)
    expect(patronLine?.quantity).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// X.2: S-PAY-C — pass_system + 2 attendees → no firstAttendeeId collapse
// Tickets flow through selectedPasses (per-attendee). The dynamicItems path
// (firstAttendeeId collapse) must NOT be reached for ticket products on
// pass_system popups.
// ---------------------------------------------------------------------------

describe("X.2 S-PAY-C: pass_system 2 attendees — tickets use per-attendee attendee_id", () => {
  it("each ticket entry carries its own attendeeId, not firstAttendeeId", () => {
    const ticketA = createProduct({ id: "ticket-a", category: "ticket" })
    const ticketB = createProduct({ id: "ticket-b", category: "ticket" })

    const attendeeA = { ...createAttendee([ticketA]), id: "attendee-a" }
    const attendeeB = { ...createAttendee([ticketB]), id: "attendee-b" }

    const result = buildPaymentProducts({
      attendeePasses: [attendeeA, attendeeB],
      selectedPasses: [
        {
          productId: ticketA.id,
          product: ticketA,
          attendeeId: "attendee-a",
          attendee: attendeeA,
          quantity: 1,
          price: 100,
        },
        {
          productId: ticketB.id,
          product: ticketB,
          attendeeId: "attendee-b",
          attendee: attendeeB,
          quantity: 1,
          price: 100,
        },
      ],
      housing: null,
      merch: [],
      patron: null,
      dynamicItems: {},
      isEditing: false,
      appCredit: 0,
      checkoutMode: CHECKOUT_MODE.PASS_SYSTEM,
    })

    const ticketALine = result.products.find((p) => p.product_id === "ticket-a")
    const ticketBLine = result.products.find((p) => p.product_id === "ticket-b")

    expect(ticketALine?.attendee_id).toBe("attendee-a")
    expect(ticketBLine?.attendee_id).toBe("attendee-b")

    // Neither ticket should collapse to the other attendee's id
    expect(ticketALine?.attendee_id).not.toBe("attendee-b")
    expect(ticketBLine?.attendee_id).not.toBe("attendee-a")
  })
})

// ---------------------------------------------------------------------------
// X.3: S-PAY-A/B — merch and meal-plan entries unchanged by this change
// ---------------------------------------------------------------------------

describe("X.3 S-PAY-A/B: merch and meal-plan entries unaffected", () => {
  it("S-PAY-A: merch item gets firstAttendeeId (unaffected by ticket changes)", () => {
    const ticket = createProduct({ id: "ticket-1", category: "ticket" })
    const attendeeA = { ...createAttendee([ticket]), id: "attendee-a" }

    const result = buildPaymentProducts({
      attendeePasses: [attendeeA],
      selectedPasses: [
        {
          productId: ticket.id,
          product: ticket,
          attendeeId: "attendee-a",
          attendee: attendeeA,
          quantity: 1,
          price: 100,
        },
      ],
      housing: null,
      merch: [
        {
          productId: "merch-1",
          product: createProduct({ id: "merch-1", category: "merch" }),
          quantity: 2,
          unitPrice: 30,
          totalPrice: 60,
        },
      ],
      patron: null,
      dynamicItems: {},
      isEditing: false,
      appCredit: 0,
      checkoutMode: CHECKOUT_MODE.PASS_SYSTEM,
    })

    const ticketLine = result.products.find((p) => p.product_id === "ticket-1")
    const merchLine = result.products.find((p) => p.product_id === "merch-1")

    // Ticket carries correct attendeeId
    expect(ticketLine?.attendee_id).toBe("attendee-a")

    // Merch attaches to firstAttendeeId (driven by selectedPasses[0].attendeeId)
    expect(merchLine?.attendee_id).toBe("attendee-a")
    expect(merchLine?.quantity).toBe(2)
  })

  it("S-PAY-B: meal plan entries carry their own attendeeId (per-purchase metadata preserved)", () => {
    const attendeeB = { ...createAttendee([]), id: "attendee-b" }

    const result = buildPaymentProducts({
      attendeePasses: [attendeeB],
      selectedPasses: [],
      housing: null,
      merch: [],
      patron: null,
      selectedMealPlans: [
        {
          productId: "meal-weekly-1",
          product: createProduct({ id: "meal-weekly-1", category: "meal" }),
          attendeeId: "attendee-b",
          dailyChoices: { mon: "vegan" },
          dietaryRestriction: "vegan",
          specialRequest: null,
        },
      ],
      dynamicItems: {},
      isEditing: false,
      appCredit: 0,
      checkoutMode: CHECKOUT_MODE.PASS_SYSTEM,
    })

    const mealLine = result.products.find(
      (p) => p.product_id === "meal-weekly-1",
    )

    expect(mealLine?.attendee_id).toBe("attendee-b")
    expect(mealLine?.quantity).toBe(1)
    expect(mealLine?.purchase_metadata).toEqual({
      daily_choices: { mon: "vegan" },
      dietary_restriction: "vegan",
      special_request: null,
    })
  })
})
