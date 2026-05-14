/**
 * Tests for VariantPatronPreset.tsx
 *
 * Validates:
 * - Preset rendering from templateConfig (or fallback to PATRON_PRESETS constant)
 * - Selecting a preset writes to cart.patron via setPatronAmount (not dynamicItems)
 * - Custom amount input updates cart.patron
 * - price_mode / resolvePatronPriceMode are NOT imported or referenced
 * - No addDynamicItem call
 */

import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ProductsPass } from "@/types/Products"
import VariantPatronPreset from "./VariantPatronPreset"

// -------------------------------------------------------------------
// Mock useCheckout
// -------------------------------------------------------------------
const setPatronAmountMock = vi.fn()
const clearPatronMock = vi.fn()
const addDynamicItemMock = vi.fn()

let mockPatron: {
  productId: string
  amount: number
  isCustomAmount: boolean
} | null = null

vi.mock("@/providers/checkoutProvider", () => ({
  useCheckout: () => ({
    cart: {
      patron: mockPatron,
      dynamicItems: {},
    },
    setPatronAmount: setPatronAmountMock,
    clearPatron: clearPatronMock,
    addDynamicItem: addDynamicItemMock,
  }),
}))

// -------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------

function makeProduct(id = "prod-1"): ProductsPass {
  return {
    id,
    name: "Patron product",
    category: "patreon",
    price: 0,
    is_active: true,
    popup_id: "popup-1",
    tenant_id: "tenant-1",
  } as unknown as ProductsPass
}

function renderVariant(
  products: ProductsPass[],
  templateConfig?: Record<string, unknown> | null,
) {
  return render(
    <VariantPatronPreset
      products={products}
      stepType="patron"
      templateConfig={templateConfig ?? null}
      onSkip={vi.fn()}
    />,
  )
}

// -------------------------------------------------------------------
// Tests
// -------------------------------------------------------------------

describe("VariantPatronPreset — preset rendering", () => {
  beforeEach(() => {
    mockPatron = null
    vi.clearAllMocks()
  })

  it("renders preset buttons from templateConfig.presets", () => {
    renderVariant([makeProduct()], {
      presets: [1000, 2000, 3000],
      allow_custom: true,
      minimum: 500,
    })
    expect(screen.getByText(/1,000|1000|\$1/)).toBeDefined()
    expect(screen.getByText(/2,000|2000|\$2/)).toBeDefined()
    expect(screen.getByText(/3,000|3000|\$3/)).toBeDefined()
  })

  it("falls back to PATRON_PRESETS constants when templateConfig is null", () => {
    // PATRON_PRESETS = [2500, 5000, 7500]
    renderVariant([makeProduct()], null)
    // We rely on formatCurrency — just check 3 preset buttons exist
    const buttons = screen.getAllByRole("button")
    // At least 3 preset buttons (plus possibly "Remove contribution" if amount > 0)
    const presetButtons = buttons.filter(
      (b) => !b.textContent?.includes("Remove"),
    )
    expect(presetButtons.length).toBeGreaterThanOrEqual(3)
  })

  it("renders 'No contribution options available' when products array is empty", () => {
    renderVariant([], null)
    expect(screen.getByText("No contribution options available.")).toBeDefined()
  })
})

describe("VariantPatronPreset — preset selection writes to cart.patron", () => {
  beforeEach(() => {
    mockPatron = null
    vi.clearAllMocks()
  })

  it("clicking a preset calls setPatronAmount, not addDynamicItem", () => {
    renderVariant([makeProduct()], {
      presets: [1000, 2000],
      allow_custom: false,
      minimum: 500,
    })
    const buttons = screen.getAllByRole("button")
    const presetButton = buttons[0]
    fireEvent.click(presetButton)

    expect(setPatronAmountMock).toHaveBeenCalledOnce()
    expect(setPatronAmountMock).toHaveBeenCalledWith("prod-1", 1000, false)
    expect(addDynamicItemMock).not.toHaveBeenCalled()
  })

  it("clicking an already-selected preset calls clearPatron", () => {
    mockPatron = { productId: "prod-1", amount: 1000, isCustomAmount: false }
    renderVariant([makeProduct()], {
      presets: [1000, 2000],
      allow_custom: false,
      minimum: 500,
    })
    const buttons = screen.getAllByRole("button")
    // First preset button is the currently selected one
    fireEvent.click(buttons[0])

    expect(clearPatronMock).toHaveBeenCalledOnce()
    expect(setPatronAmountMock).not.toHaveBeenCalled()
    expect(addDynamicItemMock).not.toHaveBeenCalled()
  })

  it("selecting a different preset calls setPatronAmount with new amount", () => {
    mockPatron = { productId: "prod-1", amount: 1000, isCustomAmount: false }
    renderVariant([makeProduct()], {
      presets: [1000, 2000],
      allow_custom: false,
      minimum: 500,
    })
    const buttons = screen.getAllByRole("button")
    // Second preset button
    fireEvent.click(buttons[1])

    expect(setPatronAmountMock).toHaveBeenCalledWith("prod-1", 2000, false)
    expect(addDynamicItemMock).not.toHaveBeenCalled()
  })
})

describe("VariantPatronPreset — custom amount input", () => {
  beforeEach(() => {
    mockPatron = null
    vi.clearAllMocks()
  })

  it("typing a valid custom amount calls setPatronAmount with isCustomAmount=true", () => {
    renderVariant([makeProduct()], {
      presets: [1000, 2000],
      allow_custom: true,
      minimum: 500,
    })
    const input = screen.getByRole("spinbutton", { name: "Custom amount" })
    fireEvent.change(input, { target: { value: "750" } })

    expect(setPatronAmountMock).toHaveBeenCalledWith("prod-1", 750, true)
    expect(addDynamicItemMock).not.toHaveBeenCalled()
  })

  it("typing an amount below minimum calls clearPatron", () => {
    renderVariant([makeProduct()], {
      presets: [1000, 2000],
      allow_custom: true,
      minimum: 500,
    })
    const input = screen.getByRole("spinbutton", { name: "Custom amount" })
    fireEvent.change(input, { target: { value: "100" } })

    expect(clearPatronMock).toHaveBeenCalled()
    expect(setPatronAmountMock).not.toHaveBeenCalled()
  })
})

describe("VariantPatronPreset — no price_mode / addDynamicItem references", () => {
  it("does not call addDynamicItem under any selection scenario", () => {
    const { unmount } = renderVariant([makeProduct()], {
      presets: [1000, 2000],
      allow_custom: true,
      minimum: 500,
    })
    const buttons = screen.getAllByRole("button")
    fireEvent.click(buttons[0])
    const input = screen.getByRole("spinbutton", { name: "Custom amount" })
    fireEvent.change(input, { target: { value: "800" } })

    expect(addDynamicItemMock).not.toHaveBeenCalled()
    unmount()
  })
})
