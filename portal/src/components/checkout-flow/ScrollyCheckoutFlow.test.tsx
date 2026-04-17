import { render, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import ScrollyCheckoutFlow from "./ScrollyCheckoutFlow"

const mockUseSearchParams = vi.fn()
const mockReadAndClearPendingPaymentRedirectState = vi.fn()
const mockUsePaymentVerification = vi.fn()

vi.mock("next/navigation", () => ({
  useParams: () => ({ popupSlug: "popup-a" }),
  useSearchParams: () => mockUseSearchParams(),
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
    availableSteps: ["passes"],
    submitPayment: vi.fn().mockResolvedValue({ success: true }),
    stepConfigs: [],
  }),
}))

vi.mock("./steps/SuccessStep", () => ({
  default: ({ paymentStatus }: { paymentStatus: string }) => (
    <div>{paymentStatus}</div>
  ),
}))

vi.mock("./DynamicProductStep", () => ({
  default: () => <div>dynamic-step</div>,
}))

vi.mock("./ScrollySectionNav", () => ({
  default: () => <div>nav</div>,
}))

vi.mock("./SectionHeader", () => ({
  default: () => <div>section-header</div>,
}))

vi.mock("./SnapDotNav", () => ({
  default: () => <div>dot-nav</div>,
}))

vi.mock("./SnapFooter", () => ({
  default: () => <div>footer</div>,
}))

vi.mock("./SnapSection", () => ({
  default: ({ children, id }: { children: ReactNode; id: string }) => (
    <section id={id}>{children}</section>
  ),
}))

vi.mock("./steps/PassSelectionSection", () => ({
  default: () => <div>pass-step</div>,
}))

vi.mock("./registries/stepRegistry", () => ({
  STEP_COMPONENT_REGISTRY: {},
  shouldUseDynamicStep: () => false,
}))

describe("ScrollyCheckoutFlow", () => {
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

    render(<ScrollyCheckoutFlow />)

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

    render(<ScrollyCheckoutFlow />)

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
