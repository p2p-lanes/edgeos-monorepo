/**
 * Integration-style tests for checkoutProvider step-aware product wiring.
 * Verifies that the resolver replaces useProductCategories and passes
 * allActiveProducts to cart selection hooks.
 */
import { act, renderHook, waitFor } from "@testing-library/react"
import type { ComponentProps, ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  CheckoutService,
  type SalesFlowCheckoutConfig,
  type TicketingStepPublic,
} from "@/client"
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
const queryState = vi.hoisted(() => ({ loading: false, authenticated: false }))
const flowConfigQuerySpy = vi.hoisted(() => vi.fn())
const flowConfigState = vi.hoisted(() => ({
  data: undefined as SalesFlowCheckoutConfig | undefined,
  isError: false,
  isFetching: false,
  refetch: vi.fn(),
}))
const passesDataSpy = vi.hoisted(() =>
  vi.fn(() => ({ products: [], loading: queryState.loading })),
)

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
  SalesFlowsService: { getPortalCheckoutConfig: vi.fn() },
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
  queryState.loading = false
  queryState.authenticated = false
  passesDataSpy.mockClear()
  paymentSubmitSpy.mockClear()
  flowConfigQuerySpy.mockClear()
  flowConfigState.data = undefined
  flowConfigState.isError = false
  flowConfigState.isFetching = false
  flowConfigState.refetch.mockReset()
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
  default: passesDataSpy,
}))
vi.mock("@/hooks/useIsAuthenticated", () => ({
  useIsAuthenticated: () => queryState.authenticated,
}))
vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: { queryKey: string[] }) => {
    if (options.queryKey[0] === "sales-flow-checkout-config") {
      flowConfigQuerySpy(options)
      return { ...flowConfigState }
    }
    return { data: undefined, isLoading: queryState.loading }
  },
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
        checkoutConfigOverride={{}}
        {...extraProps}
      >
        {children}
      </CheckoutProvider>
    ) as ReactNode
  }
}

describe("checkoutProvider override loading", () => {
  it.each([false, true])("uses supplied sources: nonempty=%s", (nonempty) => {
    cityState.current = { id: "popup-1" }
    queryState.authenticated = true
    queryState.loading = true
    const products = nonempty
      ? [makeProduct({ id: "p1", category: "ticket" })]
      : []
    const props: Partial<ComponentProps<typeof CheckoutProvider>> = {
      salesFlowId: "flow-1",
      productsOverride: products,
      configuredStepsOverride: [],
    }
    const { result, rerender } = renderHook(() => useCheckout(), {
      wrapper: makeWrapper([], [], props),
    })
    expect(result.current.allProducts).toEqual(products)
    expect(result.current.isInitialLoading).toBe(false)
    expect(passesDataSpy).toHaveBeenLastCalledWith("flow-1", false)

    props.productsOverride = undefined
    rerender()
    expect(passesDataSpy).toHaveBeenLastCalledWith("flow-1", true)
    expect(result.current.isInitialLoading).toBe(true)
    props.productsOverride = products
    props.configuredStepsOverride = undefined
    rerender()
    expect(result.current.isInitialLoading).toBe(true)
  })
})

describe("checkoutProvider — checkout config readiness", () => {
  const stay = {
    accommodationId: "room-1",
    productId: "room-product",
    name: "Room",
    propertyId: "property-1",
    propertyName: "Hotel",
    checkIn: "2026-09-01",
    checkOut: "2026-09-02",
    nights: 1,
    guestCount: 1,
    guests: [{ name: "Buyer", answers: {} }],
    bookerAnswers: {},
    guestForm: null,
    subtotal: 100,
    tax: 0,
    totalPrice: 100,
  }
  const props = {
    salesFlowId: "flow-1",
    checkoutConfigOverride: undefined,
  }

  beforeEach(() => {
    cityState.current = { id: "popup-1" }
    queryState.authenticated = true
  })

  function underlyingSubmit() {
    return paymentSubmitSpy.mock.results.at(-1)!.value.submitPayment
  }

  it("waits for settings even when products and steps are already loaded", async () => {
    flowConfigState.isFetching = true
    const { result } = renderHook(() => useCheckout(), {
      wrapper: makeWrapper([], [], props),
    })

    expect(result.current.flowConfig).toBeNull()
    expect(result.current.isInitialLoading).toBe(true)
    expect(result.current.flowConfigError).toBeNull()
    expect(await result.current.submitPayment()).toEqual({
      success: false,
      error: "checkout.config_loading",
    })
    expect(underlyingSubmit()).not.toHaveBeenCalled()
  })

  it("surfaces a failed settings request and blocks direct payment calls", async () => {
    flowConfigState.isError = true
    const { result } = renderHook(() => useCheckout(), {
      wrapper: makeWrapper([], [], props),
    })

    expect(result.current.isInitialLoading).toBe(false)
    expect(result.current.flowConfigError).toBe("checkout.config_load_error")
    expect(result.current.error).toBe("checkout.config_load_error")
    expect(await result.current.submitPayment()).toEqual({
      success: false,
      error: "checkout.config_load_error",
    })
    expect(underlyingSubmit()).not.toHaveBeenCalled()
  })

  it("only enables payment after a retry has loaded the real contribution", async () => {
    flowConfigState.isError = true
    const { result, rerender } = renderHook(() => useCheckout(), {
      wrapper: makeWrapper([], [], props),
    })
    act(() => result.current.addAccommodation(stay))
    const blockedSubmit = underlyingSubmit()
    await result.current.submitPayment()
    expect(blockedSubmit).not.toHaveBeenCalled()

    act(() => result.current.retryFlowConfig())
    expect(flowConfigState.refetch).toHaveBeenCalledOnce()
    // React Query retains the error status while the retry is fetching.
    flowConfigState.isFetching = true
    rerender()
    expect(result.current.isInitialLoading).toBe(true)
    await result.current.submitPayment()
    expect(underlyingSubmit()).not.toHaveBeenCalled()

    flowConfigState.data = {
      contribution_enabled: true,
      contribution_percentage: "10",
    }
    flowConfigState.isError = false
    flowConfigState.isFetching = false
    rerender()
    expect(result.current.isInitialLoading).toBe(false)
    expect(result.current.flowConfigError).toBeNull()
    expect(result.current.error).toBeNull()
    expect(result.current.summary.contributionSubtotal).toBe(10)
    expect(result.current.summary.grandTotal).toBe(110)
    const resolvedSubmit = underlyingSubmit()
    await result.current.submitPayment()
    expect(resolvedSubmit).toHaveBeenCalledOnce()
  })

  it("allows a successfully loaded config with every option disabled", async () => {
    flowConfigState.data = {
      allows_coupons: false,
      insurance_enabled: false,
      contribution_enabled: false,
    }
    const { result } = renderHook(() => useCheckout(), {
      wrapper: makeWrapper([], [], props),
    })

    expect(result.current.isInitialLoading).toBe(false)
    expect(result.current.flowConfigError).toBeNull()
    expect(result.current.summary.contributionSubtotal).toBe(0)
    await result.current.submitPayment()
    expect(underlyingSubmit()).toHaveBeenCalledOnce()
  })

  it("uses a supplied runtime config without waiting for the disabled query", async () => {
    flowConfigState.isFetching = true
    flowConfigState.isError = true
    const config = { contribution_enabled: true, contribution_percentage: "10" }
    const { result } = renderHook(() => useCheckout(), {
      wrapper: makeWrapper([], [], {
        ...props,
        checkoutConfigOverride: config,
      }),
    })
    act(() => result.current.addAccommodation(stay))

    expect(flowConfigQuerySpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ enabled: false }),
    )
    expect(result.current.isInitialLoading).toBe(false)
    expect(result.current.flowConfigError).toBeNull()
    expect(result.current.summary.grandTotal).toBe(110)
    await result.current.submitPayment()
    expect(underlyingSubmit()).toHaveBeenCalledOnce()
  })

  it("blocks a public runtime with a missing config rather than treating it as off", async () => {
    const { result } = renderHook(() => useCheckout(), {
      wrapper: makeWrapper([], [], { ...props, checkoutConfigOverride: null }),
    })

    expect(result.current.flowConfigError).toBe("checkout.config_load_error")
    await result.current.submitPayment()
    expect(underlyingSubmit()).not.toHaveBeenCalled()
  })

  it("keeps preview submission inert when no config has loaded", async () => {
    const { result } = renderHook(() => useCheckout(), {
      wrapper: makeWrapper([], [], { ...props, previewMode: true }),
    })

    expect(await result.current.submitPayment()).toEqual({
      success: false,
      error: "preview",
    })
  })

  it("blocks again when the selected flow has no cached settings", async () => {
    const selectedProps = { ...props }
    flowConfigState.data = { contribution_enabled: false }
    const { result, rerender } = renderHook(() => useCheckout(), {
      wrapper: makeWrapper([], [], selectedProps),
    })
    expect(result.current.isInitialLoading).toBe(false)

    selectedProps.salesFlowId = "flow-2"
    flowConfigState.data = undefined
    flowConfigState.isFetching = true
    rerender()
    expect(result.current.isInitialLoading).toBe(true)
    expect(flowConfigQuerySpy).toHaveBeenLastCalledWith(
      expect.objectContaining({
        queryKey: ["sales-flow-checkout-config", "popup-1", "flow-2"],
      }),
    )
    await result.current.submitPayment()
    expect(underlyingSubmit()).not.toHaveBeenCalled()
  })
})

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

describe("checkoutProvider — entry-link coupons", () => {
  const products = [
    makeProduct({ id: "p1", category: "merch" }),
    makeProduct({ id: "excluded", category: "merch", discountable: false }),
  ]

  beforeEach(() => localStorage.clear())

  it("applies an entry coupon after open-cart restoration and release settle", async () => {
    cityState.current = { id: "popup-1" }
    const validate = vi.fn().mockResolvedValue(20)
    const { result } = renderHook(() => useCheckout(), {
      wrapper: makeWrapper([], products, {
        checkoutConfigOverride: { allows_coupons: true },
        salesFlowId: "flow-friends",
        salesFlowSlug: "friends",
        submitMode: "open-ticketing",
        submitPopupSlug: "festival",
        openCartPopupSlug: "festival",
        initialPromoCode: " friends20 ",
        validatePromoCodeOverride: validate,
      }),
      reactStrictMode: true,
    })

    await waitFor(() =>
      expect(validate).toHaveBeenCalledExactlyOnceWith("FRIENDS20"),
    )
    await waitFor(() => expect(result.current.cart.promoCodeValid).toBe(true))
    expect(result.current.cart.promoCode).toBe("FRIENDS20")
    expect(validate).toHaveBeenCalledExactlyOnceWith("FRIENDS20")

    // Selecting an excluded product first must not discard the link code.
    act(() => result.current.updateMerchQuantity("excluded", 1))
    expect(result.current.cart.promoCodeValid).toBe(true)
    expect(result.current.summary.discount).toBe(0)
    act(() => result.current.updateMerchQuantity("p1", 1))
    expect(result.current.summary.discount).toBe(2)
    expect(result.current.summary.grandTotal).toBe(18)
    act(() => result.current.updateMerchQuantity("p1", 0))
    expect(result.current.cart.promoCode).toBe("FRIENDS20")
    expect(result.current.summary.discount).toBe(0)
    expect(validate).toHaveBeenCalledTimes(1)
  })

  it.each([
    "disabled",
    "zero-discount",
    "rejected",
  ])("keeps normal checkout totals without an error for a %s URL coupon", async (reason) => {
    cityState.current = { id: "popup-1" }
    const validate = vi.fn().mockResolvedValue(0)
    if (reason === "rejected") validate.mockRejectedValue({ status: 400 })
    const { result } = renderHook(() => useCheckout(), {
      wrapper: makeWrapper([], products, {
        checkoutConfigOverride: { allows_coupons: reason !== "disabled" },
        salesFlowId: "flow-friends",
        salesFlowSlug: "friends",
        submitMode: "open-ticketing",
        submitPopupSlug: "festival",
        openCartPopupSlug: "festival",
        initialPromoCode: "INVALID",
        validatePromoCodeOverride: validate,
      }),
      reactStrictMode: true,
    })
    await act(async () => {})
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(validate).toHaveBeenCalledTimes(reason === "disabled" ? 0 : 1)
    act(() => result.current.updateMerchQuantity("p1", 1))
    expect(result.current.cart.promoCode).toBe("")
    expect(result.current.cart.promoCodeValid).toBe(false)
    expect(result.current.error).toBeNull()
    expect(result.current.summary.discount).toBe(0)
    expect(result.current.summary.grandTotal).toBe(10)
  })

  it("waits for signed cart recovery and release before replacing a saved coupon", async () => {
    cityState.current = { id: "popup-1" }
    let resolveRestore!: (value: unknown) => void
    let resolveRelease!: (value: { released: boolean }) => void
    vi.mocked(CheckoutService.restoreFlowCart).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveRestore = resolve
      }) as never,
    )
    vi.mocked(CheckoutService.releasePendingOpen).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveRelease = resolve
      }) as never,
    )
    const validate = vi.fn().mockResolvedValue(20)
    const { result } = renderHook(() => useCheckout(), {
      wrapper: makeWrapper([], products, {
        checkoutConfigOverride: { allows_coupons: true },
        salesFlowId: "flow-friends",
        salesFlowSlug: "friends",
        submitMode: "open-ticketing",
        submitPopupSlug: "festival",
        openCartPopupSlug: "festival",
        openCartCid: "cart-id",
        openCartSig: "test-proof",
        initialBuyerValues: { email: "buyer@example.com" },
        initialPromoCode: "FRIENDS20",
        validatePromoCodeOverride: validate,
      }),
    })
    expect(validate).not.toHaveBeenCalled()

    await act(async () =>
      resolveRestore({
        id: "cart-id",
        restore_token: "test-proof",
        items: {
          lines: [],
          recipients: [],
          promo_code: "SAVED10",
          insurance: false,
          current_step: null,
        },
      }),
    )
    expect(CheckoutService.releasePendingOpen).toHaveBeenCalledWith({
      slug: "festival",
      flowSlug: "friends",
      requestBody: {
        cid: "cart-id",
        sig: "test-proof",
        email: "buyer@example.com",
      },
    })
    expect(validate).not.toHaveBeenCalled()

    await act(async () => resolveRelease({ released: false }))
    await waitFor(() => expect(result.current.cart.promoCodeValid).toBe(true))
    expect(result.current.cart.promoCode).toBe("FRIENDS20")
    expect(validate).toHaveBeenCalledExactlyOnceWith("FRIENDS20")
  })

  it.each([
    { allowsCoupons: false, previewMode: false },
    { allowsCoupons: true, previewMode: true },
  ])("ignores entry coupons when disabled or previewing: %o", async ({
    allowsCoupons,
    previewMode,
  }) => {
    // The popup's stale column says yes; only the flow's answer counts.
    cityState.current = { id: "popup-1", allows_coupons: true }
    const validate = vi.fn().mockResolvedValue(20)
    const { result } = renderHook(() => useCheckout(), {
      wrapper: makeWrapper([], products, {
        checkoutConfigOverride: { allows_coupons: allowsCoupons },
        salesFlowId: "flow-friends",
        salesFlowSlug: "friends",
        submitMode: "open-ticketing",
        submitPopupSlug: "festival",
        openCartPopupSlug: "festival",
        initialPromoCode: "FRIENDS20",
        validatePromoCodeOverride: validate,
        previewMode,
      }),
    })

    await act(async () => {})
    expect(result.current.cart.promoCodeValid).toBe(false)
    expect(validate).not.toHaveBeenCalled()
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
    guests: [{ name: "Taylor Buyer", answers: {} }],
    bookerAnswers: {},
    guestForm: null,
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
    cityState.current = { id: "popup-1" }
    const { result } = renderHook(() => useCheckout(), {
      wrapper: makeWrapper([], [], {
        checkoutConfigOverride: {
          contribution_enabled: true,
          contribution_percentage: "10",
        },
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

  it("charges no contribution the flow has turned off, whatever the popup says", async () => {
    cityState.current = {
      id: "popup-1",
      contribution_enabled: true,
      contribution_percentage: 10,
    }
    const { result } = renderHook(() => useCheckout(), {
      wrapper: makeWrapper([], [], {
        checkoutConfigOverride: { contribution_enabled: false },
        salesFlowId: "flow-main",
      }),
    })

    act(() => result.current.addAccommodation(stay))

    expect(result.current.summary.contributionSubtotal).toBe(0)
    expect(result.current.summary.grandTotal).toBe(110)
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
