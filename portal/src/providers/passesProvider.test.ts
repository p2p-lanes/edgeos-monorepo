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
      attendee_category: "kid",
      is_active: true,
    })
    const mainProduct = createProduct({
      id: "main-ticket",
      name: "Main Ticket",
      attendee_category: "main",
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
        attendee_category: "main",
        is_active: true,
      }),
      createProduct({
        id: "p-spouse",
        attendee_category: "spouse",
        is_active: true,
      }),
      createProduct({ id: "p-kid", attendee_category: "kid", is_active: true }),
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
      attendee_category: "kid",
      is_active: false,
    })
    const activeProduct = createProduct({
      id: "active-main",
      attendee_category: "main",
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
