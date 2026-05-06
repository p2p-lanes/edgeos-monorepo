/**
 * Tests for PatronSection price mode decoupling.
 *
 * RED phase: fails until PatronSection replaces category==="patreon" with
 * resolvePatronPriceMode(stepConfig?.template_config).
 *
 * Requirement: REQ: patron-variable-price-decoupling
 */
import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { TicketingStepPublic } from "@/client"
import type { ProductsPass } from "@/types/Products"
import PatronSection from "./PatronSection"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePatronProduct(overrides: Partial<ProductsPass> = {}): ProductsPass {
  const { id, category, ...rest } = overrides
  return {
    id: id ?? "patron-prod",
    category: category ?? "donations", // NOT "patreon" to test decoupling
    name: "Support Us",
    price: 50,
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

function makeStep(templateConfig: Record<string, unknown> | null): TicketingStepPublic {
  return {
    id: "patron",
    popup_id: "popup-id",
    tenant_id: "tenant-id",
    step_type: "patron",
    title: "Patron",
    description: null,
    order: 0,
    is_enabled: true,
    protected: false,
    product_category: "donations",
    template: "patron-preset",
    template_config: templateConfig,
    watermark: null,
    show_title: true,
    show_watermark: true,
  } as unknown as TicketingStepPublic
}

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockStepConfigs = vi.fn(() => [] as TicketingStepPublic[])
const mockPatronProducts = vi.fn(() => [] as ProductsPass[])

vi.mock("@/providers/checkoutProvider", () => ({
  useCheckout: () => ({
    patronProducts: mockPatronProducts(),
    stepConfigs: mockStepConfigs(),
    cart: { patron: null },
    setPatronAmount: vi.fn(),
    clearPatron: vi.fn(),
  }),
}))

vi.mock("@/providers/cityProvider", () => ({
  useCityProvider: () => ({
    getCity: () => null,
  }),
}))

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PatronSection — price mode decoupling", () => {
  beforeEach(() => {
    mockPatronProducts.mockReset()
    mockStepConfigs.mockReset()
    mockPatronProducts.mockReturnValue([])
    mockStepConfigs.mockReturnValue([])
  })

  it("renders fixed-price toggle UI when template_config.price_mode=fixed", () => {
    const product = makePatronProduct({ category: "donations" })
    const step = makeStep({ price_mode: "fixed" })

    mockPatronProducts.mockReturnValue([product])
    mockStepConfigs.mockReturnValue([step])

    render(<PatronSection />)

    // Fixed price mode shows a Switch toggle, not presets
    // The toggle component renders with role="switch"
    const toggle = screen.queryByRole("switch")
    expect(toggle).not.toBeNull()
  })

  it("renders variable-price presets when template_config.price_mode=variable", () => {
    const product = makePatronProduct({ category: "donations" })
    const step = makeStep({ price_mode: "variable" })

    mockPatronProducts.mockReturnValue([product])
    mockStepConfigs.mockReturnValue([step])

    render(<PatronSection />)

    // Variable price mode shows preset buttons
    // The toggle should NOT be present
    const toggle = screen.queryByRole("switch")
    expect(toggle).toBeNull()
  })

  it("defaults to variable when template_config has no price_mode (backward compat)", () => {
    // Product with category "patreon" — the OLD check would make this variable.
    // The NEW check uses template_config.price_mode, which is absent → variable.
    const product = makePatronProduct({ category: "patreon" })
    const step = makeStep({ presets: [10, 20] }) // no price_mode field

    mockPatronProducts.mockReturnValue([product])
    mockStepConfigs.mockReturnValue([step])

    render(<PatronSection />)

    // Should behave as variable (no toggle)
    const toggle = screen.queryByRole("switch")
    expect(toggle).toBeNull()
  })

  it("shows fixed-price toggle even when product.category is not 'patreon'", () => {
    // This is the KEY test: category !== "patreon" but price_mode="fixed"
    const product = makePatronProduct({ category: "donations" })
    const step = makeStep({ price_mode: "fixed" })

    mockPatronProducts.mockReturnValue([product])
    mockStepConfigs.mockReturnValue([step])

    render(<PatronSection />)

    // Old code: isVariablePrice = product.category === "patreon" → false
    //   → shows fixed toggle (coincidentally correct)
    // New code: resolvePatronPriceMode(stepConfig.template_config) === "variable"
    //   → with price_mode="fixed": isVariablePrice=false → shows toggle
    const toggle = screen.queryByRole("switch")
    expect(toggle).not.toBeNull()
  })
})
