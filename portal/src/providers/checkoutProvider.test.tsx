/**
 * Integration-style tests for checkoutProvider step-aware product wiring.
 * Verifies that the resolver replaces useProductCategories and passes
 * allActiveProducts to cart selection hooks.
 */
import { renderHook } from "@testing-library/react"
import type { ReactNode } from "react"
import { describe, expect, it, vi } from "vitest"
import type { TicketingStepPublic } from "@/client"
import type { ProductsPass } from "@/types/Products"
import { CheckoutProvider, useCheckout } from "./checkoutProvider"

// Minimal mocks to avoid network/provider dependencies
vi.mock("@/providers/applicationProvider", () => ({
  useApplication: () => ({
    getRelevantApplication: () => null,
  }),
}))
vi.mock("@/providers/cityProvider", () => ({
  useCityProvider: () => ({
    getCity: () => null,
  }),
}))
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
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
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
): ({ children }: { children: ReactNode }) => ReactNode {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <CheckoutProvider
        configuredStepsOverride={steps}
        productsOverride={products}
        cartPersistenceEnabled={false}
      >
        {children}
      </CheckoutProvider>
    ) as ReactNode
  }
}

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
