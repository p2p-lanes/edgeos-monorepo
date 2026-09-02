import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { createElement } from "react"
import { describe, expect, it, vi } from "vitest"
import { FormFieldsService } from "@/client"
import { useApplicationSchema } from "./useApplicationSchema"

vi.mock("@/client", () => ({
  FormFieldsService: {
    getPortalApplicationSchema: vi.fn().mockResolvedValue({
      base_fields: {},
      custom_fields: {},
      sections: [],
    }),
  },
}))

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return createElement(QueryClientProvider, { client: queryClient }, children)
}

describe("useApplicationSchema", () => {
  it("omits salesFlowId when not provided (default-flow resolution unchanged)", async () => {
    const getPortalApplicationSchema = vi.mocked(
      FormFieldsService.getPortalApplicationSchema,
    )

    renderHook(() => useApplicationSchema("popup-1"), { wrapper })

    await waitFor(() => {
      expect(getPortalApplicationSchema).toHaveBeenCalledWith({
        popupId: "popup-1",
      })
    })
  })

  it("forwards salesFlowId when an explicit flow is targeted (FlowPicker, task 9.4)", async () => {
    const getPortalApplicationSchema = vi.mocked(
      FormFieldsService.getPortalApplicationSchema,
    )

    renderHook(() => useApplicationSchema("popup-1", "flow-vip"), { wrapper })

    await waitFor(() => {
      expect(getPortalApplicationSchema).toHaveBeenCalledWith({
        popupId: "popup-1",
        salesFlowId: "flow-vip",
      })
    })
  })
})
