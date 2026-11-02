import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { queryKeys } from "@/lib/query-keys"

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  isAuthenticated: true,
  city: { id: "popup-1" } as { id: string } | null,
  resources: [] as Array<Record<string, unknown>>,
}))

vi.mock("@/client/core/request", () => ({ request: mocks.request }))

vi.mock("@/hooks/useIsAuthenticated", () => ({
  useIsAuthenticated: () => mocks.isAuthenticated,
}))

vi.mock("@/hooks/useResources", () => ({
  default: () => ({ resources: mocks.resources }),
}))

vi.mock("@/providers/cityProvider", () => ({
  useCityProvider: () => ({ getCity: () => mocks.city }),
}))

import { useFlowCarts } from "./useFlowCarts"

const items = (quantity: number) => ({
  lines: [
    {
      kind: "product",
      product_id: "product-1",
      quantity,
      price: null,
      step_type: "tickets",
      assignment: { kind: "unassigned" },
    },
  ],
  recipients: [],
  promo_code: null,
  insurance: false,
  current_step: null,
})

const renderFlowCarts = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  return { queryClient, ...renderHook(() => useFlowCarts(), { wrapper }) }
}

describe("useFlowCarts", () => {
  beforeEach(() => {
    mocks.request.mockReset()
    mocks.isAuthenticated = true
    mocks.city = { id: "popup-1" }
    mocks.resources = [
      { name: "Passes", status: "active", path: "/portal/summit/passes" },
      {
        name: "Event Tickets",
        status: "active",
        path: "/portal/summit/shop/tickets",
        salesFlowId: "tickets-1",
      },
      {
        name: "Merch Items",
        status: "active",
        path: "/portal/summit/shop/merch",
        salesFlowId: "merch-1",
      },
    ]
    mocks.request.mockImplementation(
      async (
        _config: unknown,
        options: { query: { sales_flow_id: string } },
      ) =>
        options.query.sales_flow_id === "merch-1" ? { items: items(2) } : null,
    )
  })

  it("reads one cart per checkout entry, scoped to its flow", async () => {
    const { result } = renderFlowCarts()

    await waitFor(() =>
      expect(
        result.current.find((cart) => cart.flowId === "merch-1")?.itemCount,
      ).toBe(2),
    )

    expect(result.current).toHaveLength(2)
    expect(
      result.current.find((cart) => cart.flowId === "tickets-1"),
    ).toMatchObject({
      name: "Event Tickets",
      path: "/portal/summit/shop/tickets",
      itemCount: 0,
    })
    expect(mocks.request).toHaveBeenCalledTimes(2)
  })

  it("follows the checkout's own cart cache", async () => {
    const { result, queryClient } = renderFlowCarts()
    await waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(2))

    act(() => {
      queryClient.setQueryData(
        queryKeys.cart.byPopup("popup-1", "tickets-1"),
        items(3),
      )
    })

    await waitFor(() =>
      expect(
        result.current.find((cart) => cart.flowId === "tickets-1")?.itemCount,
      ).toBe(3),
    )
  })

  it("asks for nothing when signed out", () => {
    mocks.isAuthenticated = false

    const { result } = renderFlowCarts()

    expect(mocks.request).not.toHaveBeenCalled()
    expect(result.current.every((cart) => cart.itemCount === 0)).toBe(true)
  })

  it("returns nothing without a popup", () => {
    mocks.city = null
    mocks.resources = []

    const { result } = renderFlowCarts()

    expect(result.current).toEqual([])
    expect(mocks.request).not.toHaveBeenCalled()
  })
})
