import { render, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import ScrollyCheckoutFlow from "./ScrollyCheckoutFlow"

const mockUseSearchParams = vi.fn()
const mockReadAndClearPendingPaymentRedirectState = vi.fn()
const mockRouterReplace = vi.fn()
let selectedFlowId: string | null = null

vi.mock("next/navigation", () => ({
  useParams: () => ({ popupSlug: "popup-a" }),
  useSearchParams: () => mockUseSearchParams(),
  useRouter: () => ({ replace: mockRouterReplace }),
}))

vi.mock("@/hooks/usePaymentRedirect", () => ({
  readAndClearPendingPaymentRedirectState: () =>
    mockReadAndClearPendingPaymentRedirectState(),
}))

vi.mock("@/providers/checkoutProvider", () => ({
  useCheckout: () => ({
    availableSteps: ["passes"],
    submitPayment: vi.fn().mockResolvedValue({ success: true }),
    stepConfigs: [],
    salesFlowId: selectedFlowId,
    submitMode: "application",
  }),
}))

vi.mock("@/providers/cityProvider", () => ({
  useCityProvider: () => ({
    getCity: () => ({ id: "popup_1", slug: "popup-a", name: "Popup A" }),
  }),
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
  shouldUseDynamicStep: () => false,
}))

describe("ScrollyCheckoutFlow", () => {
  beforeEach(() => {
    mockReadAndClearPendingPaymentRedirectState.mockReset()
    mockUseSearchParams.mockReset()
    mockRouterReplace.mockReset()
    selectedFlowId = null
  })

  it("redirects to /passes when returning from SimpleFI", async () => {
    mockUseSearchParams.mockReturnValue({
      get: (key: string) => (key === "checkout" ? "success" : null),
    })

    render(<ScrollyCheckoutFlow />)

    await waitFor(() => {
      expect(mockReadAndClearPendingPaymentRedirectState).toHaveBeenCalled()
      expect(mockRouterReplace).toHaveBeenCalledWith("/portal/popup-a/passes")
    })
  })

  it("does not redirect when the return is not checkout-success", async () => {
    mockUseSearchParams.mockReturnValue({
      get: () => null,
    })

    render(<ScrollyCheckoutFlow />)

    await waitFor(() => {
      expect(mockReadAndClearPendingPaymentRedirectState).not.toHaveBeenCalled()
      expect(mockRouterReplace).not.toHaveBeenCalled()
    })
  })
  it("keeps the selected application's context on a canonical Shop payment return", async () => {
    selectedFlowId = "flow-b"
    mockUseSearchParams.mockReturnValue(
      new URLSearchParams("checkout=success&lang=es"),
    )
    render(<ScrollyCheckoutFlow />)
    await waitFor(() =>
      expect(mockRouterReplace).toHaveBeenCalledWith(
        "/portal/popup-a/passes?flow=flow-b",
      ),
    )
    expect(mockReadAndClearPendingPaymentRedirectState).toHaveBeenCalledOnce()
  })
})
