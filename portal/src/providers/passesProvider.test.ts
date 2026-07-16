// @vitest-environment node

import { describe, expect, it } from "vitest"
import { CHECKOUT_MODE } from "@/checkout/popupCheckoutPolicy"
import type { ProductWithQuantity } from "@/client"
import {
  buildBaseAttendeePasses,
  buildPurchasesMap,
  mergeAvailableAndPurchasedProducts,
} from "@/providers/passesProvider"
import type { AttendeePassState } from "@/types/Attendee"
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
