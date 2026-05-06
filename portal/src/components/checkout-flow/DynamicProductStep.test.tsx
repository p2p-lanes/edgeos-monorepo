/**
 * Unit tests for DynamicProductStep.
 *
 * RED phase: these tests fail until the component is updated to:
 * 1. Use getProductsForStep() from context instead of inline filter.
 * 2. Render an explicit error state when template is null on a non-ticket step.
 * 3. Handle step.product_category === null silently (no error, renders empty state).
 * 4. Render "other" category products correctly (bug reproducer).
 */
import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { TicketingStepPublic } from "@/client"
import type { ProductsPass } from "@/types/Products"
import DynamicProductStep from "./DynamicProductStep"

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
    ...overrides,
  } as TicketingStepPublic
}

function makeProduct(overrides: Partial<ProductsPass>): ProductsPass {
  const { id, category, ...rest } = overrides
  return {
    id: id ?? "prod-1",
    category: category ?? "merch",
    name: "Product",
    price: 10,
    is_active: true,
    max_quantity: 1,
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
    ...rest,
  } as unknown as ProductsPass
}

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Single top-level mock for checkoutProvider — override getProductsForStep per test.
const mockGetProductsForStep = vi.fn(() => [] as ProductsPass[])

vi.mock("@/providers/checkoutProvider", () => ({
  useCheckout: () => ({
    getProductsForStep: mockGetProductsForStep,
    allProducts: [],
  }),
}))

// Mock the variant components so tests don't need to render full UI trees.
vi.mock("./variants/VariantMerchImage", () => ({
  default: ({ products }: { products: ProductsPass[] }) => (
    <div data-testid="variant-merch-image">
      {products.map((p) => (
        <span key={p.id}>{p.name}</span>
      ))}
    </div>
  ),
}))

vi.mock("./variants/VariantYouTubeVideo", () => ({
  default: () => <div data-testid="variant-youtube" />,
}))

vi.mock("./variants/VariantFaqs", () => ({
  default: () => <div data-testid="variant-faqs" />,
}))

vi.mock("./variants/VariantHousingDate", () => ({
  default: ({ products }: { products: ProductsPass[] }) => (
    <div data-testid="variant-housing">
      {products.map((p) => (
        <span key={p.id}>{p.name}</span>
      ))}
    </div>
  ),
}))

vi.mock("./variants/VariantPatronPreset", () => ({
  default: ({ products }: { products: ProductsPass[] }) => (
    <div data-testid="variant-patron">
      {products.map((p) => (
        <span key={p.id}>{p.name}</span>
      ))}
    </div>
  ),
}))

vi.mock("./variants/VariantTicketSelect", () => ({
  default: ({ products }: { products: ProductsPass[] }) => (
    <div data-testid="variant-ticket-select">
      {products.map((p) => (
        <span key={p.id}>{p.name}</span>
      ))}
    </div>
  ),
}))

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DynamicProductStep", () => {
  beforeEach(() => {
    mockGetProductsForStep.mockReset()
    mockGetProductsForStep.mockReturnValue([])
  })

  describe("uses getProductsForStep from context (resolver integration)", () => {
    it("renders the variant with products returned by getProductsForStep", () => {
      const product = makeProduct({ id: "p1", category: "other", name: "Swag" })
      mockGetProductsForStep.mockReturnValue([product])

      const step = makeStep({
        step_type: "merch",
        template: "merch-image",
        product_category: "other",
      })

      render(<DynamicProductStep stepConfig={step} onSkip={vi.fn()} />)

      expect(screen.queryByTestId("variant-merch-image")).not.toBeNull()
      expect(screen.queryByText("Swag")).not.toBeNull()
    })
  })

  describe("null product_category (non-content, non-confirm step)", () => {
    it("renders empty state silently when product_category is null", () => {
      // resolver returns [] for null category steps
      mockGetProductsForStep.mockReturnValue([])

      const step = makeStep({
        step_type: "merch",
        template: "merch-image",
        product_category: null,
      })

      render(<DynamicProductStep stepConfig={step} onSkip={vi.fn()} />)

      // Should render empty / continue state, NOT a configuration error
      expect(screen.queryByText(/no products available/i)).not.toBeNull()
      // Must NOT show "Step configuration error"
      expect(screen.queryByText(/step configuration error/i)).toBeNull()
    })
  })

  describe("null template on non-ticket step (misconfiguration error state)", () => {
    it("renders explicit error state when template is null for a product step", () => {
      const product = makeProduct({ id: "p1", category: "merch" })
      mockGetProductsForStep.mockReturnValue([product])

      const step = makeStep({
        step_type: "merch",
        template: null, // misconfigured — no template assigned
        product_category: "merch",
      })

      render(<DynamicProductStep stepConfig={step} onSkip={vi.fn()} />)

      // Should show "Step configuration error." (design §6)
      expect(screen.queryByText(/step configuration error/i)).not.toBeNull()
      expect(screen.queryByText(/no template assigned/i)).not.toBeNull()
    })
  })

  describe("category=other bug reproducer", () => {
    it("renders merch-image variant for product with category=other", () => {
      const product = makeProduct({
        id: "p1",
        category: "other",
        name: "Custom Item",
      })
      mockGetProductsForStep.mockReturnValue([product])

      const step = makeStep({
        step_type: "merch",
        template: "merch-image",
        product_category: "other",
      })

      render(<DynamicProductStep stepConfig={step} onSkip={vi.fn()} />)

      expect(screen.queryByTestId("variant-merch-image")).not.toBeNull()
      expect(screen.queryByText("Custom Item")).not.toBeNull()
    })
  })

  describe("content-only templates", () => {
    it("renders youtube-video variant regardless of product count", () => {
      // resolver returns [] for content-only steps
      mockGetProductsForStep.mockReturnValue([])

      const step = makeStep({
        step_type: "youtube",
        template: "youtube-video",
        product_category: null,
      })

      render(<DynamicProductStep stepConfig={step} onSkip={vi.fn()} />)

      expect(screen.queryByTestId("variant-youtube")).not.toBeNull()
    })
  })
})
