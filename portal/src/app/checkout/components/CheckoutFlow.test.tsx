import { render, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import CheckoutFlow from "./CheckoutFlow"

const mockUseSearchParams = vi.fn()
const mockReadAndClearPendingPaymentRedirectState = vi.fn()
const mockUsePaymentVerification = vi.fn()

vi.mock("next/navigation", () => ({
  useParams: () => ({ popupSlug: "popup-a" }),
  useSearchParams: () => mockUseSearchParams(),
}))

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock("framer-motion", () => ({
  AnimatePresence: ({ children }: { children: ReactNode }) => children,
}))

vi.mock("@/hooks/usePaymentRedirect", () => ({
  readAndClearPendingPaymentRedirectState: () =>
    mockReadAndClearPendingPaymentRedirectState(),
}))

vi.mock("@/hooks/checkout", () => ({
  usePaymentVerification: (args: unknown) => mockUsePaymentVerification(args),
}))

vi.mock("@/providers/applicationProvider", () => ({
  useApplication: () => ({
    getRelevantApplication: () => null,
  }),
}))

vi.mock("@/providers/checkoutProvider", () => ({
  useCheckout: () => ({
    currentStep: "success",
    availableSteps: ["success"],
    stepConfigs: [],
    goToNextStep: vi.fn(),
    goToPreviousStep: vi.fn(),
    goToStep: vi.fn(),
    housingProducts: [],
    merchProducts: [],
    patronProducts: [],
    submitPayment: vi.fn().mockResolvedValue({ success: true }),
    cart: {
      passes: [],
      housing: null,
      merch: [],
      patron: null,
      dynamicItems: {},
    },
  }),
}))

vi.mock("@/components/checkout-flow/CartFooter", () => ({
  default: () => <div>cart-footer</div>,
}))

vi.mock("@/components/checkout-flow/DynamicProductStep", () => ({
  default: () => <div>dynamic-step</div>,
}))

vi.mock("@/components/checkout-flow/steps/PassSelectionSection", () => ({
  default: () => <div>pass-step</div>,
}))

vi.mock("@/components/checkout-flow/steps/SuccessStep", () => ({
  default: ({ paymentStatus }: { paymentStatus: string }) => (
    <div>{paymentStatus}</div>
  ),
}))

vi.mock("@/components/checkout-flow/registries/stepRegistry", () => ({
  STEP_COMPONENT_REGISTRY: {},
  shouldUseDynamicStep: () => false,
}))

describe("CheckoutFlow", () => {
  beforeEach(() => {
    mockUsePaymentVerification.mockReturnValue({ paymentStatus: "pending" })
    mockReadAndClearPendingPaymentRedirectState.mockReset()
    mockUseSearchParams.mockReset()
  })

  it("restores the saved payment id for checkout-success returns", async () => {
    mockUseSearchParams.mockReturnValue({
      get: (key: string) => (key === "checkout" ? "success" : null),
    })
    mockReadAndClearPendingPaymentRedirectState.mockReturnValue({
      paymentId: "payment-123",
      popupSlug: "popup-a",
    })

    render(<CheckoutFlow />)

    await waitFor(() => {
      expect(mockUsePaymentVerification).toHaveBeenLastCalledWith({
        applicationId: undefined,
        paymentId: "payment-123",
        enabled: true,
      })
    })
  })

  it("ignores redirect state when the return is not checkout-success", async () => {
    mockUseSearchParams.mockReturnValue({
      get: () => null,
    })

    render(<CheckoutFlow />)

    await waitFor(() => {
      expect(mockReadAndClearPendingPaymentRedirectState).not.toHaveBeenCalled()
      expect(mockUsePaymentVerification).toHaveBeenLastCalledWith({
        applicationId: undefined,
        paymentId: undefined,
        enabled: false,
      })
    })
  })
})
