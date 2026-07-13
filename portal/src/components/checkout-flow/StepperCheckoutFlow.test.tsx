import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import StepperCheckoutFlow from "./StepperCheckoutFlow"

const submitPayment = vi.fn().mockResolvedValue({ success: true })

vi.mock("next/navigation", () => ({
  useParams: () => ({ popupSlug: "popup-a" }),
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn() }),
}))

vi.mock("@/providers/checkoutProvider", () => ({
  useCheckout: () => ({
    availableSteps: ["passes", "confirm"],
    stepConfigs: [],
    submitPayment,
    isInitialLoading: false,
    markStepVisited: vi.fn(),
    cart: { passes: [{}], housing: null, merch: [], patron: null },
    summary: { grandTotal: 100 },
    isSubmitting: false,
    termsAccepted: true,
  }),
}))

vi.mock("@/providers/cityProvider", () => ({
  useCityProvider: () => ({
    getCity: () => ({ terms_and_conditions_url: null }),
  }),
}))

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))

vi.mock("./SectionHeader", () => ({ default: () => <div>section-header</div> }))
vi.mock("./CheckoutToast", () => ({ default: () => <div>toast</div> }))
vi.mock("./DynamicProductStep", () => ({
  default: () => <div>dynamic-step</div>,
}))
vi.mock("./steps/PassSelectionSection", () => ({
  default: () => <div>pass-step</div>,
}))
vi.mock("./steps/OpenCheckoutBuyerStep", () => ({
  default: () => <div>buyer-step</div>,
}))
vi.mock("./steps/ConfirmStep", () => ({
  default: () => <div>confirm-step</div>,
}))
vi.mock("./registries/stepRegistry", () => ({
  shouldUseDynamicStep: () => false,
}))
vi.mock("@/components/ui/Loader", () => ({ Loader: () => <div>loading</div> }))
vi.mock("@/types/checkout", () => ({ formatCurrency: (n: number) => `$${n}` }))

describe("StepperCheckoutFlow", () => {
  beforeEach(() => submitPayment.mockClear())

  it("renders only the first section initially", () => {
    render(<StepperCheckoutFlow />)
    expect(screen.getByText("pass-step")).toBeTruthy()
    expect(screen.queryByText("confirm-step")).toBeNull()
  })

  it("advances to the next section via the contextual CTA", () => {
    render(<StepperCheckoutFlow />)
    fireEvent.click(screen.getByTestId("stepper-next"))
    expect(screen.getByText("confirm-step")).toBeTruthy()
  })

  it("calls submitPayment on the last section", async () => {
    render(<StepperCheckoutFlow />)
    fireEvent.click(screen.getByTestId("stepper-next")) // → confirm (last)
    fireEvent.click(screen.getByTestId("stepper-next")) // → pay
    await waitFor(() => expect(submitPayment).toHaveBeenCalledTimes(1))
  })
})
