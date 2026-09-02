import { describe, expect, it } from "vitest"
import { CHECKOUT_MODE } from "@/checkout/popupCheckoutPolicy"
import { buildPaymentProducts } from "@/hooks/checkout/buildPaymentProducts"
import type { AttendeePassState } from "@/types/Attendee"
import type {
  CheckoutRecipientDraft,
  SelectedPassItem,
  SelectedPatronItem,
} from "@/types/checkout"
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

function buildProducts(
  overrides: Partial<Parameters<typeof buildPaymentProducts>[0]>,
) {
  return buildPaymentProducts({
    attendeePasses: [],
    selectedPasses: [],
    housing: null,
    merch: [],
    patron: null,
    dynamicItems: {},
    isEditing: false,
    appCredit: 0,
    ...overrides,
  })
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

describe("buildPaymentProducts recipient payloads", () => {
  const linkedRecipient = {
    recipient_key: "human:human-1",
    human_id: "human-1",
    name: "Linked Human",
    email: "linked@example.com",
    category_id: "category-main",
    profile_snapshot: { residence: "Lisbon" },
  } satisfies CheckoutRecipientDraft

  const managedRecipient = {
    recipient_key: "managed-spouse",
    existing_attendee_id: "spouse-attendee",
    name: "Managed Spouse",
    email: null,
    category_id: "category-spouse",
    profile_snapshot: { category: "spouse", dietary_notes: "vegetarian" },
  } satisfies CheckoutRecipientDraft

  function recipientPass(
    productId: string,
    attendeeId: string,
    recipient: CheckoutRecipientDraft,
    productOverrides: Partial<ProductsPass> = {},
  ): SelectedPassItem {
    const product = createProduct({ id: productId, ...productOverrides })
    const attendee = { ...createAttendee([product]), id: attendeeId, recipient }
    return {
      productId,
      product,
      attendeeId,
      attendee,
      recipient,
      quantity: 1,
      price: 100,
    }
  }

  it("emits linked and managed pass lines with recipient identity only", () => {
    const linkedPass = recipientPass(
      "linked-ticket",
      "linked-attendee",
      linkedRecipient,
    )
    const managedPass = recipientPass(
      "managed-ticket",
      "recipient:managed-spouse",
      managedRecipient,
    )

    const result = buildPaymentProducts({
      attendeePasses: [linkedPass.attendee, managedPass.attendee],
      selectedPasses: [linkedPass, managedPass],
      housing: null,
      merch: [],
      patron: null,
      dynamicItems: {},
      isEditing: false,
      appCredit: 0,
    })

    expect(result.products).toEqual([
      {
        product_id: "linked-ticket",
        recipient_key: "human:human-1",
        quantity: 1,
      },
      {
        product_id: "managed-ticket",
        recipient_key: "managed-spouse",
        quantity: 1,
      },
    ])
    expect(result.recipients).toEqual([linkedRecipient, managedRecipient])
  })

  it("deduplicates restored recipients and excludes unreferenced drafts", () => {
    const first = recipientPass(
      "spouse-week",
      "recipient:managed-spouse",
      managedRecipient,
    )
    const second = recipientPass(
      "spouse-day",
      "recipient:managed-spouse",
      managedRecipient,
    )
    const unreferenced = {
      ...createAttendee([]),
      id: "recipient:managed-kid",
      recipient: {
        recipient_key: "managed-kid",
        name: "Managed Kid",
        profile_snapshot: { category: "kid" },
      },
    }

    const result = buildPaymentProducts({
      attendeePasses: [first.attendee, second.attendee, unreferenced],
      selectedPasses: [first, second],
      housing: null,
      merch: [],
      patron: null,
      dynamicItems: {},
      isEditing: false,
      appCredit: 0,
    })

    expect(result.products.map((line) => line.recipient_key)).toEqual([
      "managed-spouse",
      "managed-spouse",
    ])
    expect(result.recipients).toEqual([managedRecipient])
  })

  it("keeps legacy attendee-linked pass lines during rollout", () => {
    const product = createProduct({ id: "legacy-ticket" })
    const attendee = { ...createAttendee([product]), id: "legacy-attendee" }

    const result = buildPaymentProducts({
      attendeePasses: [attendee],
      selectedPasses: [
        {
          productId: product.id,
          product,
          attendeeId: attendee.id,
          attendee,
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
    })

    expect(result.products).toEqual([
      {
        product_id: "legacy-ticket",
        attendee_id: "legacy-attendee",
        quantity: 1,
      },
    ])
    expect(result.recipients).toEqual([])
  })

  it("routes selected passes by recipient lineage rather than product fields", () => {
    const access = recipientPass(
      "access-ticket",
      "recipient:linked",
      linkedRecipient,
    )
    const participant = recipientPass(
      "participant-ticket",
      "recipient:managed-spouse",
      managedRecipient,
    )
    const participantFromAttendee = { ...participant, recipient: undefined }
    const orderRecipient = {
      ...managedRecipient,
      recipient_key: "order-recipient",
    }
    const order = recipientPass(
      "order-product",
      "recipient:order",
      orderRecipient,
    )

    const result = buildProducts({
      attendeePasses: [access.attendee, participant.attendee, order.attendee],
      selectedPasses: [access, participantFromAttendee, order],
    })

    expect(
      result.products.map(
        ({ product_id, attendee_id, recipient_key }) =>
          [product_id, attendee_id, recipient_key] as const,
      ),
    ).toEqual([
      ["access-ticket", undefined, "human:human-1"],
      ["participant-ticket", undefined, "managed-spouse"],
      ["order-product", undefined, "order-recipient"],
    ])
    expect(result.recipients).toEqual([
      linkedRecipient,
      managedRecipient,
      orderRecipient,
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
    const result = buildProducts({
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
// X.2: S-PAY-C — pass_system + 2 attendees preserve line identity.
// ---------------------------------------------------------------------------

describe("X.2 S-PAY-C: pass_system 2 attendees — tickets use per-attendee attendee_id", () => {
  it("each ticket entry carries its own attendeeId", () => {
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

  it("prefers attendee-scoped passes over duplicate legacy dynamic items", () => {
    const spouseTicket = createProduct({
      id: "spouse-ticket",
      category: "ticket",
    })
    const kidTicket = createProduct({ id: "kid-ticket", category: "ticket" })
    const main = { ...createAttendee([]), id: "main" }
    const spouse = { ...createAttendee([spouseTicket]), id: "spouse" }
    const kid = { ...createAttendee([kidTicket]), id: "kid" }

    const result = buildPaymentProducts({
      attendeePasses: [main, spouse, kid],
      selectedPasses: [
        {
          productId: spouseTicket.id,
          product: spouseTicket,
          attendeeId: spouse.id,
          attendee: spouse,
          quantity: 1,
          price: 100,
        },
        {
          productId: kidTicket.id,
          product: kidTicket,
          attendeeId: kid.id,
          attendee: kid,
          quantity: 1,
          price: 100,
        },
      ],
      housing: null,
      merch: [],
      patron: null,
      dynamicItems: {
        tickets: [
          {
            productId: spouseTicket.id,
            product: spouseTicket,
            quantity: 1,
            price: 100,
            stepType: "tickets",
          },
          {
            productId: kidTicket.id,
            product: kidTicket,
            quantity: 1,
            price: 100,
            stepType: "tickets",
          },
        ],
      },
      isEditing: false,
      appCredit: 0,
      checkoutMode: CHECKOUT_MODE.PASS_SYSTEM,
    })

    expect(result.products).toEqual([
      {
        product_id: "spouse-ticket",
        attendee_id: "spouse",
        quantity: 1,
      },
      {
        product_id: "kid-ticket",
        attendee_id: "kid",
        quantity: 1,
      },
    ])
  })
})

// ---------------------------------------------------------------------------
// X.3: order-owned side products and recipient-owned meals
// ---------------------------------------------------------------------------

describe("X.3 S-PAY-A/B: side products and meal plans", () => {
  it("emits merch without borrowing the selected attendee identity", () => {
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

    expect(ticketLine?.attendee_id).toBe("attendee-a")
    expect(merchLine).toEqual({ product_id: "merch-1", quantity: 2 })
  })

  it("emits side-only merch, housing, patron, and dynamic lines without identity", () => {
    const result = buildProducts({
      housing: {
        productId: "housing-1",
        product: createProduct({ id: "housing-1" }),
        checkIn: "2026-09-01",
        checkOut: "2026-09-04",
        nights: 3,
        pricePerNight: 100,
        totalPrice: 600,
        pricePerDay: true,
        quantity: 2,
      },
      merch: [
        {
          productId: "merch-1",
          product: createProduct({ id: "merch-1" }),
          quantity: 2,
          unitPrice: 30,
          totalPrice: 60,
        },
      ],
      patron: makePatronItem({ amount: 2500 }),
      dynamicItems: {
        extras: [
          {
            productId: "dynamic-1",
            product: createProduct({ id: "dynamic-1" }),
            quantity: 4,
            price: 20,
            stepType: "extras",
          },
        ],
      },
    })

    expect(result.products).toEqual([
      { product_id: "merch-1", quantity: 2 },
      { product_id: "housing-1", quantity: 6 },
      {
        product_id: "patron-prod",
        quantity: 1,
        unit_price_override: 2500,
      },
      { product_id: "dynamic-1", quantity: 4 },
    ])
    expect(result.recipients).toEqual([])
  })

  it("preserves legacy meal attendee identity and purchase metadata", () => {
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

  it("routes restored meal plans to their embedded recipient", () => {
    const recipient = {
      recipient_key: "managed-meal-recipient",
      name: "Meal Recipient",
      profile_snapshot: { dietary_notes: "vegan" },
    } satisfies CheckoutRecipientDraft
    const attendee = {
      ...createAttendee([]),
      id: "recipient:managed-meal-recipient",
      recipient,
    }

    const result = buildProducts({
      attendeePasses: [attendee],
      selectedMealPlans: [
        {
          productId: "recipient-meal",
          product: createProduct({
            id: "recipient-meal",
            category: "meal_plan",
          }),
          attendeeId: attendee.id,
          dailyChoices: { mon: "vegan" },
          dietaryRestriction: "vegan",
          specialRequest: null,
        },
      ],
    })

    expect(result.products[0]?.recipient_key).toBe("managed-meal-recipient")
    expect(result.products[0]?.purchase_metadata).toMatchObject({
      dietary_restriction: "vegan",
    })
    expect(result.recipients).toEqual([recipient])
  })
})
