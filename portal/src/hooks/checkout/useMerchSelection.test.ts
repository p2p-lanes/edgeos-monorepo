/**
 * Tests for useMerchSelection — combines:
 *  - Client-side max_per_order / total_stock_remaining clamping (from product-inventory-redesign).
 *  - Id-lookup against the full active product list, irrespective of `category`,
 *    so step.product_category gating decides what is shown rather than a
 *    hardcoded merch filter (from ticketing-steps-product-resolution).
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

  it("refuses to add a sold-out product (cap set, remaining=0)", () => {
    const product = makeMerchProduct({
      id: "merch-sold",
      total_stock_cap: 1,
      total_stock_remaining: 0,
    })
    const { result } = renderHook(() => useMerchSelection([product]))

    act(() => {
      result.current.updateMerchQuantity("merch-sold", 1)
    })

    expect(result.current.merch).toHaveLength(0)
  })
})

describe("useMerchSelection — id-lookup against full active product list", () => {
  it("resolves product with arbitrary category via id from full list", () => {
    const allActiveProducts = [
      makeMerchProduct({ id: "p1", category: "other" }),
      makeMerchProduct({ id: "p2", category: "merch" }),
    ]
    const { result } = renderHook(() => useMerchSelection(allActiveProducts))

    act(() => {
      result.current.updateMerchQuantity("p1", 1)
    })

    expect(result.current.merch).toHaveLength(1)
    expect(result.current.merch[0].productId).toBe("p1")
    expect(result.current.merch[0].quantity).toBe(1)
  })

  it("returns without updating cart when productId is unknown (graceful)", () => {
    const allActiveProducts = [makeMerchProduct({ id: "p1" })]
    const { result } = renderHook(() => useMerchSelection(allActiveProducts))

    act(() => {
      result.current.updateMerchQuantity("nonexistent-id", 1)
    })

    expect(result.current.merch).toHaveLength(0)
  })

  it("updates quantity and totalPrice for an existing cart item", () => {
    const allActiveProducts = [makeMerchProduct({ id: "p1", price: 5 })]
    const { result } = renderHook(() => useMerchSelection(allActiveProducts))

    act(() => {
      result.current.updateMerchQuantity("p1", 1)
    })
    act(() => {
      result.current.updateMerchQuantity("p1", 3)
    })

    expect(result.current.merch[0].quantity).toBe(3)
    expect(result.current.merch[0].totalPrice).toBe(15)
  })
})
