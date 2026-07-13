import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import StepperCheckoutFlow from "./StepperCheckoutFlow"

const submitPayment = vi.fn().mockResolvedValue({ success: true })

let cityOverride: Record<string, unknown> | null = null
let availableStepsOverride: string[] | null = null
let stepConfigsOverride: Record<string, unknown>[] | null = null

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
    stepConfigs: stepConfigsOverride ?? [],
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
vi.mock("./skins/amanita/AmanitaCatalogSection", () => ({
  default: () => <div>amanita-catalog</div>,
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
    stepConfigsOverride = null
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
    const AMANITA_CITY = {
      terms_and_conditions_url: null,
      theme_config: { checkout_skin: "amanita" },
    }
    const FAQS_STEP_CONFIG = {
      id: "faqs-config-1",
      step_type: "faqs",
      title: "FAQs",
      template: "faqs",
      show_in_navbar: true,
      template_config: {
        items: [
          { question: "When does it start?", answer: "Noon sharp." },
          { question: "Can I camp?", answer: "Yes, camping included." },
        ],
      },
    }
    const PASSES_STEP_CONFIG = {
      id: "passes-config-1",
      step_type: "passes",
      title: "Select Your Passes",
      template: "catalog",
      template_config: null,
    }

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

    describe("product steps", () => {
      it("routes a passes/tickets product step to AmanitaCatalogSection for amanita", () => {
        cityOverride = AMANITA_CITY
        stepConfigsOverride = [
          {
            id: "passes-config-1",
            step_type: "passes",
            title: "Select Your Passes",
            template: "catalog",
            template_config: null,
          },
        ]
        render(<StepperCheckoutFlow />)
        expect(screen.getByText("amanita-catalog")).toBeTruthy()
        expect(screen.queryByText("pass-step")).toBeNull()
        expect(screen.queryByText("dynamic-step")).toBeNull()
      })

      it("falls through to PassSelectionSection (not AmanitaCatalogSection) for a config-less amanita passes step", () => {
        // Regression test (final-review fix): a `passes` step with no
        // matching stepConfig must NOT be routed to AmanitaCatalogSection —
        // that component dereferences `stepConfig.step_type`/
        // `.template_config` and crashes on a null/undefined stepConfig.
        cityOverride = AMANITA_CITY
        availableStepsOverride = ["passes"]
        stepConfigsOverride = []
        expect(() => render(<StepperCheckoutFlow />)).not.toThrow()
        expect(screen.queryByText("amanita-catalog")).toBeNull()
        expect(screen.getByText("pass-step")).toBeTruthy()
      })

      it("routes a non-passes config-carrying product step to AmanitaCatalogSection for amanita", () => {
        cityOverride = AMANITA_CITY
        availableStepsOverride = ["housing", "confirm"]
        stepConfigsOverride = [
          {
            id: "housing-config-1",
            step_type: "housing",
            title: "Housing",
            template: "housing-date",
            template_config: null,
          },
        ]
        render(<StepperCheckoutFlow />)
        expect(screen.getByText("amanita-catalog")).toBeTruthy()
        expect(screen.queryByText("dynamic-step")).toBeNull()
      })

      it("keeps hero-template steps on DynamicProductStep for amanita (not the catalog)", () => {
        cityOverride = AMANITA_CITY
        availableStepsOverride = ["housing", "confirm"]
        stepConfigsOverride = [
          {
            id: "hero-config-1",
            step_type: "housing",
            title: "Hero",
            template: "hero",
            template_config: null,
          },
        ]
        render(<StepperCheckoutFlow />)
        expect(screen.getByText("dynamic-step")).toBeTruthy()
        expect(screen.queryByText("amanita-catalog")).toBeNull()
      })

      it("keeps the default skin's product-step rendering unchanged (no AmanitaCatalogSection)", () => {
        render(<StepperCheckoutFlow />)
        expect(screen.getByText("pass-step")).toBeTruthy()
        expect(screen.queryByText("amanita-catalog")).toBeNull()
      })
    })

    describe("FAQs global drawer (amanita only)", () => {
      beforeEach(() => {
        cityOverride = AMANITA_CITY
        availableStepsOverride = ["faqs", "passes"]
        stepConfigsOverride = [FAQS_STEP_CONFIG, PASSES_STEP_CONFIG]
      })

      it("excludes the faqs step from the linear pills/sections and shows a separate FAQs pill", () => {
        render(<StepperCheckoutFlow />)
        // the faqs step is not a linear step: no pill carries its title verbatim
        expect(screen.queryByText("FAQs", { selector: "button" })).toBeNull()
        // the pass step (next in line) renders immediately, active index 0 —
        // routed to the Amanita catalog (Task 12) since this describe block
        // runs under the amanita skin
        expect(screen.getByText("amanita-catalog")).toBeTruthy()
        // the dedicated FAQs pill exists instead
        expect(
          screen.getByRole("button", {
            name: "checkout.amanita.faqs_pill_label",
          }),
        ).toBeTruthy()
        // dialog is closed until the pill is clicked
        expect(screen.queryByRole("dialog")).toBeNull()
      })

      it("opens the dialog when the FAQs pill is clicked, and Escape closes it", () => {
        render(<StepperCheckoutFlow />)
        fireEvent.click(
          screen.getByRole("button", {
            name: "checkout.amanita.faqs_pill_label",
          }),
        )
        const dialog = screen.getByRole("dialog")
        expect(dialog).toBeTruthy()
        expect(screen.getByText("When does it start?")).toBeTruthy()

        fireEvent.keyDown(document, { key: "Escape" })
        expect(screen.queryByRole("dialog")).toBeNull()
      })
    })

    it("renders the faqs step inline (no drawer) for the default skin", () => {
      availableStepsOverride = ["faqs", "passes"]
      stepConfigsOverride = [FAQS_STEP_CONFIG]
      render(<StepperCheckoutFlow />)
      // faqs stays a normal step: rendered inline via DynamicProductStep
      expect(screen.getByText("dynamic-step")).toBeTruthy()
      expect(
        screen.queryByRole("button", {
          name: "checkout.amanita.faqs_pill_label",
        }),
      ).toBeNull()
    })

    it("renders the logo-hongo image (not text) as the first pill for amanita", () => {
      cityOverride = AMANITA_CITY
      const { container } = render(<StepperCheckoutFlow />)
      const nav = screen.getByRole("navigation", {
        name: "Checkout sections",
      })
      const firstPillImg = nav.querySelector("button img")
      expect(firstPillImg).toBeTruthy()
      expect(screen.getByText("checkout.amanita.nav_home_sr")).toBeTruthy()
      expect(container).toBeTruthy()
    })

    it("does not render a logo image as the first pill for the default skin", () => {
      render(<StepperCheckoutFlow />)
      const nav = screen.getByRole("navigation", {
        name: "Checkout sections",
      })
      expect(nav.querySelector("button img")).toBeNull()
    })

    it("shows a cart-count badge on the Confirm pill for amanita when items are in the cart", () => {
      cityOverride = AMANITA_CITY
      render(<StepperCheckoutFlow />)
      const nav = screen.getByRole("navigation", {
        name: "Checkout sections",
      })
      const confirmPill = Array.from(nav.querySelectorAll("button")).find(
        (btn) => btn.textContent?.includes("Review & Confirm"),
      )
      expect(confirmPill).toBeTruthy()
      expect(confirmPill?.textContent).toContain("1")
    })
  })
})
