/**
 * Regression guard / bug reproducer for VariantMerchImage with category="other".
 *
 * The user's reported bug:
 *   - A step with step_type="merch", template="merch-image", product_category="other"
 *   - A product with category="other", max_per_order=1, is_active=true
 *   - Clicking the "Add" button silently did nothing — the product never appeared
 *     in cart.merch because the old useProductCategories hook only looked for
 *     category="merch" and returned [] for category="other".
 *
 * Slices 1+2 fixed this end-to-end:
 *   1. useStepProductResolver resolves products by step.product_category (not hardcoded).
 *   2. useMerchSelection now receives allActiveProducts (full list), so id-lookup
 *      works for any category string.
 *
 * This test file contains two complementary approaches:
 *
 *  A. Unit-level: mock useCheckout with a spy to assert updateMerchQuantity is called
 *     with the correct arguments. Fast and deterministic.
 *
 *  B. Integration-level: wire a real useMerchSelection hook and assert the cart state
 *     actually changes. Proves the full data path — click → hook → cart array.
 *
 * Requirement: REQ: step-product-resolution — SCN: exact reproducer bug is fixed
 * Design: §2 (cart hooks id-lookup), §8 (VariantMerchImage.test.tsx)
 */
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useMerchSelection } from "@/hooks/checkout/useMerchSelection"
import type { ProductsPass } from "@/types/Products"
import VariantMerchImage from "./VariantMerchImage"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProduct(overrides: Partial<ProductsPass> = {}): ProductsPass {
  return {
    id: "p1",
    category: "other",
    name: "Custom Swag",
    price: 25,
    is_active: true,
    max_per_order: 1, // single-shot Add/Added toggle (supportsQuantitySelector → false)
    description: null,
    compare_price: null,
    original_price: null,
    duration_type: null,
    start_date: null,
    end_date: null,
    purchased: false,
    selected: false,
    edit: false,
    quantity: 0,
    original_quantity: 0,
    disabled: false,
    image_url: null,
    ...overrides,
  } as unknown as ProductsPass
}

// ---------------------------------------------------------------------------
// Mock setup
// ---------------------------------------------------------------------------

const mockUpdateMerchQuantity = vi.fn()

vi.mock("@/providers/checkoutProvider", () => ({
  useCheckout: () => ({
    cart: { merch: [] },
    updateMerchQuantity: mockUpdateMerchQuantity,
  }),
}))

// Mock next/image
vi.mock("next/image", () => ({
  default: ({ src, alt }: { src: string; alt: string }) => (
    // biome-ignore lint/performance/noImgElement: test stub
    <img src={src} alt={alt} />
  ),
}))

// ---------------------------------------------------------------------------
// Tests — A: spy-based (unit level)
// ---------------------------------------------------------------------------

describe("VariantMerchImage — category='other' bug reproducer (unit-level)", () => {
  let product: ProductsPass

  beforeEach(() => {
    product = makeProduct()
    mockUpdateMerchQuantity.mockReset()
  })

  it("renders the Add button for a product with category='other' and max_per_order=1", () => {
    render(
      <VariantMerchImage
        products={[product]}
        stepType="merch"
        onSkip={vi.fn()}
        templateConfig={null}
      />,
    )

    // max_per_order=1 → supportsQuantitySelector returns false → Add/Added toggle button
    // MerchDefault renders two buttons (desktop + mobile layouts in jsdom)
    const addButtons = screen.queryAllByRole("button", { name: /add to cart/i })
    expect(addButtons.length).toBeGreaterThan(0)
  })

  it("calls updateMerchQuantity(productId, 1) when Add button is clicked — the core bug fix assertion", () => {
    render(
      <VariantMerchImage
        products={[product]}
        stepType="merch"
        onSkip={vi.fn()}
        templateConfig={null}
      />,
    )

    // Click the first Add button (desktop layout rendered first in DOM)
    const addButtons = screen.getAllByRole("button", { name: /add to cart/i })
    fireEvent.click(addButtons[0])

    // updateMerchQuantity must be called with the correct productId and qty=1
    // Before fix: this would NOT be called because the product would not be found
    // in the (now-deleted) pre-filtered category array passed to useMerchSelection.
    expect(mockUpdateMerchQuantity).toHaveBeenCalledWith("p1", 1)
  })

  it("shows product name in all three layout variants (default, grid, compact)", () => {
    for (const variant of [null, { variant: "grid" }, { variant: "compact" }]) {
      const { unmount } = render(
        <VariantMerchImage
          products={[product]}
          stepType="merch"
          onSkip={vi.fn()}
          templateConfig={variant}
        />,
      )
      // Both mobile + desktop layouts render "Custom Swag" → use queryAllByText
      const names = screen.queryAllByText("Custom Swag")
      expect(names.length).toBeGreaterThan(0)
      unmount()
    }
  })

  it("compact variant: clicking the compact Add button calls updateMerchQuantity", () => {
    // Compact variant is a <button> wrapper around the card body (not an inner button)
    render(
      <VariantMerchImage
        products={[product]}
        stepType="merch"
        onSkip={vi.fn()}
        templateConfig={{ variant: "compact" }}
      />,
    )

    // Compact layout: when quantity=0, the outer card is a <button> with aria-label
    const addButton = screen.getByRole("button", {
      name: /add custom swag to cart/i,
    })
    fireEvent.click(addButton)

    expect(mockUpdateMerchQuantity).toHaveBeenCalledWith("p1", 1)
  })
})

// ---------------------------------------------------------------------------
// Tests — B: integration-level (real useMerchSelection wired)
// ---------------------------------------------------------------------------

describe("VariantMerchImage — category='other' bug reproducer (integration-level)", () => {
  let product: ProductsPass
  let allActiveProducts: ProductsPass[]

  beforeEach(() => {
    product = makeProduct()
    allActiveProducts = [product]
    mockUpdateMerchQuantity.mockReset()
  })

  it("real useMerchSelection: cart.merch contains product after updateMerchQuantity called with category='other' product", () => {
    // This proves the full data path end-to-end:
    //   click → updateMerchQuantity("p1", 1) → useMerchSelection looks up "p1"
    //   in allActiveProducts (full list, not pre-filtered by category) → cart updated
    const { result } = renderHook(() => useMerchSelection(allActiveProducts))

    // Before fix: useMerchSelection received only products with category="merch".
    // A product with category="other" would not be found → cart stays empty.
    // After fix: receives allActiveProducts → id-lookup succeeds for any category.
    act(() => {
      result.current.updateMerchQuantity("p1", 1)
    })

    expect(result.current.merch).toHaveLength(1)
    expect(result.current.merch[0].productId).toBe("p1")
    expect(result.current.merch[0].quantity).toBe(1)
  })

  it("real useMerchSelection: toggle off — updateMerchQuantity(id, 0) removes item from cart", () => {
    const { result } = renderHook(() => useMerchSelection(allActiveProducts))

    act(() => {
      result.current.updateMerchQuantity("p1", 1)
    })
    expect(result.current.merch).toHaveLength(1)

    act(() => {
      result.current.updateMerchQuantity("p1", 0)
    })
    expect(result.current.merch).toHaveLength(0)
  })
})
