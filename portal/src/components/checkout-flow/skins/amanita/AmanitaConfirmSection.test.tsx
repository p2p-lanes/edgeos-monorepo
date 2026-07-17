/**
 * Tests for AmanitaConfirmSection (Task 8).
 *
 * Verifies that:
 * - Cart line items render from the real cart/summary (passes + dynamic
 *   items), Amanita-restyled but fed by the same data ConfirmStep.tsx uses.
 * - Applying a coupon calls the real `applyPromoCode` mutation.
 * - The empty-cart state shows when the cart has no items, with a
 *   "Ver tickets" CTA that calls the `onGoToTickets` callback.
 * - The in-card pay CTA appears only when the stepper hands this section a
 *   payment handler, and then takes its label and disabled state from the
 *   bottom bar rather than re-deriving either.
 *
 * No jest-dom in this project — assertions use
 * `getByText`/`getByRole`/`toBeTruthy()`.
 */
import { act, fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { TicketingStepPublic } from "@/client"
import { createInitialCartState } from "@/types/checkout"
import AmanitaConfirmSection from "./AmanitaConfirmSection"

const applyPromoCode = vi.fn(async () => true)
const clearPromoCode = vi.fn()
const setTermsAccepted = vi.fn()

// `any` here is a deliberate test-fixture simplification: the real
// SelectedPassItem/ProductsPass types require many unrelated fields
// (tenant_id, popup_id, slug, category, price, ...) that this component
// never reads — only `product.name`/`.discountable`/`.price` and the
// pass/item quantity+price fields matter for what's being asserted here.
let cart: any
let summary: {
  subtotal: number
  discount: number
  grandTotal: number
  discountableSubtotal: number
  insuranceSubtotal: number
  contributionSubtotal: number
  credit: number
}
let termsAccepted = false
let popup: Record<string, unknown> = {}

vi.mock("@/providers/checkoutProvider", () => ({
  useCheckout: () => ({
    cart,
    summary,
    attendees: [],
    applyPromoCode,
    clearPromoCode,
    toggleInsurance: vi.fn(),
    isLoading: false,
    error: null,
    isEditing: false,
    editCredit: 0,
    monthUpgradeCredit: 0,
    termsAccepted,
    setTermsAccepted,
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
  useTranslation: () => ({ t: (k: string) => k }),
}))

function makePass(overrides: Partial<any> = {}) {
  return {
    productId: "p1",
    attendeeId: "a1",
    quantity: 1,
    price: 100,
    originalPrice: 100,
    product: { id: "p1", name: "General Pass", discountable: true },
    ...overrides,
  }
}

describe("AmanitaConfirmSection", () => {
  beforeEach(() => {
    applyPromoCode.mockClear()
    clearPromoCode.mockClear()
    setTermsAccepted.mockClear()
    termsAccepted = false
    popup = {
      allows_coupons: true,
      terms_and_conditions_url: "https://example.com/terms",
    }
    cart = {
      ...createInitialCartState(),
      passes: [makePass()],
    }
    summary = {
      subtotal: 100,
      discount: 0,
      grandTotal: 100,
      discountableSubtotal: 100,
      insuranceSubtotal: 0,
      contributionSubtotal: 0,
      credit: 0,
    }
  })

  it("renders cart line items from the real cart/summary", () => {
    render(<AmanitaConfirmSection />)
    expect(screen.getByText(/General Pass/)).toBeTruthy()
    expect(screen.getAllByText(/\$100/).length).toBeGreaterThan(0)
  })

  it("renders dynamic items from cart.dynamicItems", () => {
    cart = {
      ...cart,
      passes: [],
      dynamicItems: {
        merch_step: [
          {
            productId: "d1",
            product: { id: "d1", name: "Tote Bag", discountable: true },
            quantity: 1,
            price: 40,
            stepType: "merch_step",
          },
        ],
      },
    }
    render(<AmanitaConfirmSection />)
    expect(screen.getByText(/Tote Bag/)).toBeTruthy()
  })

  it("calls applyPromoCode with the entered code", async () => {
    render(<AmanitaConfirmSection />)
    const input = screen.getByPlaceholderText(
      "checkout.amanita.confirm_coupon_placeholder",
    )
    fireEvent.change(input, { target: { value: "amanita10" } })
    const applyButton = screen.getByRole("button", {
      name: "checkout.amanita.confirm_coupon_apply",
    })
    await act(async () => {
      fireEvent.click(applyButton)
    })
    expect(applyPromoCode).toHaveBeenCalledWith("AMANITA10")
  })

  it("shows the terms checkbox and drives setTermsAccepted", () => {
    render(<AmanitaConfirmSection />)
    const checkbox = screen.getByRole("checkbox")
    fireEvent.click(checkbox)
    expect(setTermsAccepted).toHaveBeenCalledWith(true)
  })

  it("shows the empty-cart state when the cart has no items", () => {
    cart = createInitialCartState()
    render(<AmanitaConfirmSection />)
    expect(
      screen.getByText("checkout.amanita.confirm_empty_title"),
    ).toBeTruthy()
    expect(
      screen.getByRole("button", {
        name: "checkout.amanita.confirm_go_tickets",
      }),
    ).toBeTruthy()
  })

  it("calls onGoToTickets when the empty-state CTA is clicked", () => {
    cart = createInitialCartState()
    const onGoToTickets = vi.fn()
    render(<AmanitaConfirmSection onGoToTickets={onGoToTickets} />)
    fireEvent.click(
      screen.getByRole("button", {
        name: "checkout.amanita.confirm_go_tickets",
      }),
    )
    expect(onGoToTickets).toHaveBeenCalled()
  })

  it("always shows Subtotal, even with nothing discounted", () => {
    render(<AmanitaConfirmSection />)
    expect(
      screen.getByText("checkout.amanita.confirm_subtotal_label"),
    ).toBeTruthy()
    expect(
      screen.getByText("checkout.amanita.confirm_total_label"),
    ).toBeTruthy()
  })

  it("lays the summary out as items → coupon → subtotal → fee → total", () => {
    popup = { ...popup, contribution_label: "Service fee" }
    summary = { ...summary, contributionSubtotal: 10, grandTotal: 110 }

    const { container } = render(<AmanitaConfirmSection />)
    const text = container.textContent ?? ""

    const order = [
      "General Pass",
      "checkout.amanita.confirm_coupon_label",
      "checkout.amanita.confirm_subtotal_label",
      "Service fee",
      "checkout.amanita.confirm_total_label",
    ].map((needle) => text.indexOf(needle))

    for (const index of order) expect(index).toBeGreaterThan(-1)
    const sorted = [...order].sort((a, b) => a - b)
    expect(order).toEqual(sorted)
  })

  /* `useCartSummary` folds the service fee into `summary.subtotal`, so the
     realistic shape of a $100 order with a $10 fee is subtotal 110 / total
     110. Printed raw, the fee showed up twice and Subtotal read the same as
     Total — the column never added up. */
  it("shows Subtotal without the service fee the Total adds back", () => {
    popup = { ...popup, contribution_label: "Service fee" }
    summary = {
      ...summary,
      subtotal: 110,
      contributionSubtotal: 10,
      grandTotal: 110,
    }

    render(<AmanitaConfirmSection />)

    // Subtotal 100 + fee 10 = total 110, which is what the ladder claims.
    const row = (label: string) =>
      screen.getByText(label).parentElement?.textContent ?? ""
    expect(row("checkout.amanita.confirm_subtotal_label")).toContain("$100")
    expect(row("checkout.amanita.confirm_subtotal_label")).not.toContain("$110")
    expect(row("checkout.amanita.confirm_total_label")).toContain("$110")
  })

  it("runs the order lines flat — no group heading over the tickets", () => {
    cart = {
      ...cart,
      passes: [],
      dynamicItems: {
        tickets: [
          {
            productId: "d1",
            product: { id: "d1", name: "Full Pass", discountable: true },
            quantity: 1,
            price: 100,
            stepType: "tickets",
          },
        ],
      },
    }
    const { container } = render(<AmanitaConfirmSection />)

    expect(screen.getByText(/Full Pass/)).toBeTruthy()
    expect(screen.queryByText("checkout.step_short.passes")).toBeNull()
    // The order card carries its own title and nothing else above the lines —
    // the only icon on the line is its own remove control.
    expect(
      container.querySelectorAll('button[aria-label^="Remove"]').length,
    ).toBe(1)
  })

  it("keeps the service fee out of the item list when the popup charges none", () => {
    render(<AmanitaConfirmSection />)
    expect(screen.queryByText("checkout.contribution.fallbackLabel")).toBeNull()
  })

  // Same contract as the buyer step: with the stepper's generic
  // SectionHeader suppressed on this skin, ignoring the config is what makes
  // an organizer's rename invisible.
  describe("step heading", () => {
    const CONFIG = {
      id: "s2",
      step_type: "confirm",
      title: "Revisá tu compra",
      description: "Un último vistazo antes de pagar.",
      watermark: "Paso 3",
      template_config: null,
    } as unknown as TicketingStepPublic

    it("takes title, description and watermark from the step config", () => {
      render(<AmanitaConfirmSection stepConfig={CONFIG} />)
      expect(screen.getByText("Revisá tu compra")).toBeTruthy()
      expect(screen.getByText("Un último vistazo antes de pagar.")).toBeTruthy()
      expect(screen.getByText("Paso 3")).toBeTruthy()
    })

    it("keeps the configured title on the empty-cart state", () => {
      cart = createInitialCartState()
      render(<AmanitaConfirmSection stepConfig={CONFIG} />)
      expect(screen.getByText("Revisá tu compra")).toBeTruthy()
    })

    it("falls back to the skin's copy when no step is configured", () => {
      render(<AmanitaConfirmSection />)
      expect(screen.getByText("checkout.amanita.confirm_title")).toBeTruthy()
      expect(screen.getByText("checkout.amanita.confirm_kicker")).toBeTruthy()
    })
  })

  it("does NOT render a second pay/confirm button — the bottom bar owns payment", () => {
    render(<AmanitaConfirmSection />)
    const buttons = screen.getAllByRole("button").map((b) => b.textContent)
    for (const label of buttons) {
      expect(label?.toLowerCase()).not.toMatch(
        /pay|confirmar compra|checkout\.actions\.pay/,
      )
    }
  })

  describe("in-card pay CTA", () => {
    it("prints the label the bar passes down rather than one of its own", () => {
      render(
        <AmanitaConfirmSection
          onPay={vi.fn()}
          payLabel="checkout.actions.pay"
        />,
      )
      expect(
        screen.getByRole("button", { name: "checkout.actions.pay" }),
      ).toBeTruthy()
    })

    /* The bug this guards: the card used to re-derive its label from
       `summary.grandTotal`, printing "Confirmar compra" beside a bar that said
       "Pagar". The label is the bar's to decide, so a free order's CTA has to
       follow `payLabel` and nothing else. */
    it("follows payLabel on a free order instead of re-deriving from the total", () => {
      summary = { ...summary, grandTotal: 0 }
      render(
        <AmanitaConfirmSection
          onPay={vi.fn()}
          payLabel="checkout.actions.claim_pass"
        />,
      )
      expect(
        screen.getByRole("button", { name: "checkout.actions.claim_pass" }),
      ).toBeTruthy()
      expect(screen.queryByText("checkout.amanita.confirm_cta")).toBeNull()
    })

    it("disables the card CTA from the bar's gate", () => {
      render(
        <AmanitaConfirmSection
          onPay={vi.fn()}
          payLabel="checkout.actions.pay"
          payDisabled
        />,
      )
      const button = screen.getByRole("button", {
        name: "checkout.actions.pay",
      }) as HTMLButtonElement
      expect(button.disabled).toBe(true)
    })
  })
})
