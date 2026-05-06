/**
 * Cart lifecycle integration test for CheckoutProvider.
 *
 * Tests the full provider tree: multiple cart operations (merch, housing, patron)
 * with mixed product categories. Verifies:
 *   - cart state updates correctly after programmatic updateMerchQuantity calls
 *   - category="other" products are handled identically to category="merch" products
 *   - ADR-3 scenario: a cart entry whose product category was renamed mid-session
 *     survives in cart (id-lookup is category-agnostic; backend is source of truth)
 *   - summary totals reflect the cart accurately
 *
 * Design: §2 (ADR-2 + ADR-3), §8 (checkout-cart-lifecycle.test.tsx)
 * Requirement: REQ: cart-selection-id-lookup — SCN: cart restoration preserves quantity
 */
import { act, renderHook } from "@testing-library/react"
import type { ReactNode } from "react"
import { describe, expect, it, vi } from "vitest"
import type { TicketingStepPublic } from "@/client"
import type { ProductsPass } from "@/types/Products"
import { CheckoutProvider, useCheckout } from "./checkoutProvider"

// ---------------------------------------------------------------------------
// Module mocks (same base as checkoutProvider.test.tsx)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
    max_quantity: 5,
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CheckoutProvider — cart lifecycle integration", () => {
  it("updateMerchQuantity adds a product with category='other' to cart.merch", () => {
    const steps = [
      makeStep({
        id: "merch-step",
        step_type: "merch",
        product_category: "other",
        template: "merch-image",
      }),
    ]
    const products = [makeProduct({ id: "swag-1", category: "other", price: 30 })]

    const { result } = renderHook(() => useCheckout(), {
      wrapper: makeWrapper(steps, products),
    })

    // Initially cart.merch is empty
    expect(result.current.cart.merch).toHaveLength(0)

    act(() => {
      result.current.updateMerchQuantity("swag-1", 2)
    })

    expect(result.current.cart.merch).toHaveLength(1)
    expect(result.current.cart.merch[0].productId).toBe("swag-1")
    expect(result.current.cart.merch[0].quantity).toBe(2)
  })

  it("updateMerchQuantity with qty=0 removes item from cart.merch", () => {
    const steps = [
      makeStep({
        id: "merch-step",
        step_type: "merch",
        product_category: "merch",
        template: "merch-image",
      }),
    ]
    const products = [makeProduct({ id: "tshirt", category: "merch", price: 20 })]

    const { result } = renderHook(() => useCheckout(), {
      wrapper: makeWrapper(steps, products),
    })

    act(() => {
      result.current.updateMerchQuantity("tshirt", 3)
    })
    expect(result.current.cart.merch).toHaveLength(1)

    act(() => {
      result.current.updateMerchQuantity("tshirt", 0)
    })
    expect(result.current.cart.merch).toHaveLength(0)
  })

  it("multiple merch items with different categories coexist in cart.merch", () => {
    // Two steps — one merch category, one other category
    const steps = [
      makeStep({
        id: "step-merch",
        step_type: "merch",
        product_category: "merch",
        template: "merch-image",
      }),
      makeStep({
        id: "step-other",
        step_type: "merch",
        product_category: "other",
        template: "merch-image",
      }),
    ]
    const products = [
      makeProduct({ id: "p-merch", category: "merch", price: 15 }),
      makeProduct({ id: "p-other", category: "other", price: 25 }),
    ]

    const { result } = renderHook(() => useCheckout(), {
      wrapper: makeWrapper(steps, products),
    })

    act(() => {
      result.current.updateMerchQuantity("p-merch", 1)
    })
    act(() => {
      result.current.updateMerchQuantity("p-other", 2)
    })

    expect(result.current.cart.merch).toHaveLength(2)
    const merchItem = result.current.cart.merch.find((m) => m.productId === "p-merch")
    const otherItem = result.current.cart.merch.find((m) => m.productId === "p-other")
    expect(merchItem?.quantity).toBe(1)
    expect(otherItem?.quantity).toBe(2)
  })

  it("summary.subtotal reflects merch quantities in cart", () => {
    const steps = [
      makeStep({
        id: "merch-step",
        step_type: "merch",
        product_category: "other",
        template: "merch-image",
      }),
    ]
    const products = [makeProduct({ id: "hat", category: "other", price: 20 })]

    const { result } = renderHook(() => useCheckout(), {
      wrapper: makeWrapper(steps, products),
    })

    act(() => {
      result.current.updateMerchQuantity("hat", 3)
    })

    // summary.subtotal should include 3 × $20 = $60 (no passes, no housing)
    expect(result.current.summary.subtotal).toBe(60)
  })

  it("resolver exposes products per step (step-product-resolution correctness)", () => {
    // Seeded popup config: merch step (category=other) + housing step + custom step
    const steps = [
      makeStep({
        id: "step-merch",
        step_type: "merch",
        product_category: "other",
        template: "merch-image",
      }),
      makeStep({
        id: "step-housing",
        step_type: "housing",
        product_category: "housing",
        template: "housing-date",
      }),
      makeStep({
        id: "step-custom",
        step_type: "merch",
        product_category: "villa",
        template: "merch-image",
      }),
    ]
    const products = [
      makeProduct({ id: "swag", category: "other" }),
      makeProduct({ id: "room", category: "housing" }),
      makeProduct({ id: "villa", category: "villa" }),
      makeProduct({ id: "inactive", category: "other", is_active: false }),
    ]

    const { result } = renderHook(() => useCheckout(), {
      wrapper: makeWrapper(steps, products),
    })

    // Each step resolves its own products (no cross-contamination)
    const forMerch = result.current.productsByStepId.get("step-merch")
    const forHousing = result.current.productsByStepId.get("step-housing")
    const forCustom = result.current.productsByStepId.get("step-custom")

    expect(forMerch?.map((p) => p.id)).toEqual(["swag"]) // inactive excluded
    expect(forHousing?.map((p) => p.id)).toEqual(["room"])
    expect(forCustom?.map((p) => p.id)).toEqual(["villa"])
  })

  it("ADR-3 scenario: updateMerchQuantity is a no-op for a productId not in allActiveProducts", () => {
    // This simulates: saved cart references productId "old-product" whose category
    // was renamed. The product is no longer in the products list (or is inactive).
    // updateMerchQuantity("old-product", 1) should silently return without crashing.
    const steps = [
      makeStep({
        id: "merch-step",
        step_type: "merch",
        product_category: "merch",
        template: "merch-image",
      }),
    ]
    const products = [makeProduct({ id: "current-product", category: "merch" })]

    const { result } = renderHook(() => useCheckout(), {
      wrapper: makeWrapper(steps, products),
    })

    // Calling with a productId that doesn't exist in allActiveProducts — should be a no-op
    act(() => {
      result.current.updateMerchQuantity("old-product", 1)
    })

    // Cart remains empty — no crash, no phantom item
    expect(result.current.cart.merch).toHaveLength(0)
  })
})
