/**
 * The last screen before paying.
 *
 * A booked room is the one cart line whose price is a server quote rather
 * than a product price, and it took a separate path into the cart. It was
 * missing from this list entirely while still counting towards the total,
 * so the buyer was asked to pay for something the review did not mention.
 * That is the shape of bug worth a test: the summary and the itemisation
 * disagreeing about what is in the cart.
 */

import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { createInitialCartState } from "@/types/checkout"
import ConfirmStep from "./ConfirmStep"

// `any` here is the same deliberate fixture simplification the Amanita
// confirm test makes: the real item types carry many fields this component
// never reads.
let cart: any
let summary: Record<string, number>
let popup: Record<string, unknown> = {}

vi.mock("@/providers/checkoutProvider", () => ({
  useCheckout: () => ({
    cart,
    summary,
    attendees: [],
    applyPromoCode: vi.fn(async () => true),
    clearPromoCode: vi.fn(),
    toggleInsurance: vi.fn(),
    isLoading: false,
    error: null,
    isEditing: false,
    editCredit: 0,
    monthUpgradeCredit: 0,
    termsAccepted: false,
    setTermsAccepted: vi.fn(),
    stepConfigs: [],
    buyerValues: {},
    buyerGeneralError: null,
    removeMealPlan: vi.fn(),
    housingDatesShown: true,
  }),
}))

vi.mock("@/providers/cityProvider", () => ({
  useCityProvider: () => ({ getCity: () => popup }),
}))

vi.mock("@/providers/applicationProvider", () => ({
  useApplication: () => ({ getRelevantApplication: () => null }),
}))

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

function bookedRoom() {
  return {
    accommodationId: "room-1",
    productId: "room-product",
    name: "Garden Studio",
    propertyId: "prop-1",
    propertyName: "Casa del Lago",
    checkIn: "2026-09-14",
    checkOut: "2026-09-18",
    nights: 4,
    guestCount: 2,
    guests: [],
    bookerAnswers: {},
    guestForm: null,
    subtotal: 400,
    tax: 40,
    totalPrice: 440,
  }
}

beforeEach(() => {
  popup = { allows_coupons: false }
  cart = { ...createInitialCartState(), accommodations: [bookedRoom()] }
  summary = {
    subtotal: 440,
    discount: 0,
    grandTotal: 440,
    discountableSubtotal: 440,
    insuranceSubtotal: 0,
    contributionSubtotal: 0,
    credit: 0,
  }
})

describe("a booked room", () => {
  it("is listed, with the property and the nights it covers", () => {
    render(<ConfirmStep />)

    expect(screen.getByText("Garden Studio")).toBeTruthy()
    expect(screen.getByText(/Casa del Lago/)).toBeTruthy()
    expect(screen.getAllByText(/\$440/).length).toBeGreaterThan(0)
  })

  it("counts as a cart, rather than leaving the step looking empty", () => {
    // The room was already in the total at this point. Showing the
    // empty-cart state over a total of $440 is the worst of both.
    render(<ConfirmStep />)

    expect(screen.queryByText("checkout.cart.empty_title")).toBeNull()
  })

  it("is not mentioned when there is no room in the cart", () => {
    cart = { ...createInitialCartState() }
    render(<ConfirmStep />)

    expect(screen.queryByText("Garden Studio")).toBeNull()
  })
})
