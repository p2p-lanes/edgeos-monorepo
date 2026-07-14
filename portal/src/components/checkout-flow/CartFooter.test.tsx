import { render } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import CartFooter from "./CartFooter"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (_k: string, o?: { defaultValue?: string }) => o?.defaultValue ?? _k }),
}))

vi.mock("@/providers/cityProvider", () => ({
  useCityProvider: () => ({ getCity: () => ({}) }),
}))

vi.mock("./CartItemList", () => ({ default: () => <div>cart-items</div> }))

vi.mock("@/providers/checkoutProvider", () => ({
  useCheckout: () => ({
    summary: { grandTotal: 40000, itemCount: 1, creditApplied: 0 },
    currentStep: "passes",
    availableSteps: ["passes", "buyer", "confirm"],
    attendees: [],
    goToNextStep: vi.fn(),
    goToPreviousStep: vi.fn(),
    isSubmitting: false,
    isEditing: false,
    termsAccepted: false,
    isBuyerInfoComplete: true,
    cartUiEnabled: false,
    hasAnyCartItems: true,
    getBuyerInvalidFields: () => [],
    findFirstIncompleteStep: () => null,
    findFirstProductStep: () => null,
    markBuyerFieldsTouched: vi.fn(),
    triggerCheckoutToast: vi.fn(),
    dismissCheckoutToast: vi.fn(),
    visitedSteps: new Set<string>(),
  }),
}))

describe("CartFooter — chrome vars", () => {
  it("uses the configurable bottom-bar border and accent classes", () => {
    const { container } = render(<CartFooter activeSectionId="passes" />)
    expect(
      container.querySelector(".border-checkout-bottom-bar-border"),
    ).not.toBeNull()
    expect(
      container.querySelector(".text-checkout-bottom-bar-accent"),
    ).not.toBeNull()
  })
})
