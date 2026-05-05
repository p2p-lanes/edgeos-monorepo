/**
 * Tests for QuantitySelector helpers — product-inventory-redesign, Slice 4 / Phase 6.2
 *
 * TDD phase: RED — written BEFORE the implementation change.
 *
 * Covers:
 *   6.2 resolveMaxQuantity: cap = min(max_per_order, total_stock_remaining)
 *   - max_per_order cap is respected
 *   - total_stock_remaining cap is respected
 *   - both NULL means unlimited (POSITIVE_INFINITY)
 *   - only max_per_order NULL: capped by total_stock_remaining
 *   - only total_stock_remaining NULL: capped by max_per_order
 *   - min(both) when both are set
 *   - dayPassFallbackToDateRange still works when both stock fields are NULL
 *   supportsQuantitySelector: driven by max_per_order
 */

import { describe, expect, it } from "vitest"
import {
  resolveMaxQuantity,
  supportsQuantitySelector,
} from "./QuantitySelector"

// ---------------------------------------------------------------------------
// resolveMaxQuantity
// ---------------------------------------------------------------------------

describe("resolveMaxQuantity — new stock cap split", () => {
  it("returns max_per_order when total_stock_remaining is null (unlimited stock)", () => {
    expect(
      resolveMaxQuantity({
        max_per_order: 3,
        total_stock_remaining: null,
      }),
    ).toBe(3)
  })

  it("returns total_stock_remaining when max_per_order is null (no per-order cap)", () => {
    expect(
      resolveMaxQuantity({
        max_per_order: null,
        total_stock_remaining: 5,
      }),
    ).toBe(5)
  })

  it("returns min(max_per_order, total_stock_remaining) when both are set — max_per_order is smaller", () => {
    expect(
      resolveMaxQuantity({
        max_per_order: 2,
        total_stock_remaining: 10,
      }),
    ).toBe(2)
  })

  it("returns min(max_per_order, total_stock_remaining) when both are set — total_stock_remaining is smaller", () => {
    expect(
      resolveMaxQuantity({
        max_per_order: 5,
        total_stock_remaining: 1,
      }),
    ).toBe(1)
  })

  it("returns POSITIVE_INFINITY when both are null (truly unlimited)", () => {
    expect(
      resolveMaxQuantity({
        max_per_order: null,
        total_stock_remaining: null,
      }),
    ).toBe(Number.POSITIVE_INFINITY)
  })

  it("returns POSITIVE_INFINITY when neither field is provided", () => {
    expect(resolveMaxQuantity({})).toBe(Number.POSITIVE_INFINITY)
  })

  it("dayPassFallbackToDateRange still works when stock fields are null", () => {
    const result = resolveMaxQuantity(
      {
        max_per_order: null,
        total_stock_remaining: null,
        start_date: "2026-01-01",
        end_date: "2026-01-03",
      },
      { dayPassFallbackToDateRange: true },
    )
    // 3 days inclusive (Jan 1, 2, 3)
    expect(result).toBe(3)
  })

  it("max_per_order cap wins over dayPass fallback when max_per_order < date range", () => {
    // 3-day range, but max_per_order = 2 — cap should be 2
    const result = resolveMaxQuantity(
      {
        max_per_order: 2,
        total_stock_remaining: null,
        start_date: "2026-01-01",
        end_date: "2026-01-03",
      },
      { dayPassFallbackToDateRange: true },
    )
    expect(result).toBe(2)
  })

  it("stock_remaining cap wins over dayPass fallback when stock is lower", () => {
    const result = resolveMaxQuantity(
      {
        max_per_order: null,
        total_stock_remaining: 1,
        start_date: "2026-01-01",
        end_date: "2026-01-10",
      },
      { dayPassFallbackToDateRange: true },
    )
    expect(result).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// supportsQuantitySelector
// ---------------------------------------------------------------------------

describe("supportsQuantitySelector — driven by max_per_order", () => {
  it("returns true when max_per_order is null (unlimited)", () => {
    expect(supportsQuantitySelector(null)).toBe(true)
  })

  it("returns true when max_per_order is undefined", () => {
    expect(supportsQuantitySelector(undefined)).toBe(true)
  })

  it("returns true when max_per_order > 1", () => {
    expect(supportsQuantitySelector(5)).toBe(true)
  })

  it("returns false when max_per_order === 1 (toggle, not stepper)", () => {
    expect(supportsQuantitySelector(1)).toBe(false)
  })
})
