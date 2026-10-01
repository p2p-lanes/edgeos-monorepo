import { describe, expect, it, vi } from "vitest"
import { buildPaymentProducts } from "@/hooks/checkout/buildPaymentProducts"
import { buildPersistedCartState } from "@/hooks/checkout/useCartPersistence"
import {
  hydrateFromSnapshot,
  normalizeCartItemsSnapshot,
} from "@/hooks/checkout/useOpenCartPersistence"
import type { AttendeePassState } from "@/types/Attendee"
import type { SelectedDynamicItem } from "@/types/checkout"
import type { ProductsPass } from "@/types/Products"

const ticket: ProductsPass = {
  id: "7455c9f7-b798-4556-a878-1f96fb19a638",
  tenant_id: "tenant",
  popup_id: "popup",
  name: "The Luxor Eclipse Gathering",
  slug: "luxor",
  price: 999,
  category: "ticket",
  is_active: true,
}
const item = (product = ticket, quantity = 1): SelectedDynamicItem => ({
  productId: product.id,
  product,
  quantity,
  price: product.price * quantity,
  stepType: "tickets",
})
const base = {
  attendeePasses: [],
  selectedPasses: [],
  housing: null,
  merch: [],
  patron: null,
  isEditing: false,
  appCredit: 0,
  submitMode: "open-ticketing" as const,
  checkoutMode: "simple_quantity" as const,
}
const build = (items = [item()]) =>
  buildPaymentProducts({ ...base, dynamicItems: { tickets: items } })

describe("simple-quantity buyer-owned tickets", () => {
  it("leaves ticket holder resolution to the backend without inventing a person", () => {
    const result = build()
    expect(result.products).toEqual([
      {
        product_id: ticket.id,
        quantity: 1,
      },
    ])
    expect(result.recipients).toEqual([])
    expect(build()).toEqual(result)
  })

  it("preserves quantities across steps without creating recipient drafts", () => {
    const result = buildPaymentProducts({
      ...base,
      dynamicItems: { tickets: [item(ticket, 2)], extras: [item(ticket, 1)] },
    })
    expect(result.products).toEqual([
      { product_id: ticket.id, quantity: 2 },
      { product_id: ticket.id, quantity: 1 },
    ])
    expect(result.recipients).toEqual([])
  })

  it("does not infer recipient roles from the product's legacy category", () => {
    const categorized = { ...ticket, attendee_category_id: "guest-category" }
    const result = buildPaymentProducts({
      ...base,
      dynamicItems: { tickets: [item(categorized)] },
    })
    expect(result.products).toEqual([{ product_id: ticket.id, quantity: 1 }])
    expect(result.recipients).toEqual([])
  })

  it("preserves non-ticket quantities without assigning recipients", () => {
    const merch = { ...ticket, category: "merch" }
    const result = buildPaymentProducts({
      ...base,
      dynamicItems: { merch: [item(merch, 3)] },
    })
    expect(result.products).toEqual([{ product_id: ticket.id, quantity: 3 }])
    expect(result.recipients).toEqual([])
  })

  it("does not replace an explicitly selected guest with the buyer", () => {
    const recipient = {
      recipient_key: "guest-1",
      name: "Actual Guest",
      email: "guest@example.com",
    }
    const attendee = {
      id: "recipient:guest-1",
      tenant_id: "tenant",
      popup_id: "popup",
      human_id: null,
      application_id: null,
      category: "main",
      email: "guest@example.com",
      gender: null,
      poap_url: null,
      name: "Actual Guest",
      products: [],
    } satisfies AttendeePassState
    const result = buildPaymentProducts({
      ...base,
      attendeePasses: [attendee],
      selectedPasses: [
        {
          productId: ticket.id,
          product: ticket,
          attendeeId: "recipient:guest-1",
          attendee,
          recipient,
          quantity: 1,
          price: 999,
        },
      ],
      dynamicItems: { tickets: [item()] },
    })
    expect(result.products).toEqual([
      { product_id: ticket.id, recipient_key: "guest-1", quantity: 1 },
    ])
    expect(result.recipients).toEqual([recipient])
  })

  it.each([
    "canonical",
    "legacy",
  ])("preserves a %s quantity cart through the real restore and submit paths", (format) => {
    const state = {
      selectedPasses: [],
      housing: null,
      accommodations: [],
      merch: [],
      patron: null,
      selectedMealPlans: [],
      dynamicItems: { tickets: [item(ticket, 2)] },
      promoCode: "",
      promoCodeValid: false,
      insurance: false,
      currentStep: "passes" as const,
    }
    const saved =
      format === "canonical"
        ? buildPersistedCartState(state)
        : {
            dynamic_items: [
              {
                product_id: ticket.id,
                quantity: 2,
                step_type: "tickets",
                price: 1998,
              },
            ],
          }
    const snapshot = normalizeCartItemsSnapshot(saved)!
    const setDynamicItems = vi.fn()
    hydrateFromSnapshot(
      snapshot.items,
      [ticket],
      false,
      {
        setHousing: vi.fn(),
        setAccommodations: vi.fn(),
        setMerch: vi.fn(),
        setPatron: vi.fn(),
        setMealPlans: vi.fn(),
        setInsurance: vi.fn(),
        setDynamicItems,
        setPromoCode: vi.fn(),
        restorePassRecipients: vi.fn(),
      },
      "simple_quantity",
    )
    expect(setDynamicItems).toHaveBeenCalledOnce()
    const restored = buildPaymentProducts({
      ...base,
      dynamicItems: setDynamicItems.mock.calls[0][0],
    })
    expect(restored).toEqual(build([item(ticket, 2)]))
  })
})
