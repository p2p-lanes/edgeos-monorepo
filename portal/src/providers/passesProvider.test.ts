// @vitest-environment node

import { describe, expect, it } from "vitest"
import { CHECKOUT_MODE } from "@/checkout/popupCheckoutPolicy"
import {
  buildBaseAttendeePasses,
  buildPurchasesMap,
} from "@/providers/passesProvider"
import type { ProductWithQuantity } from "@/client"
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

function createPurchasedProduct(
  overrides: Partial<ProductWithQuantity>,
): ProductWithQuantity {
  return {
    tenant_id: overrides.tenant_id ?? "tenant-1",
    popup_id: overrides.popup_id ?? "popup-1",
    name: overrides.name ?? "Product",
    slug: overrides.slug ?? "product",
    price: overrides.price ?? "100",
    is_active: overrides.is_active ?? true,
    id: overrides.id ?? "product-1",
    quantity: overrides.quantity ?? 1,
    ...overrides,
  }
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
          createPurchasedProduct({
            id: "inactive-ticket",
            name: "Inactive Ticket",
            is_active: false,
            quantity: 1,
          }),
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
