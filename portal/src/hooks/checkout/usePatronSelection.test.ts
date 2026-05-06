import { act, renderHook } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import type { ProductsPass } from "@/types/Products"
import { usePatronSelection } from "./usePatronSelection"

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

describe("usePatronSelection — id-lookup against full active product list", () => {
  it("setPatronAmount resolves product with category='donations' via id from full list", () => {
    const allActiveProducts = [
      makeProduct({ id: "pat1", category: "donations" }),
      makeProduct({ id: "pat2", category: "patreon" }),
    ]
    const { result } = renderHook(() => usePatronSelection(allActiveProducts))

    act(() => {
      result.current.setPatronAmount("pat1", 50)
    })

    expect(result.current.patron).not.toBeNull()
    expect(result.current.patron!.productId).toBe("pat1")
    expect(result.current.patron!.amount).toBe(50)
  })

  it("returns without updating when productId matches no product (graceful fail)", () => {
    const allActiveProducts = [makeProduct({ id: "pat1", category: "patreon" })]
    const { result } = renderHook(() => usePatronSelection(allActiveProducts))

    act(() => {
      result.current.setPatronAmount("nonexistent-id", 100)
    })

    expect(result.current.patron).toBeNull()
  })

  it("clearPatron sets patron to null", () => {
    const allActiveProducts = [makeProduct({ id: "pat1", category: "patreon" })]
    const { result } = renderHook(() => usePatronSelection(allActiveProducts))

    act(() => {
      result.current.setPatronAmount("pat1", 30)
    })
    expect(result.current.patron).not.toBeNull()

    act(() => {
      result.current.clearPatron()
    })
    expect(result.current.patron).toBeNull()
  })

  it("marks isCustomAmount correctly", () => {
    const allActiveProducts = [makeProduct({ id: "pat1", category: "patreon" })]
    const { result } = renderHook(() => usePatronSelection(allActiveProducts))

    act(() => {
      result.current.setPatronAmount("pat1", 75, true)
    })

    expect(result.current.patron!.isCustomAmount).toBe(true)
  })
})
