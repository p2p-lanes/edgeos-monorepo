// @vitest-environment node

import { describe, expect, it } from "vitest"
import { CHECKOUT_MODE } from "@/checkout/popupCheckoutPolicy"
import type { ProductWithQuantity } from "@/client"
import {
  applyCartSelections,
  buildBaseAttendeePasses,
  buildPurchasesMap,
  mergeAvailableAndPurchasedProducts,
  projectRecipientDraft,
  rebuildRecipientPasses,
  restoreRecipientDrafts,
} from "@/providers/passesProvider"
import type { AttendeePassState } from "@/types/Attendee"
import type { CheckoutRecipientPassState } from "@/types/checkout"
import type { ProductsPass } from "@/types/Products"

// ---------------------------------------------------------------------------
// Helper that correctly propagates null (createProduct uses ?? which replaces null)
// ---------------------------------------------------------------------------
function makePassProduct(
  overrides: Partial<ProductsPass> & { duration_type: string },
): ProductsPass {
  return {
    id: overrides.id ?? "pass-1",
    tenant_id: "tenant-1",
    name: overrides.name ?? "Pass",
    slug: overrides.slug ?? "pass",
    popup_id: "popup-1",
    attendee_category_id: null,
    category: "ticket",
    is_active: overrides.is_active ?? true,
    price: overrides.price ?? 100,
    compare_price: null,
    // Explicitly keep null when provided (createProduct helper replaces null via ??)
    max_per_order:
      "max_per_order" in overrides ? (overrides.max_per_order ?? null) : 1,
    ...overrides,
  } as ProductsPass
}

// ---------------------------------------------------------------------------
// RED: full-pass quantity bug fix
// A FULL pass (max_per_order=null) must initialize with quantity=1, not 0.
// The bug: isMultiUnit used supportsQuantitySelector(null)=true for full passes,
// causing initialQuantity=0, which made editCredit = price * 0 = 0.
// ---------------------------------------------------------------------------
describe("buildBaseAttendeePasses — full/month pass quantity initialization", () => {
  it("initializes a FULL pass (max_per_order null) with quantity=1, not 0", () => {
    const fullPass = makePassProduct({
      id: "full-pass",
      duration_type: "full",
      price: 299,
      max_per_order: null,
    })
    const attendees = [
      { id: "attendee-1", category: "main" },
    ] as AttendeePassState[]

    const result = buildBaseAttendeePasses(
      attendees,
      [fullPass],
      0,
      new Map(),
      CHECKOUT_MODE.PASS_SYSTEM,
    )

    const product = result[0]?.products.find((p) => p.id === "full-pass")
    expect(product?.quantity).toBe(1)
  })

  it("initializes a MONTH pass (max_per_order null) with quantity=1, not 0", () => {
    const monthPass = makePassProduct({
      id: "month-pass",
      duration_type: "month",
      price: 199,
      max_per_order: null,
    })
    const attendees = [
      { id: "attendee-1", category: "main" },
    ] as AttendeePassState[]

    const result = buildBaseAttendeePasses(
      attendees,
      [monthPass],
      0,
      new Map(),
      CHECKOUT_MODE.PASS_SYSTEM,
    )

    const product = result[0]?.products.find((p) => p.id === "month-pass")
    expect(product?.quantity).toBe(1)
  })

  it("still initializes a genuinely multi-unit WEEK pass (max_per_order null) with quantity=0", () => {
    const weekPass = makePassProduct({
      id: "week-pass",
      duration_type: "week",
      price: 150,
      max_per_order: null,
    })
    const attendees = [
      { id: "attendee-1", category: "main" },
    ] as AttendeePassState[]

    const result = buildBaseAttendeePasses(
      attendees,
      [weekPass],
      0,
      new Map(),
      CHECKOUT_MODE.PASS_SYSTEM,
    )

    const product = result[0]?.products.find((p) => p.id === "week-pass")
    expect(product?.quantity).toBe(0)
  })

  it("still initializes a WEEK pass (max_per_order 3) with quantity=0", () => {
    const weekPass = makePassProduct({
      id: "week-pass-3",
      duration_type: "week",
      price: 150,
      max_per_order: 3,
    })
    const attendees = [
      { id: "attendee-1", category: "main" },
    ] as AttendeePassState[]

    const result = buildBaseAttendeePasses(
      attendees,
      [weekPass],
      0,
      new Map(),
      CHECKOUT_MODE.PASS_SYSTEM,
    )

    const product = result[0]?.products.find((p) => p.id === "week-pass-3")
    expect(product?.quantity).toBe(0)
  })

  it("purchased FULL pass gets quantity=1 so editCredit = price * quantity = price", () => {
    const fullPass = makePassProduct({
      id: "full-pass-purchased",
      duration_type: "full",
      price: 299,
      max_per_order: null,
    })
    const attendees = [
      { id: "attendee-1", category: "main" },
    ] as AttendeePassState[]

    const purchasesMap = buildPurchasesMap([
      {
        attendee_id: "attendee-1",
        attendee_name: "Test",
        attendee_category: "main",
        products: [
          {
            ...fullPass,
            quantity: 1,
          } as unknown as ProductWithQuantity,
        ],
      },
    ])

    const result = buildBaseAttendeePasses(
      attendees,
      [fullPass],
      0,
      purchasesMap,
      CHECKOUT_MODE.PASS_SYSTEM,
    )

    const product = result[0]?.products.find(
      (p) => p.id === "full-pass-purchased",
    )
    // quantity=1 ensures editCredit = price * quantity = 299 (not 0)
    expect(product?.quantity).toBe(1)
    expect(product?.purchased).toBe(true)
  })
})

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
    quantity: overrides.quantity,
    purchased: overrides.purchased,
    max_per_order: overrides.max_per_order ?? 1,
    compare_price: overrides.compare_price ?? null,
  } as ProductsPass
}

describe("buildBaseAttendeePasses", () => {
  it("projects a purchase keyed by the persisted attendee ID as purchased", () => {
    const attendee = {
      id: "attendee-1",
      human_id: "human-1",
      category: "main",
    } as AttendeePassState
    const product = createProduct({ id: "direct-ticket" })
    const purchasesMap = buildPurchasesMap([
      {
        attendee_id: "attendee-1",
        attendee_name: "Direct Buyer",
        attendee_category: "main",
        products: [
          {
            ...product,
            quantity: 1,
          } as unknown as ProductWithQuantity,
        ],
      },
    ])

    const result = buildBaseAttendeePasses(
      [attendee],
      [product],
      0,
      purchasesMap,
      CHECKOUT_MODE.SIMPLE_QUANTITY,
    )

    expect(result[0]?.id).toBe("attendee-1")
    expect(result[0]?.products[0]).toMatchObject({
      id: "direct-ticket",
      attendee_id: "attendee-1",
      purchased: true,
    })
  })

  it("keeps purchased inactive products in the attendee passes state", () => {
    const attendees = [
      { id: "attendee-1", category: "main" },
    ] as AttendeePassState[]
    const activeCatalogProducts = [
      createProduct({ id: "active-ticket", name: "Active Ticket" }),
    ]
    const purchasesMap = buildPurchasesMap([
      {
        attendee_id: "attendee-1",
        attendee_name: "Main Attendee",
        attendee_category: "main",
        products: [
          createProduct({
            id: "inactive-ticket",
            name: "Inactive Ticket",
            is_active: false,
            quantity: 1,
          }) as unknown as ProductWithQuantity,
        ],
      },
    ])

    const result = buildBaseAttendeePasses(
      attendees,
      activeCatalogProducts,
      0,
      purchasesMap,
      CHECKOUT_MODE.PASS_SYSTEM,
    )

    expect(result[0]?.products.map((product) => product.id)).toContain(
      "inactive-ticket",
    )
    expect(
      result[0]?.products.find((product) => product.id === "inactive-ticket")
        ?.purchased,
    ).toBe(true)
    expect(
      result[0]?.products.find((product) => product.id === "inactive-ticket")
        ?.is_active,
    ).toBe(false)
  })
})

describe("recipient draft restoration", () => {
  const companionDraft = {
    recipient_key: "draft:11111111-1111-4111-8111-111111111111",
    name: "Sam Companion",
    email: "sam@example.com",
    category_id: "category-spouse",
    profile_snapshot: {
      category: "spouse",
      gender: "nonbinary",
      residence: "Lisbon",
    },
  }

  it("projects a local companion draft onto the current products", () => {
    const projected = projectRecipientDraft(
      [],
      companionDraft,
      "popup-1",
      [createProduct({ id: "spouse-pass" })],
      0,
      new Map(),
      CHECKOUT_MODE.PASS_SYSTEM,
    )

    expect(projected).toEqual([
      expect.objectContaining({
        id: "recipient:draft:11111111-1111-4111-8111-111111111111",
        popup_id: "popup-1",
        category_id: "category-spouse",
        category: "spouse",
        name: "Sam Companion",
        email: "sam@example.com",
        gender: "nonbinary",
        additional_data: companionDraft.profile_snapshot,
        recipient: companionDraft,
        products: [expect.objectContaining({ id: "spouse-pass" })],
      }),
    ])
  })

  it("preserves a local draft through structural rebuilds and dedupes a restored snapshot", () => {
    const firstProduct = createProduct({ id: "spouse-pass" })
    const current = projectRecipientDraft(
      [],
      companionDraft,
      "popup-1",
      [firstProduct],
      0,
      new Map(),
      CHECKOUT_MODE.PASS_SYSTEM,
    )
    current[0].products[0].selected = true

    const rebuilt = rebuildRecipientPasses(
      [],
      [companionDraft],
      [
        {
          recipient_key: companionDraft.recipient_key,
          product_id: firstProduct.id,
          quantity: 1,
        },
      ],
      "popup-1",
      [firstProduct, createProduct({ id: "meal-pass" })],
      10,
      new Map(),
      CHECKOUT_MODE.PASS_SYSTEM,
      current,
    )

    expect(rebuilt).toHaveLength(1)
    expect(rebuilt[0].recipient).toBe(companionDraft)
    expect(rebuilt[0].products).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "spouse-pass", selected: true }),
        expect.objectContaining({ id: "meal-pass", selected: false }),
      ]),
    )
  })

  it("restores accountless spouse and kid drafts without persisted Attendees", () => {
    const recipients = [
      {
        recipient_key: "managed-spouse",
        existing_attendee_id: "reusable-spouse-attendee",
        name: "Sam Spouse",
        email: "sam@example.com",
        category_id: "category-spouse",
        profile_snapshot: { category: "spouse", residence: "Lisbon" },
      },
      {
        recipient_key: "managed-kid",
        name: "Taylor Kid",
        category_id: "category-kid",
        profile_snapshot: { category: "kid", age_group: "under_12" },
      },
    ]

    const restored = restoreRecipientDrafts([], recipients, "popup-1")

    expect(restored).toEqual([
      expect.objectContaining({
        id: "recipient:managed-spouse",
        popup_id: "popup-1",
        category: "spouse",
        additional_data: { category: "spouse", residence: "Lisbon" },
        recipient: recipients[0],
      }),
      expect.objectContaining({
        id: "recipient:managed-kid",
        category: "kid",
        recipient: recipients[1],
      }),
    ])
  })

  it("reattaches linked Human drafts and restores recipient and legacy selections", () => {
    const buyer = {
      id: "buyer-attendee",
      human_id: "human-buyer",
      name: "Alex Buyer",
      category: "main",
      products: [
        createProduct({ id: "recipient-ticket", quantity: 1 }),
        createProduct({ id: "legacy-ticket", quantity: 1 }),
      ],
    } as CheckoutRecipientPassState
    const recipient = {
      recipient_key: "human:human-buyer",
      human_id: "human-buyer",
      name: "Alex Buyer",
      profile_snapshot: { category: "main" },
    }

    const restored = restoreRecipientDrafts([buyer], [recipient], "popup-1")
    const [selected] = applyCartSelections(restored, [
      {
        recipient_key: "human:human-buyer",
        product_id: "recipient-ticket",
        quantity: 1,
      },
      {
        attendee_id: "buyer-attendee",
        product_id: "legacy-ticket",
        quantity: 1,
      },
    ])

    expect(restored[0].recipient).toEqual(recipient)
    expect(selected.products).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "recipient-ticket", selected: true }),
        expect.objectContaining({ id: "legacy-ticket", selected: true }),
      ]),
    )
  })
})

// RED: ticket-as-first-class-entity Phase 7.2
// The attendee_category filter MUST be removed from mergeAvailableAndPurchasedProducts.
// A product with attendee_category="kid" should be visible for an attendee with category="main".
describe("mergeAvailableAndPurchasedProducts — attendee_category filter removal", () => {
  it("includes active products regardless of attendee_category mismatch", () => {
    const kidProduct = createProduct({
      id: "kid-ticket",
      name: "Kid Ticket",
      attendee_category_id: "cat-kid",
      is_active: true,
    })
    const mainProduct = createProduct({
      id: "main-ticket",
      name: "Main Ticket",
      attendee_category_id: null,
      is_active: true,
    })

    // Attendee is "main" — without the filter, BOTH products should appear
    const result = mergeAvailableAndPurchasedProducts(
      "main",
      [kidProduct, mainProduct],
      [],
    )

    expect(result.map((p) => p.id)).toContain("kid-ticket")
    expect(result.map((p) => p.id)).toContain("main-ticket")
  })

  it("includes active products for all attendee categories when filter is removed", () => {
    const products = [
      createProduct({
        id: "p-main",
        attendee_category_id: null,
        is_active: true,
      }),
      createProduct({
        id: "p-spouse",
        attendee_category_id: "cat-spouse",
        is_active: true,
      }),
      createProduct({
        id: "p-kid",
        attendee_category_id: "cat-kid",
        is_active: true,
      }),
    ]

    // Any category should see all 3 active products
    for (const category of ["main", "spouse", "kid"] as const) {
      const result = mergeAvailableAndPurchasedProducts(category, products, [])
      expect(result).toHaveLength(3)
    }
  })

  it("still excludes inactive products from the active catalog", () => {
    const inactiveProduct = createProduct({
      id: "inactive-kid",
      attendee_category_id: "cat-kid",
      is_active: false,
    })
    const activeProduct = createProduct({
      id: "active-main",
      attendee_category_id: null,
      is_active: true,
    })

    const result = mergeAvailableAndPurchasedProducts(
      "main",
      [inactiveProduct, activeProduct],
      [],
    )

    expect(result.map((p) => p.id)).not.toContain("inactive-kid")
    expect(result.map((p) => p.id)).toContain("active-main")
  })
})
