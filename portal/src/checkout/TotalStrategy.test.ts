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
    original_price: overrides.original_price,
    quantity: overrides.quantity,
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

describe("TotalCalculator", () => {
  it("keeps simple_quantity totals linear when patreon is selected", () => {
    const discount: DiscountProps = {
      discount_type: "percentage",
      discount_value: 0,
    }

    const attendee = createAttendee([
      createProduct({
        id: "ticket",
        category: "ticket",
        duration_type: "week",
        selected: true,
        quantity: 2,
        price: 100,
        original_price: 100,
        max_quantity: 5,
      }),
      createProduct({
        id: "patreon",
        category: "patreon",
        duration_type: "week",
        selected: true,
        quantity: 1,
        price: 25,
        original_price: 25,
      }),
    ])

    const result = new TotalCalculator(CHECKOUT_MODE.SIMPLE_QUANTITY).calculate(
      [attendee],
      discount,
    )

    expect(result.total).toBe(225)
    expect(result.originalTotal).toBe(225)
    expect(result.discountAmount).toBe(0)
  })
})
