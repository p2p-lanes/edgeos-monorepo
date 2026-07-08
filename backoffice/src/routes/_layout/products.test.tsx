/**
 * Tests for the products route.
 *
 * Covers isProductSoldOut: a product is sold out when the manual override
 * flag is set or remaining stock is tracked (non-null) and depleted.
 */
import { describe, expect, it, vi } from "vitest"

vi.mock("@/client", () => ({
  ProductsService: {
    listProducts: vi.fn(),
    listProductCategories: vi.fn(),
    setProductSoldOut: vi.fn(),
  },
}))

vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual<object>("@tanstack/react-router")
  return {
    ...actual,
    createFileRoute: () => () => ({
      useSearch: () => ({}),
    }),
    useNavigate: () => vi.fn(),
  }
})

vi.mock("@/contexts/WorkspaceContext", () => ({
  useWorkspace: () => ({
    selectedPopupId: "popup-1",
    isContextReady: true,
  }),
}))

vi.mock("@/hooks/useTableSearchParams", () => ({
  useTableSearchParams: () => ({
    search: "",
    pagination: { pageIndex: 0, pageSize: 20 },
    setSearch: vi.fn(),
    setPagination: vi.fn(),
  }),
  validateTableSearch: vi.fn(),
}))

import type { ProductPublic } from "@/client"
import { isProductSoldOut } from "@/routes/_layout/products"

function makeProduct(
  total_stock_remaining: number | null | undefined,
  sold_out_override?: boolean,
): ProductPublic {
  return {
    id: "prod-1",
    tenant_id: "tenant-1",
    popup_id: "popup-1",
    name: "Week Pass",
    slug: "week-pass",
    price: "100",
    total_stock_remaining,
    sold_out_override,
  }
}

describe("isProductSoldOut", () => {
  it("returns true when the override flag is set even with stock available", () => {
    expect(isProductSoldOut(makeProduct(50, true))).toBe(true)
  })

  it("returns true when remaining stock is zero and the override is off", () => {
    expect(isProductSoldOut(makeProduct(0, false))).toBe(true)
  })

  it("returns false when remaining stock is positive and the override is off", () => {
    expect(isProductSoldOut(makeProduct(5, false))).toBe(false)
  })

  it("returns false when stock is untracked (null) and the override is off", () => {
    expect(isProductSoldOut(makeProduct(null, false))).toBe(false)
  })

  it("returns true for depleted stock when the override is absent", () => {
    expect(isProductSoldOut(makeProduct(0))).toBe(true)
  })
})
