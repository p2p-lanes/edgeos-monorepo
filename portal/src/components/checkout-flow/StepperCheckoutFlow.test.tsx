import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import StepperCheckoutFlow from "./StepperCheckoutFlow"

const submitPayment = vi.fn().mockResolvedValue({ success: true })

let cityOverride: Record<string, unknown> | null = null
let availableStepsOverride: string[] | null = null

vi.mock("next/navigation", () => ({
  useParams: () => ({ popupSlug: "popup-a" }),
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn() }),
}))

// next/font/google relies on the Next.js SWC compiler plugin and throws
// when imported through plain Vite/Vitest — stub it with the shape
// StepperCheckoutFlow/fonts.ts actually reads (`.variable`).
vi.mock("next/font/google", () => ({
  Amarante: () => ({ variable: "--font-amanita-display" }),
  Oswald: () => ({ variable: "--font-amanita-condensed" }),
  Quicksand: () => ({ variable: "--font-amanita-sans" }),
}))

vi.mock("@/providers/checkoutProvider", () => ({
  useCheckout: () => ({
    availableSteps: availableStepsOverride ?? ["passes", "confirm"],
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
    getCity: () => cityOverride ?? { terms_and_conditions_url: null },
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
vi.mock("./skins/amanita/AmanitaBuyerStep", () => ({
  default: () => <div>amanita-buyer-step</div>,
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
  beforeEach(() => {
    submitPayment.mockClear()
    cityOverride = null
    availableStepsOverride = null
  })

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

  describe("skin", () => {
    it("applies the checkout-amanita wrapper class when the popup's skin is amanita", () => {
      cityOverride = {
        terms_and_conditions_url: null,
        theme_config: { checkout_skin: "amanita" },
      }
      const { container } = render(<StepperCheckoutFlow />)
      expect(container.querySelector(".checkout-amanita")).toBeTruthy()
    })

    it("does not apply the checkout-amanita wrapper class for the default skin", () => {
      const { container } = render(<StepperCheckoutFlow />)
      expect(container.querySelector(".checkout-amanita")).toBeNull()
    })

    it("routes the buyer step to AmanitaBuyerStep when the skin is amanita", () => {
      cityOverride = {
        terms_and_conditions_url: null,
        theme_config: { checkout_skin: "amanita" },
      }
      availableStepsOverride = ["buyer", "confirm"]
      render(<StepperCheckoutFlow />)
      expect(screen.getByText("amanita-buyer-step")).toBeTruthy()
      expect(screen.queryByText("buyer-step")).toBeNull()
    })

    it("routes the buyer step to OpenCheckoutBuyerStep for the default skin", () => {
      availableStepsOverride = ["buyer", "confirm"]
      render(<StepperCheckoutFlow />)
      expect(screen.getByText("buyer-step")).toBeTruthy()
      expect(screen.queryByText("amanita-buyer-step")).toBeNull()
    })
  })
})
