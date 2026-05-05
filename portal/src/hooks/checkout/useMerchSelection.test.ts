/**
 * Tests for useMerchSelection — client-side max_per_order enforcement (task 6.4).
 *
 * TDD phase: includes RED (before implementation) and GREEN validation.
 *
 * Covers:
 *   - updateMerchQuantity clamps to max_per_order when set
 *   - updateMerchQuantity allows unlimited when max_per_order is null
 *   - updateMerchQuantity clamps to total_stock_remaining when max_per_order is null
 *   - updateMerchQuantity clamps to min(max_per_order, total_stock_remaining)
 */

import { act, renderHook } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import type { ProductsPass } from "@/types/Products"
import { useMerchSelection } from "./useMerchSelection"

function makeMerchProduct(
  overrides: Partial<ProductsPass> & { id: string },
): ProductsPass {
  return {
    tenant_id: "tenant-1",
    popup_id: "popup-1",
    slug: overrides.id,
    name: overrides.name ?? "Test Merch",
    price: 50,
    compare_price: null,
    category: "merch",
    is_active: true,
    max_per_order: overrides.max_per_order ?? null,
    total_stock_remaining: overrides.total_stock_remaining ?? null,
    ...overrides,
  } as ProductsPass
}

describe("useMerchSelection — client-side max_per_order cap", () => {
  it("clamps to max_per_order when set and stock is unlimited", () => {
    const product = makeMerchProduct({ id: "merch-1", max_per_order: 2 })
    const { result } = renderHook(() => useMerchSelection([product]))

    act(() => {
      result.current.updateMerchQuantity("merch-1", 10)
    })

    expect(result.current.merch).toHaveLength(1)
    expect(result.current.merch[0]?.quantity).toBe(2)
  })

  it("allows any quantity when max_per_order is null and stock is unlimited", () => {
    const product = makeMerchProduct({
      id: "merch-2",
      max_per_order: null,
      total_stock_remaining: null,
    })
    const { result } = renderHook(() => useMerchSelection([product]))

    act(() => {
      result.current.updateMerchQuantity("merch-2", 100)
    })

    expect(result.current.merch[0]?.quantity).toBe(100)
  })

  it("clamps to total_stock_remaining when max_per_order is null", () => {
    const product = makeMerchProduct({
      id: "merch-3",
      max_per_order: null,
      total_stock_remaining: 3,
    })
    const { result } = renderHook(() => useMerchSelection([product]))

    act(() => {
      result.current.updateMerchQuantity("merch-3", 10)
    })

    expect(result.current.merch[0]?.quantity).toBe(3)
  })

  it("clamps to min(max_per_order, total_stock_remaining) when both are set", () => {
    const product = makeMerchProduct({
      id: "merch-4",
      max_per_order: 5,
      total_stock_remaining: 2,
    })
    const { result } = renderHook(() => useMerchSelection([product]))

    act(() => {
      result.current.updateMerchQuantity("merch-4", 10)
    })

    expect(result.current.merch[0]?.quantity).toBe(2)
  })

  it("removes merch item when quantity is set to 0", () => {
    const product = makeMerchProduct({ id: "merch-5" })
    const { result } = renderHook(() => useMerchSelection([product]))

    act(() => {
      result.current.updateMerchQuantity("merch-5", 1)
    })
    expect(result.current.merch).toHaveLength(1)

    act(() => {
      result.current.updateMerchQuantity("merch-5", 0)
    })
    expect(result.current.merch).toHaveLength(0)
  })
})
