import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { createElement } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ApplicationsService } from "@/client"
import { usePurchasesQuery } from "./useGetPurchases"

vi.mock("@/client", () => ({
  ApplicationsService: {
    getMyPurchases: vi.fn(),
  },
}))

vi.mock("@/hooks/useIsAuthenticated", () => ({
  useIsAuthenticated: () => true,
}))

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return createElement(QueryClientProvider, { client: queryClient }, children)
}

describe("usePurchasesQuery", () => {
  beforeEach(() => vi.clearAllMocks())

  it("loads active entitlements instead of projecting payment history", async () => {
    const purchases = [
      {
        attendee_id: "attendee-1",
        attendee_name: "Taylor Buyer",
        attendee_category: "main",
        products: [
          {
            id: "product-1",
            tenant_id: "tenant-1",
            popup_id: "popup-1",
            name: "Weekend pass",
            slug: "weekend-pass",
            price: "99.00",
            category: "ticket",
            quantity: 1,
          },
        ],
      },
    ]
    vi.mocked(ApplicationsService.getMyPurchases).mockResolvedValue(purchases)

    const { result } = renderHook(() => usePurchasesQuery("popup-1"), {
      wrapper,
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(ApplicationsService.getMyPurchases).toHaveBeenCalledWith({
      popupId: "popup-1",
    })
    expect(result.current.data).toEqual(purchases)
  })

  it("does not query without a popup", () => {
    renderHook(() => usePurchasesQuery(null), { wrapper })

    expect(ApplicationsService.getMyPurchases).not.toHaveBeenCalled()
  })
})
