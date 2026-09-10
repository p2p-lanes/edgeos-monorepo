import { describe, expect, it, vi } from "vitest"
import {
  buildPaymentProducts,
  MissingTicketBuyerError,
} from "@/hooks/checkout/buildPaymentProducts"
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
const buyer = {
  email: "taylor@example.com",
  firstName: "Taylor",
  lastName: "Buyer",
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
  openTicketBuyer: buyer,
}
const build = (items = [item()]) =>
  buildPaymentProducts({ ...base, dynamicItems: { tickets: items } })

describe("simple-quantity ticket recipient normalization", () => {
  it("fixes the exact unassigned Luxor ticket without using a virtual attendee id", () => {
    const result = build()
    expect(result.products).toEqual([
      {
        product_id: ticket.id,
        recipient_key: `open-ticket:${ticket.id}:0`,
        quantity: 1,
      },
    ])
    expect(result.recipients).toEqual([
      {
        recipient_key: `open-ticket:${ticket.id}:0`,
        name: "Taylor Buyer",
        email: buyer.email,
        category_id: null,
      },
    ])
    expect(build()).toEqual(result)
  })

  it("keeps one distinct draft per unit, even when a ticket appears in two steps", () => {
    const result = buildPaymentProducts({
      ...base,
      dynamicItems: { tickets: [item(ticket, 2)], extras: [item(ticket, 1)] },
    })
    expect(result.products).toHaveLength(3)
    expect(
      new Set(result.products.map((line) => line.recipient_key)).size,
    ).toBe(3)
    expect(result.recipients).toHaveLength(3)
    expect(result.products.every((line) => line.quantity === 1)).toBe(true)
    expect(
      result.recipients.every(
        (recipient) => !recipient.human_id && !recipient.existing_attendee_id,
      ),
    ).toBe(true)
  })

  it("uses the current buyer form and product category rather than stale cart contact data", () => {
    const categorized = { ...ticket, attendee_category_id: "guest-category" }
    const result = buildPaymentProducts({
      ...base,
      openTicketBuyer: {
        email: " new@example.com ",
        firstName: "New",
        lastName: "Buyer",
      },
      dynamicItems: { tickets: [item(categorized)] },
    })
    expect(result.recipients[0]).toMatchObject({
      name: "New Buyer",
      email: "new@example.com",
      category_id: "guest-category",
    })
  })

  it("leaves non-ticket quantities ownerless and does not require buyer data for them", () => {
    const merch = { ...ticket, category: "merch" }
    const result = buildPaymentProducts({
      ...base,
      openTicketBuyer: null,
      dynamicItems: { merch: [item(merch, 3)] },
    })
    expect(result.products).toEqual([{ product_id: ticket.id, quantity: 3 }])
    expect(result.recipients).toEqual([])
  })

  it("blocks ticket normalization without buyer contact data", () => {
    expect(() =>
      buildPaymentProducts({
        ...base,
        openTicketBuyer: null,
        dynamicItems: { tickets: [item()] },
      }),
    ).toThrow(MissingTicketBuyerError)
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
  ])("repairs a %s unassigned cart through the real restore and submit paths", (format) => {
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
