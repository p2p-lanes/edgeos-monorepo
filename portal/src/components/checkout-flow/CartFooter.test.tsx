/**
 * The pill footer's pay CTA on the confirm step.
 *
 * An empty cart totals $0, and a $0 total is what resolves to "Claim Pass",
 * so a shopper who had picked nothing was offered a free pass. The CTA now
 * says what is missing and stays disabled until something is in the cart.
 */

import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import CartFooter from "./CartFooter"

let hasAnyCartItems = false
let summary: Record<string, number>
let isEditing = false
const triggerCheckoutToast = vi.fn()

vi.mock("@/providers/checkoutProvider", () => ({
  useCheckout: () => ({
    summary,
    currentStep: "confirm",
    availableSteps: ["passes", "confirm"],
    attendees: [],
    goToNextStep: vi.fn(),
    goToPreviousStep: vi.fn(),
    isSubmitting: false,
    isEditing,
    termsAccepted: true,
    isBuyerInfoComplete: true,
    cartUiEnabled: false,
    hasAnyCartItems,
    getBuyerInvalidFields: () => [],
    findFirstIncompleteStep: () => null,
    findFirstProductStep: () => "passes",
    markBuyerFieldsTouched: vi.fn(),
    triggerCheckoutToast,
    dismissCheckoutToast: vi.fn(),
    visitedSteps: new Set<string>(),
  }),
}))

vi.mock("@/providers/cityProvider", () => ({
  useCityProvider: () => ({ getCity: () => ({}) }),
}))

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

// The drawer is closed in these tests; its contents are covered elsewhere.
vi.mock("./CartItemList", () => ({ default: () => null }))

function payButton(): HTMLButtonElement {
  return screen
    .getByText(/checkout\.actions\./)
    .closest("button") as HTMLButtonElement
}

beforeEach(() => {
  hasAnyCartItems = false
  isEditing = false
  summary = {
    grandTotal: 0,
    contributionSubtotal: 0,
    creditApplied: 0,
    itemCount: 0,
  }
  triggerCheckoutToast.mockReset()
})

describe("the confirm-step CTA", () => {
  it("asks for a ticket, disabled, when the cart is empty", () => {
    const onPay = vi.fn()
    render(<CartFooter onPay={onPay} />)

    const button = payButton()
    expect(button.textContent).toContain("checkout.actions.select_ticket")
    expect(screen.queryByText("checkout.actions.claim_pass")).toBeNull()
    expect(button.disabled).toBe(true)

    fireEvent.click(button)
    expect(onPay).not.toHaveBeenCalled()
  })

  it("offers Claim Pass for a free order that has items", () => {
    hasAnyCartItems = true
    summary = { ...summary, itemCount: 1 }
    const onPay = vi.fn()
    render(<CartFooter onPay={onPay} />)

    const button = payButton()
    expect(button.textContent).toContain("checkout.actions.claim_pass")
    expect(button.disabled).toBe(false)

    fireEvent.click(button)
    expect(onPay).toHaveBeenCalledTimes(1)
  })

  it("offers Pay for a paid order", () => {
    hasAnyCartItems = true
    summary = { ...summary, itemCount: 1, grandTotal: 120 }
    render(<CartFooter onPay={vi.fn()} />)

    expect(payButton().textContent).toContain("checkout.actions.pay")
  })

  it("leaves edits on their own label", () => {
    isEditing = true
    render(<CartFooter onPay={vi.fn()} />)

    const button = payButton()
    expect(button.textContent).toContain("checkout.actions.confirm_edit")
    expect(button.disabled).toBe(false)
  })
})
