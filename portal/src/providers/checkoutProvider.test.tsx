/**
 * Integration-style tests for checkoutProvider step-aware product wiring.
 * Verifies that the resolver replaces useProductCategories and passes
 * allActiveProducts to cart selection hooks.
 */
import { act, renderHook, waitFor } from "@testing-library/react"
import type { ComponentProps, ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { CheckoutService, type TicketingStepPublic } from "@/client"
import type { ApplicationFormSchema } from "@/types/form-schema"
import type { ProductsPass } from "@/types/Products"
import { CheckoutProvider, useCheckout } from "./checkoutProvider"

const paymentSubmitSpy = vi.hoisted(() =>
  vi.fn(({ previewMode }: { previewMode?: boolean }) => ({
    submitPayment: vi.fn(async () =>
      previewMode
        ? { success: false, error: "preview" }
        : { success: false, error: "empty_cart" },
    ),
    isSubmitting: false,
  })),
)
const cityState = vi.hoisted(() => ({
  current: null as Record<string, unknown> | null,
}))

// Minimal mocks to avoid network/provider dependencies
vi.mock("@/client", () => ({
  ApiError: class ApiError extends Error {
    body: unknown = null
  },
  CheckoutService: {
    purchaseOpenTicketing: vi.fn(),
    releasePendingOpen: vi.fn(),
    restoreFlowCart: vi.fn(),
    upsertFlowCart: vi.fn(),
  },
  CouponsService: { validateCoupon: vi.fn() },
  OpenAPI: {},
  PaymentsService: { releaseMyPendingPayment: vi.fn() },
  TicketingStepsService: { listPortalTicketingSteps: vi.fn() },
}))
vi.mock("@/hooks/checkout", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/checkout")>()),
  usePaymentSubmit: paymentSubmitSpy,
}))
vi.mock("@/providers/applicationProvider", () => ({
  useApplication: () => ({
    getRelevantApplication: () => null,
  }),
}))
vi.mock("@/providers/cityProvider", () => ({
  useCityProvider: () => ({
    getCity: () => cityState.current,
  }),
}))

beforeEach(() => {
  cityState.current = null
})
vi.mock("@/providers/discountProvider", () => ({
  useDiscount: () => ({
    discountApplied: { discount_value: 0 },
    setDiscount: vi.fn(),
    resetDiscount: vi.fn(),
  }),
}))
vi.mock("@/providers/passesProvider", () => ({
  usePassesProvider: () => ({
    attendeePasses: [],
    toggleProduct: vi.fn(),
    isEditing: false,
    toggleEditing: vi.fn(),
  }),
}))
vi.mock("@/hooks/useGetPassesData", () => ({
  default: () => ({ products: [], loading: false }),
}))
vi.mock("@/hooks/useIsAuthenticated", () => ({
  useIsAuthenticated: () => false,
}))
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: undefined, isLoading: false }),
  useQueryClient: () => ({
    getQueryData: vi.fn(),
    setQueryData: vi.fn(),
    invalidateQueries: vi.fn(),
  }),
  useMutation: () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}))
// `i18n` and not just `t`: usePaymentSubmit reads i18n.language, so a mock
// without it throws before any assertion runs.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "en" } }),
}))
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/",
}))

function makeStep(
  overrides: Partial<TicketingStepPublic> & { step_type: string },
): TicketingStepPublic {
  return {
    id: overrides.id ?? overrides.step_type,
    popup_id: "popup-id",
    tenant_id: "tenant-id",
    step_type: overrides.step_type,
    title: overrides.step_type,
    description: null,
    order: 0,
    is_enabled: true,
    protected: false,
    product_category: overrides.product_category ?? null,
    template: overrides.template ?? null,
    template_config: overrides.template_config ?? null,
    watermark: null,
    show_title: true,
    show_watermark: true,
  } as TicketingStepPublic
}

function makeProduct(
  overrides: Partial<ProductsPass> & { id: string; category: string },
): ProductsPass {
  const { id, category, ...rest } = overrides
  return {
    name: id,
    is_active: true,
    price: 10,
    compare_price: null,
    max_quantity: null,
    ...rest,
    id,
    category,
  } as unknown as ProductsPass
}

function makeWrapper(
  steps: TicketingStepPublic[],
  products: ProductsPass[],
  extraProps: Partial<ComponentProps<typeof CheckoutProvider>> = {},
): ({ children }: { children: ReactNode }) => ReactNode {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <CheckoutProvider
        configuredStepsOverride={steps}
        productsOverride={products}
        cartPersistenceEnabled={false}
        {...extraProps}
      >
        {children}
      </CheckoutProvider>
    ) as ReactNode
  }
}

// The provider used to synthesize a buyer step whenever an open-ticketing
// popup carried no `buyer` row, which meant the step could not be left out:
// it showed up in checkout no matter what the step config said. It's an
// ordinary configured step now — these pin that the config is the only source.
describe("checkoutProvider — the buyer step comes from the step config", () => {
  const BUYER_SCHEMA = {
    base_fields: {
      email: { type: "email", label: "Email", required: true, position: 0 },
    },
    custom_fields: {},
    sections: [],
  } as unknown as ApplicationFormSchema

  // Exactly the conditions that used to trigger the synthesis.
  const OPEN_TICKETING = {
    buyerFormSchema: BUYER_SCHEMA,
    submitMode: "open-ticketing" as const,
  }

  it("adds no buyer step when the config has none", () => {
    const steps = [
      makeStep({ id: "s1", step_type: "tickets" }),
      makeStep({ id: "s2", step_type: "confirm" }),
    ]

    const { result } = renderHook(() => useCheckout(), {
      wrapper: makeWrapper(steps, [], OPEN_TICKETING),
    })

    expect(result.current.stepConfigs.map((s) => s.step_type)).toEqual([
      "tickets",
      "confirm",
    ])
    expect(result.current.availableSteps).not.toContain("buyer")
  })

  // Without a step to send them to, nothing may claim the shopper left
  // something unfilled — that bounce had nowhere to land.
  it("reports no incomplete step when no buyer step is configured", () => {
    const steps = [makeStep({ id: "s1", step_type: "tickets" })]

    const { result } = renderHook(() => useCheckout(), {
      wrapper: makeWrapper(steps, [], OPEN_TICKETING),
    })

    expect(result.current.findFirstIncompleteStep()).toBeNull()
  })

  // The funnel walks the configs in the order the API sends them, so the
  // position the organizer chose is the position the shopper walks.
  it("keeps a configured buyer step, in the organizer's order", () => {
    const steps = [
      makeStep({ id: "s1", step_type: "tickets" }),
      makeStep({ id: "s2", step_type: "buyer" }),
      makeStep({ id: "s3", step_type: "confirm" }),
    ]

    const { result } = renderHook(() => useCheckout(), {
      wrapper: makeWrapper(steps, [], OPEN_TICKETING),
    })

    expect(result.current.availableSteps).toEqual([
      "passes",
      "buyer",
      "confirm",
    ])
    // Its empty form is still what gates payment.
    expect(result.current.findFirstIncompleteStep()).toBe("buyer")
  })
})

describe("checkoutProvider — step-aware product wiring", () => {
  it("exposes productsByStepId from useStepProductResolver on context", () => {
    const steps = [
      makeStep({
        id: "step-other",
        step_type: "merch",
        product_category: "other",
        template: "merch-image",
      }),
    ]
    const products = [makeProduct({ id: "p1", category: "other" })]

    const { result } = renderHook(() => useCheckout(), {
      wrapper: makeWrapper(steps, products),
    })

    expect(result.current.productsByStepId).toBeDefined()
    const resolved = result.current.productsByStepId.get("step-other")
    expect(resolved).toHaveLength(1)
    expect(resolved![0].id).toBe("p1")
  })

  it("exposes getProductsForStep convenience function on context", () => {
    const step = makeStep({
      id: "step-merch",
      step_type: "merch",
      product_category: "merch",
      template: "merch-image",
    })
    const products = [
      makeProduct({ id: "p1", category: "merch" }),
      makeProduct({ id: "p2", category: "housing" }),
    ]

    const { result } = renderHook(() => useCheckout(), {
      wrapper: makeWrapper([step], products),
    })

    const resolved = result.current.getProductsForStep(step)
    expect(resolved).toHaveLength(1)
    expect(resolved[0].id).toBe("p1")
  })

  it("no longer derives housingProducts/merchProducts/patronProducts from hardcoded categories", () => {
    // With a product that has category="other", the legacy useProductCategories
    // would NOT include it in any of the typed arrays. The provider now exposes
    // allProducts directly for backward-compatible access.
    const steps = [
      makeStep({
        id: "step-merch",
        step_type: "merch",
        product_category: "other",
        template: "merch-image",
      }),
    ]
    const products = [makeProduct({ id: "p1", category: "other" })]

    const { result } = renderHook(() => useCheckout(), {
      wrapper: makeWrapper(steps, products),
    })

    // The resolver correctly resolves the product for the step
    const resolved = result.current.productsByStepId.get("step-merch")
    expect(resolved).toHaveLength(1)
    // allProducts is still accessible for backward compat
    expect(result.current.allProducts).toHaveLength(1)
  })
})

describe("checkoutProvider — public checkout flow propagation", () => {
  it("forwards the named runtime flow to the payment submit hook", () => {
    renderHook(() => useCheckout(), {
      wrapper: makeWrapper([], [], {
        salesFlowSlug: "merch-store",
        submitMode: "open-ticketing",
        submitPopupSlug: "festival-2026",
      }),
    })

    expect(paymentSubmitSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ salesFlowSlug: "merch-store" }),
    )
  })
})

describe("checkoutProvider — Sales Flow checkout boundary", () => {
  const stay = {
    accommodationId: "room-1",
    productId: "room-product",
    name: "Double room",
    propertyId: "property-1",
    propertyName: "Hotel",
    checkIn: "2026-09-01",
    checkOut: "2026-09-03",
    nights: 2,
    guestCount: 1,
    guests: ["Taylor Buyer"],
    subtotal: 100,
    tax: 10,
    totalPrice: 110,
  }

  it("resets stay, buyer, terms and navigation state when the flow changes", async () => {
    cityState.current = { id: "popup-1" }
    let flowId = "flow-main"
    const Wrapper = ({ children }: { children: ReactNode }) => (
      <CheckoutProvider
        configuredStepsOverride={[]}
        productsOverride={[]}
        cartPersistenceEnabled={false}
        salesFlowId={flowId}
      >
        {children}
      </CheckoutProvider>
    )
    const { result, rerender } = renderHook(() => useCheckout(), {
      wrapper: Wrapper,
    })

    act(() => {
      result.current.addAccommodation(stay)
      result.current.setBuyerField("email", "old-flow@example.com")
      result.current.setTermsAccepted(true)
      result.current.markStepVisited("accommodation")
      result.current.goToStep("confirm")
    })
    expect(result.current.cart.accommodations).toHaveLength(1)

    flowId = "flow-partner"
    rerender()

    await waitFor(() => {
      expect(result.current.salesFlowId).toBe("flow-partner")
      expect(result.current.cart.accommodations).toEqual([])
      expect(result.current.buyerValues).toEqual({})
      expect(result.current.termsAccepted).toBe(false)
      expect(result.current.visitedSteps.size).toBe(0)
      expect(result.current.currentStep).toBe("passes")
    })
  })

  it("includes stays in coupon and contribution calculations", async () => {
    cityState.current = {
      id: "popup-1",
      contribution_enabled: true,
      contribution_percentage: 10,
    }
    const { result } = renderHook(() => useCheckout(), {
      wrapper: makeWrapper([], [], {
        salesFlowId: "flow-main",
        validatePromoCodeOverride: async () => 20,
      }),
    })

    act(() => result.current.addAccommodation(stay))
    await act(async () => {
      expect(await result.current.applyPromoCode("STAY20")).toBe(true)
    })

    expect(result.current.summary.accommodationsSubtotal).toBe(110)
    expect(result.current.summary.discountableSubtotal).toBe(110)
    expect(result.current.summary.discount).toBe(22)
    expect(result.current.summary.contributionSubtotal).toBe(8.8)
    expect(result.current.summary.grandTotal).toBe(96.8)
  })
})

// The backoffice live preview renders this exact provider around the real
// checkout. Nothing an operator clicks there may reach the payment provider.
describe("checkoutProvider — preview mode", () => {
  const steps = [
    makeStep({ id: "s1", step_type: "tickets" }),
    makeStep({ id: "s2", step_type: "confirm" }),
  ]
  const products = [makeProduct({ id: "p1", category: "ticket" })]

  it("makes submitPayment inert without touching the purchase endpoint", async () => {
    const purchase = vi
      .spyOn(CheckoutService, "purchaseOpenTicketing")
      .mockResolvedValue({} as never)

    const { result } = renderHook(() => useCheckout(), {
      wrapper: makeWrapper(steps, products, {
        previewMode: true,
        submitMode: "open-ticketing",
        submitPopupSlug: "my-event",
      }),
    })

    let outcome: Awaited<ReturnType<typeof result.current.submitPayment>>
    await act(async () => {
      outcome = await result.current.submitPayment()
    })

    expect(outcome!).toEqual({ success: false, error: "preview" })
    expect(purchase).not.toHaveBeenCalled()

    purchase.mockRestore()
  })

  it("exposes previewMode so the flows can label the CTA", () => {
    const { result } = renderHook(() => useCheckout(), {
      wrapper: makeWrapper(steps, products, { previewMode: true }),
    })

    expect(result.current.previewMode).toBe(true)
  })

  it("is off by default, so a buyer's checkout is unaffected", async () => {
    const { result } = renderHook(() => useCheckout(), {
      wrapper: makeWrapper(steps, products),
    })

    expect(result.current.previewMode).toBe(false)

    let outcome: Awaited<ReturnType<typeof result.current.submitPayment>>
    await act(async () => {
      outcome = await result.current.submitPayment()
    })

    // Blocked for an ordinary reason (empty cart), never the preview guard.
    expect(outcome!.error).not.toBe("preview")
  })
})
