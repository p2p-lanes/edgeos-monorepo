import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { createElement } from "react"
import { describe, expect, it, vi } from "vitest"
import { SalesFlowsService } from "@/client"
import { usePortalSalesFlows } from "./usePortalSalesFlows"

vi.mock("@/client", () => ({
  SalesFlowsService: {
    listPortalSalesFlows: vi.fn().mockResolvedValue({
      results: [
        { id: "flow-1", slug: "attendee", name: "Attendee", order: 0 },
        { id: "flow-2", slug: "vip", name: "VIP", order: 1 },
      ],
      paging: { offset: 0, limit: 2, total: 2 },
    }),
  },
}))

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return createElement(QueryClientProvider, { client: queryClient }, children)
}

describe("usePortalSalesFlows", () => {
  it("fetches portal-listed application flows for the popup", async () => {
    const { result } = renderHook(() => usePortalSalesFlows("popup-1"), {
      wrapper,
    })

    await waitFor(() => {
      expect(result.current.data).toHaveLength(2)
    })

    expect(SalesFlowsService.listPortalSalesFlows).toHaveBeenCalledWith({
      popupId: "popup-1",
    })
  })

  it("is disabled when popupId is undefined", () => {
    const { result } = renderHook(() => usePortalSalesFlows(undefined), {
      wrapper,
    })

    expect(result.current.fetchStatus).toBe("idle")
  })
})
