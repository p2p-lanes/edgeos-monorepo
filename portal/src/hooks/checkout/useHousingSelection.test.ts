import { act, renderHook } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import type { ProductsPass } from "@/types/Products"
import { useHousingSelection } from "./useHousingSelection"

function makeProduct(
  overrides: Partial<ProductsPass> & { id: string; category: string },
): ProductsPass {
  return {
    id: overrides.id,
    name: overrides.name ?? overrides.id,
    category: overrides.category,
    is_active: overrides.is_active ?? true,
    price: overrides.price ?? 100,
    compare_price: null,
    max_quantity: overrides.max_quantity ?? null,
    ...overrides,
  } as unknown as ProductsPass
}

describe("useHousingSelection — id-lookup against full active product list", () => {
  it("selectHousing resolves product with category='villa' via id from full list", () => {
    const allActiveProducts = [
      makeProduct({ id: "h1", category: "villa" }),
      makeProduct({ id: "h2", category: "housing" }),
    ]
    const { result } = renderHook(() => useHousingSelection(allActiveProducts))

    act(() => {
      result.current.selectHousing("h1", "2025-01-01", "2025-01-05")
    })

    expect(result.current.housing).not.toBeNull()
    expect(result.current.housing!.productId).toBe("h1")
  })

  it("returns without updating when productId matches no product (graceful fail)", () => {
    const allActiveProducts = [makeProduct({ id: "h1", category: "housing" })]
    const { result } = renderHook(() => useHousingSelection(allActiveProducts))

    act(() => {
      result.current.selectHousing("nonexistent-id", "2025-01-01", "2025-01-05")
    })

    expect(result.current.housing).toBeNull()
  })

  it("clamps quantity to max_quantity when updating housing quantity", () => {
    const allActiveProducts = [
      makeProduct({ id: "h1", category: "housing", price: 50, max_quantity: 2 }),
    ]
    const { result } = renderHook(() => useHousingSelection(allActiveProducts))

    act(() => {
      result.current.selectHousing("h1", "2025-01-01", "2025-01-05")
    })
    act(() => {
      result.current.updateHousingQuantity(99)
    })

    expect(result.current.housing!.quantity).toBe(2)
  })
})
