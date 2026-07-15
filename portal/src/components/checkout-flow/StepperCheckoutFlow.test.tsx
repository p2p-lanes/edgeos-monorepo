import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import StepperCheckoutFlow from "./StepperCheckoutFlow"

const submitPayment = vi.fn().mockResolvedValue({ success: true })

let cityOverride: Record<string, unknown> | null = null
let availableStepsOverride: string[] | null = null
let stepConfigsOverride: Record<string, unknown>[] | null = null
let hasAnyCartItemsOverride: boolean | null = null

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
    // Open checkout (`/checkout/[popupSlug]`) routes ticket picks to
    // cart.dynamicItems, never cart.passes — see useTicketsStep.ts:284,336.
    // The mock mirrors that, so gating the pay button on `passes` fails here
    // the way it fails in a real open checkout.
    cart: { passes: [], housing: null, merch: [], patron: null },
    hasAnyCartItems: hasAnyCartItemsOverride ?? true,
    summary: { grandTotal: 100, itemCount: 1 },
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
    hasAnyCartItemsOverride = null
  })

  it("enables pay when the cart holds only dynamic items", () => {
    render(<StepperCheckoutFlow />)
    fireEvent.click(screen.getByTestId("stepper-next")) // → confirm (last)

    const pay = screen.getByTestId("stepper-next") as HTMLButtonElement
    expect(pay.disabled).toBe(false)
  })

  it("disables pay when the cart is empty", () => {
    hasAnyCartItemsOverride = false
    render(<StepperCheckoutFlow />)
    fireEvent.click(screen.getByTestId("stepper-next")) // → confirm (last)

    const pay = screen.getByTestId("stepper-next") as HTMLButtonElement
    expect(pay.disabled).toBe(true)
  })

  it("renders only the first section initially", () => {
    render(<StepperCheckoutFlow />)
    expect(screen.getByText("pass-step")).toBeTruthy()
    expect(screen.queryByText("confirm-step")).toBeNull()
  })

  it("keeps Back and Total on a non-content-only first step", () => {
    render(<StepperCheckoutFlow />)

    expect(screen.getByText("common.back")).toBeTruthy()
    expect(screen.getByText("$100")).toBeTruthy()
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

    it("paints the amanita nav gradient full-bleed, with only the pills constrained", () => {
      cityOverride = AMANITA_CITY
      stepConfigsOverride = [PASSES_STEP_CONFIG]
      const { container } = render(<StepperCheckoutFlow />)

      // The <nav> holds the pills and is the constrained element…
      const nav = container.querySelector('nav[aria-label="Checkout sections"]')
      expect(nav).toBeTruthy()
      expect(nav?.className).toContain("max-w-[980px]")
      expect(nav?.classList.contains("fixed")).toBe(false)

      // …while its parent is the full-bleed bar that paints the gradient.
      const bar = nav?.parentElement as HTMLElement
      expect(bar.classList.contains("fixed")).toBe(true)
      expect(bar.className).not.toContain("max-w-")
      expect(bar.style.background).toContain("linear-gradient")
    })

    it("keeps the default skin's nav bar full-width with its own background", () => {
      stepConfigsOverride = [PASSES_STEP_CONFIG]
      const { container } = render(<StepperCheckoutFlow />)

      const nav = container.querySelector('nav[aria-label="Checkout sections"]')
      const bar = nav?.parentElement as HTMLElement
      expect(bar.classList.contains("sticky")).toBe(true)
      expect(bar.className).toContain("bg-background/90")
      expect(nav?.className).not.toContain("max-w-")
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

    const HERO_STEP_CONFIG = {
      id: "hero-config-1",
      step_type: "hero",
      title: "Hero",
      template: "hero",
      show_in_navbar: true,
      template_config: {
        cta_label: "Ver Entradas →",
        cta_hint: "Elegí tu entrada para comenzar",
      },
    }

    it("renders the intro bottom bar on a content-only first step", () => {
      cityOverride = AMANITA_CITY
      availableStepsOverride = ["hero", "passes"]
      stepConfigsOverride = [HERO_STEP_CONFIG]

      render(<StepperCheckoutFlow />)

      expect(screen.getByText("Elegí tu entrada para comenzar")).toBeTruthy()
      expect(screen.getByTestId("stepper-next").textContent).toBe(
        "Ver Entradas →",
      )
      expect(screen.queryByText("common.back")).toBeNull()
      expect(screen.queryByText("$100")).toBeNull()
    })

    it("intro CTA advances, and the standard bar returns", () => {
      cityOverride = AMANITA_CITY
      availableStepsOverride = ["hero", "passes"]
      stepConfigsOverride = [HERO_STEP_CONFIG]

      render(<StepperCheckoutFlow />)
      fireEvent.click(screen.getByTestId("stepper-next"))

      expect(screen.getByText("pass-step")).toBeTruthy()
      expect(screen.getByText("common.back")).toBeTruthy()
      expect(screen.getByText("$100")).toBeTruthy()
    })

    it("falls back to the next section label when no cta_label is set", () => {
      cityOverride = AMANITA_CITY
      availableStepsOverride = ["hero", "passes"]
      stepConfigsOverride = [
        { ...HERO_STEP_CONFIG, template_config: {} },
      ]

      render(<StepperCheckoutFlow />)

      // "passes" has no matching stepConfig here (only the "hero" step does),
      // so deriveCheckoutSections falls back to DEFAULT_LABELS.passes.
      expect(screen.getByTestId("stepper-next").textContent).toBe(
        "Select Your Passes",
      )
      expect(screen.queryByText("common.back")).toBeNull()
    })

    it("falls back to the next section label when cta_label is cleared to an empty string", () => {
      // Regression test (final-review fix): the backoffice's HeroConfig.tsx
      // writes text fields verbatim, so an admin clearing the "Bottom bar
      // CTA" input persists cta_label: "" — not undefined. `??` doesn't
      // coalesce "", so the CTA rendered blank. Must fall back just like
      // the absent-cta_label case above.
      cityOverride = AMANITA_CITY
      availableStepsOverride = ["hero", "passes"]
      stepConfigsOverride = [
        { ...HERO_STEP_CONFIG, template_config: { cta_label: "" } },
      ]

      render(<StepperCheckoutFlow />)

      expect(screen.getByTestId("stepper-next").textContent).toBe(
        "Select Your Passes",
      )
      expect(screen.queryByText("common.back")).toBeNull()
    })

    it("routes rich-text steps to DynamicProductStep, not the catalog", () => {
      cityOverride = AMANITA_CITY
      availableStepsOverride = ["housing", "confirm"]
      stepConfigsOverride = [
        {
          id: "rich-text-config-1",
          step_type: "housing",
          title: "Info",
          template: "rich-text",
          template_config: null,
        },
      ]

      render(<StepperCheckoutFlow />)

      expect(screen.getByText("dynamic-step")).toBeTruthy()
      expect(screen.queryByText("amanita-catalog")).toBeNull()
    })
  })
})
