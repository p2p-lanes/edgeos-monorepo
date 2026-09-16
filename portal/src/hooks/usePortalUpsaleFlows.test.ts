import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { createElement } from "react"
import { describe, expect, it, vi } from "vitest"
import { SalesFlowsService } from "@/client"
import { usePortalUpsaleFlows } from "./usePortalUpsaleFlows"

vi.mock("@/client", () => ({
  SalesFlowsService: {
    listPortalUpsaleFlows: vi.fn().mockResolvedValue({
      results: [{ id: "flow-1", slug: "addon", name: "Add-on", order: 0 }],
      paging: { offset: 0, limit: 1, total: 1 },
    }),
  },
}))

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return createElement(QueryClientProvider, { client: queryClient }, children)
}

describe("usePortalUpsaleFlows", () => {
  it("fetches eligible upsale flows for the popup", async () => {
    const { result } = renderHook(() => usePortalUpsaleFlows("popup-1"), {
      wrapper,
    })

    await waitFor(() => {
      expect(result.current.data).toHaveLength(1)
    })

    expect(SalesFlowsService.listPortalUpsaleFlows).toHaveBeenCalledWith({
      popupId: "popup-1",
    })
  })

  it("is disabled when popupId is undefined", () => {
    const { result } = renderHook(() => usePortalUpsaleFlows(undefined), {
      wrapper,
    })

    expect(result.current.fetchStatus).toBe("idle")
  })
})
