import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderHook, waitFor } from "@testing-library/react"
import { createElement, type ReactNode } from "react"
import { beforeEach, expect, it, vi } from "vitest"
import { ApiError, SalesFlowsService } from "@/client"
import { CancelablePromise } from "@/client/core/CancelablePromise"
import { useApplicationEntryFlow } from "./useApplicationEntryFlow"

vi.mock("@/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/client")>()),
  SalesFlowsService: {
    resolvePortalApplicationFlow: vi.fn(),
    listPortalSalesFlows: vi.fn(),
  },
}))

const invited = {
  id: "invited-id",
  slug: "invited",
  name: "By personal invitation",
  order: 0,
  type: "application" as const,
  requires_application_fee: false,
  application_fee_amount: null,
  application_layout: "single_page" as const,
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return createElement(QueryClientProvider, { client }, children)
}

function apiError(status: number) {
  return new ApiError(
    { method: "GET", url: "/sales-flows/portal/application" },
    { url: "", ok: false, status, statusText: "Unavailable", body: {} },
    "Unavailable",
  )
}

beforeEach(() => vi.resetAllMocks())

it.each([
  "invited",
  "invited-id",
])("resolves the explicit entry %s without fetching or populating discovery", async (identifier) => {
  vi.mocked(SalesFlowsService.resolvePortalApplicationFlow).mockResolvedValue(
    invited,
  )
  const { result } = renderHook(
    () => useApplicationEntryFlow("popup-id", identifier),
    { wrapper },
  )

  await waitFor(() => expect(result.current.data).toEqual(invited))
  expect(SalesFlowsService.resolvePortalApplicationFlow).toHaveBeenCalledWith({
    popupId: "popup-id",
    identifier,
  })
  expect(SalesFlowsService.listPortalSalesFlows).not.toHaveBeenCalled()
})

it.each([
  403, 404,
])("does not fall back to a public flow after HTTP %s", async (status) => {
  vi.mocked(SalesFlowsService.resolvePortalApplicationFlow).mockRejectedValue(
    apiError(status),
  )
  const { result } = renderHook(
    () => useApplicationEntryFlow("popup-id", "invited"),
    { wrapper },
  )

  await waitFor(() => expect(result.current.data).toBeNull())
  expect(SalesFlowsService.listPortalSalesFlows).not.toHaveBeenCalled()
})

it("surfaces server failures instead of treating them as an unknown flow", async () => {
  vi.mocked(SalesFlowsService.resolvePortalApplicationFlow).mockRejectedValue(
    apiError(500),
  )
  const { result } = renderHook(
    () => useApplicationEntryFlow("popup-id", "invited"),
    { wrapper },
  )
  await waitFor(() => expect(result.current.isError).toBe(true))
})

it.each([
  [],
  [invited],
  [invited, { ...invited, id: "other-id" }],
])("uses only a single listed option when the URL does not select a flow: %j", async (...flows) => {
  // Vitest spreads array table rows into arguments.
  vi.mocked(SalesFlowsService.listPortalSalesFlows).mockResolvedValue({
    results: flows,
    paging: { offset: 0, limit: flows.length, total: flows.length },
  })
  vi.mocked(SalesFlowsService.resolvePortalApplicationFlow).mockResolvedValue(
    invited,
  )
  const { result } = renderHook(
    () => useApplicationEntryFlow("popup-id", null),
    { wrapper },
  )
  await waitFor(() => expect(result.current.isSuccess).toBe(true))
  expect(result.current.data).toEqual(flows.length === 1 ? flows[0] : null)
  if (flows.length === 1) {
    expect(SalesFlowsService.resolvePortalApplicationFlow).toHaveBeenCalledWith(
      {
        popupId: "popup-id",
        identifier: invited.id,
      },
    )
  } else {
    expect(
      SalesFlowsService.resolvePortalApplicationFlow,
    ).not.toHaveBeenCalled()
  }
})

it("does not reuse the previous flow when the URL identifier changes", async () => {
  vi.mocked(SalesFlowsService.resolvePortalApplicationFlow)
    .mockResolvedValueOnce(invited)
    .mockImplementationOnce(() => new CancelablePromise(() => {}))
  const { result, rerender } = renderHook(
    ({ identifier }) => useApplicationEntryFlow("popup-id", identifier),
    { wrapper, initialProps: { identifier: "invited" } },
  )
  await waitFor(() => expect(result.current.data).toEqual(invited))

  rerender({ identifier: "other-flow" })

  expect(result.current.data).toBeUndefined()
  expect(result.current.isPending).toBe(true)
})
