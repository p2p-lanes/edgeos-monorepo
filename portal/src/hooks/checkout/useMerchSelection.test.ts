import { act, renderHook } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import type { ProductsPass } from "@/types/Products"
import { useMerchSelection } from "./useMerchSelection"

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

describe("useMerchSelection — id-lookup against full active product list", () => {
  it("updateMerchQuantity resolves product with category='other' via id from full list", () => {
    const allActiveProducts = [
      makeProduct({ id: "p1", category: "other" }),
      makeProduct({ id: "p2", category: "merch" }),
    ]
    const { result } = renderHook(() => useMerchSelection(allActiveProducts))

    act(() => {
      result.current.updateMerchQuantity("p1", 1)
    })

    expect(result.current.merch).toHaveLength(1)
    expect(result.current.merch[0].productId).toBe("p1")
    expect(result.current.merch[0].quantity).toBe(1)
  })

  it("clamps quantity to max_quantity", () => {
    const allActiveProducts = [
      makeProduct({ id: "p1", category: "merch", max_quantity: 2 }),
    ]
    const { result } = renderHook(() => useMerchSelection(allActiveProducts))

    act(() => {
      result.current.updateMerchQuantity("p1", 99)
    })

    expect(result.current.merch[0].quantity).toBe(2)
  })

  it("removes from cart when quantity <= 0", () => {
    const allActiveProducts = [makeProduct({ id: "p1", category: "merch" })]
    const { result } = renderHook(() => useMerchSelection(allActiveProducts))

    act(() => {
      result.current.updateMerchQuantity("p1", 2)
    })
    expect(result.current.merch).toHaveLength(1)

    act(() => {
      result.current.updateMerchQuantity("p1", 0)
    })
    expect(result.current.merch).toHaveLength(0)
  })

  it("returns without updating cart when productId matches no product (unknown id fails gracefully)", () => {
    const allActiveProducts = [makeProduct({ id: "p1", category: "merch" })]
    const { result } = renderHook(() => useMerchSelection(allActiveProducts))

    act(() => {
      result.current.updateMerchQuantity("nonexistent-id", 1)
    })

    expect(result.current.merch).toHaveLength(0)
  })

  it("updates quantity and totalPrice for existing cart item", () => {
    const allActiveProducts = [
      makeProduct({ id: "p1", category: "merch", price: 5 }),
    ]
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
