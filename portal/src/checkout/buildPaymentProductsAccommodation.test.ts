/**
 * What a booked room looks like on the wire.
 *
 * The backend re-quotes every stay from the dates in `purchase_metadata` and
 * charges that, so the only things that must be exactly right here are the
 * ones it cannot recompute: which room, which nights, who is staying, and the
 * shadow product the line points at. A line that names the wrong product is
 * rejected outright, and that check is what stops booking metadata from being
 * attached to a cheap ticket.
 */
import { describe, expect, it } from "vitest"
import { CHECKOUT_MODE } from "@/checkout/popupCheckoutPolicy"
import { buildPaymentProducts } from "@/hooks/checkout/buildPaymentProducts"
import type { AttendeePassState } from "@/types/Attendee"
import type { SelectedAccommodationItem } from "@/types/checkout"

const attendee: AttendeePassState = {
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
  products: [],
}

function booking(
  overrides: Partial<SelectedAccommodationItem> = {},
): SelectedAccommodationItem {
  return {
    accommodationId: "room-1",
    productId: "shadow-product-1",
    name: "Double Room",
    propertyId: "prop-1",
    propertyName: "Hotel Arcadia",
    checkIn: "2026-06-01",
    checkOut: "2026-06-08",
    nights: 7,
    guestCount: 2,
    guests: ["Ada", "Grace"],
    subtotal: 840,
    tax: 84,
    totalPrice: 924,
    ...overrides,
  }
}

function build(accommodations: SelectedAccommodationItem[]) {
  return buildPaymentProducts({
    attendeePasses: [attendee],
    selectedPasses: [],
    housing: null,
    accommodations,
    merch: [],
    patron: null,
    dynamicItems: {},
    isEditing: false,
    appCredit: 0,
    checkoutMode: CHECKOUT_MODE.SIMPLE_QUANTITY,
  })
}

describe("buildPaymentProducts: accommodations", () => {
  it("sends one line per room, pointing at its shadow product", () => {
    const { products } = build([booking()])

    expect(products).toHaveLength(1)
    expect(products[0].product_id).toBe("shadow-product-1")
    expect(products[0].quantity).toBe(1)
  })

  it("carries the stay in purchase_metadata under the booking kind", () => {
    // `kind` is the only discriminator the backend has: the product itself is
    // an ordinary row, so nothing else marks this line as a booking.
    const { products } = build([booking()])
    const metadata = products[0].purchase_metadata as Record<string, unknown>

    expect(metadata.kind).toBe("accommodation_booking")
    expect(metadata.accommodation_id).toBe("room-1")
    expect(metadata.check_in).toBe("2026-06-01")
    expect(metadata.check_out).toBe("2026-06-08")
    expect(metadata.guest_count).toBe(2)
  })

  it("sends no price at all", () => {
    // The charge comes from the server's own quote; a price here would either
    // be ignored or be a way to ask for a cheaper room.
    const { products } = build([booking()])
    const metadata = products[0].purchase_metadata as Record<string, unknown>

    expect(products[0].unit_price_override).toBeUndefined()
    expect(metadata.total).toBeUndefined()
    expect(metadata.quote).toBeUndefined()
  })

  it("shapes guests as the backend reads them", () => {
    const { products } = build([booking()])
    const metadata = products[0].purchase_metadata as Record<string, unknown>

    expect(metadata.guests).toEqual([{ name: "Ada" }, { name: "Grace" }])
  })

  it("drops blank guest slots rather than sending empty names", () => {
    // An empty slot is a name the buyer has not typed yet, not a guest called
    // "". The backend rejects the purchase when required names are missing,
    // which is the honest failure.
    const { products } = build([
      booking({ guestCount: 3, guests: ["Ada", "  ", ""] }),
    ])
    const metadata = products[0].purchase_metadata as Record<string, unknown>

    expect(metadata.guests).toEqual([{ name: "Ada" }])
    expect(metadata.guest_count).toBe(3)
  })

  it("sends two lines for the same room booked twice", () => {
    // Each line is assigned its own unit, so two rooms cannot be one line
    // with quantity 2.
    const { products } = build([
      booking(),
      booking({ checkIn: "2026-06-20", checkOut: "2026-06-22" }),
    ])

    expect(products).toHaveLength(2)
    expect(products.every((line) => line.quantity === 1)).toBe(true)
  })

  it("adds nothing when no room was booked", () => {
    expect(build([]).products).toHaveLength(0)
  })
})
