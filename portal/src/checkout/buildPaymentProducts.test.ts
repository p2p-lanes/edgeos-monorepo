import { describe, expect, it } from "vitest"
import { CHECKOUT_MODE } from "@/checkout/popupCheckoutPolicy"
import { buildPaymentProducts } from "@/hooks/checkout/buildPaymentProducts"
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
    original_price: overrides.original_price,
    quantity: overrides.quantity,
    original_quantity: overrides.original_quantity,
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
      max_quantity: 5,
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
})
