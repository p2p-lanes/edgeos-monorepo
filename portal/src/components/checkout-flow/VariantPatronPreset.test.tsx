/**
 * Tests for VariantPatronPreset price mode (fixed vs. variable).
 *
 * RED phase: fails until VariantPatronPreset reads template_config.price_mode
 * and renders a fixed-price branch (Add button) when price_mode="fixed".
 *
 * Requirement: REQ: patron-variable-price-decoupling (design §5)
 */
import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ProductsPass } from "@/types/Products"
import VariantPatronPreset from "./variants/VariantPatronPreset"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProduct(overrides: Partial<ProductsPass> = {}): ProductsPass {
  const { id, category, ...rest } = overrides
  return {
    id: id ?? "patron-prod",
    category: category ?? "donations",
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

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockCart = vi.fn(() => ({ dynamicItems: {} }))
const mockAddDynamicItem = vi.fn()
const mockRemoveDynamicItem = vi.fn()

vi.mock("@/providers/checkoutProvider", () => ({
  useCheckout: () => ({
    cart: mockCart(),
    addDynamicItem: mockAddDynamicItem,
    removeDynamicItem: mockRemoveDynamicItem,
  }),
}))

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("VariantPatronPreset — price mode", () => {
  beforeEach(() => {
    mockCart.mockReset()
    mockCart.mockReturnValue({ dynamicItems: {} })
    mockAddDynamicItem.mockReset()
    mockRemoveDynamicItem.mockReset()
  })

  it("renders preset buttons when price_mode is not set (default variable mode)", () => {
    const product = makeProduct()

    render(
      <VariantPatronPreset
        products={[product]}
        stepType="patron"
        onSkip={vi.fn()}
        templateConfig={null}
      />,
    )

    // Variable mode shows preset amount buttons (no Add button)
    // PATRON_PRESETS default is [10, 25, 50]
    // There should be multiple preset buttons
    const buttons = screen.queryAllByRole("button")
    // At least one preset button should be visible (e.g. "$10")
    const presetButtons = buttons.filter((b) =>
      /\$\d+/.test(b.textContent ?? ""),
    )
    expect(presetButtons.length).toBeGreaterThan(0)
  })

  it("renders preset buttons when price_mode=variable explicitly", () => {
    const product = makeProduct()

    render(
      <VariantPatronPreset
        products={[product]}
        stepType="patron"
        onSkip={vi.fn()}
        templateConfig={{ price_mode: "variable" }}
      />,
    )

    const buttons = screen.queryAllByRole("button")
    const presetButtons = buttons.filter((b) =>
      /\$\d+/.test(b.textContent ?? ""),
    )
    expect(presetButtons.length).toBeGreaterThan(0)
  })

  it("renders fixed-price Add button when price_mode=fixed", () => {
    const product = makeProduct({ price: 50 })

    render(
      <VariantPatronPreset
        products={[product]}
        stepType="patron"
        onSkip={vi.fn()}
        templateConfig={{ price_mode: "fixed" }}
      />,
    )

    // Fixed mode shows a single "Add" button (or "Remove" if already in cart)
    // at the configured product price — no preset amount buttons
    const addButton = screen.queryByRole("button", { name: /add/i })
    expect(addButton).not.toBeNull()

    // Should NOT show preset buttons (those are for variable mode)
    const buttons = screen.queryAllByRole("button")
    const presetButtons = buttons.filter((b) =>
      /^\$\d+$/.test((b.textContent ?? "").trim()),
    )
    expect(presetButtons.length).toBe(0)
  })

  it("variable mode behavior is identical before and after price_mode changes (parity)", () => {
    const product = makeProduct({ price: 50 })

    // Render with no price_mode
    const { unmount } = render(
      <VariantPatronPreset
        products={[product]}
        stepType="patron"
        onSkip={vi.fn()}
        templateConfig={null}
      />,
    )

    const buttonsWithoutMode = screen.queryAllByRole("button").length
    unmount()

    // Render with explicit price_mode=variable
    render(
      <VariantPatronPreset
        products={[product]}
        stepType="patron"
        onSkip={vi.fn()}
        templateConfig={{ price_mode: "variable" }}
      />,
    )

    const buttonsWithMode = screen.queryAllByRole("button").length

    // Same number of buttons — behavior parity
    expect(buttonsWithoutMode).toBe(buttonsWithMode)
  })
})
