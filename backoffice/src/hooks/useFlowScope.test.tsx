/**
 * Which flow a flow-scoped page shows, and where that answer comes from.
 *
 * The URL is the answer, so a link means the same thing to everyone who
 * opens it. Memory only decides where you land when the URL says nothing.
 * These cases pin that order, and the case where the URL is wrong.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/client", () => ({
  SalesFlowsService: { listSalesFlows: vi.fn() },
}))

import { SalesFlowsService } from "@/client"
import { salesFlowsQueryKey } from "@/lib/salesFlowQueries"
import { useFlowScope } from "./useFlowScope"

// Node's own Web Storage shadows jsdom's and is not usable here, so the
// suite brings its own. Same reason the portal pins its Node version.
function installStorage(): Storage {
  const map = new Map<string, string>()
  const storage = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size
    },
  } as Storage
  Object.defineProperty(window, "localStorage", {
    value: storage,
    configurable: true,
  })
  return storage
}

const mockList = vi.mocked(SalesFlowsService.listSalesFlows)

const PRIMARY_FLOW = { id: "flow-primary", name: "Attendee", is_default: true }
const OTHER_FLOW = { id: "flow-other", name: "Volunteers", is_default: false }

type Listed = Awaited<ReturnType<typeof SalesFlowsService.listSalesFlows>>

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

function deferred<T>() {
  let resolve: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve: resolve! }
}

function renderScope(urlFlowId?: string, onResolved = vi.fn()) {
  return {
    onResolved,
    ...renderHook(() => useFlowScope("popup-1", urlFlowId, onResolved), {
      wrapper: makeWrapper(),
    }),
  }
}

describe("useFlowScope", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    installStorage()
    mockList.mockResolvedValue({
      results: [PRIMARY_FLOW, OTHER_FLOW],
      paging: { offset: 0, limit: 100, total: 2 },
    } as unknown as Listed)
  })

  it("uses the flow the URL names", async () => {
    const { result } = renderScope(OTHER_FLOW.id)

    await waitFor(() => expect(result.current.activeFlowId).toBe(OTHER_FLOW.id))
  })

  it("falls back to the default flow when the URL says nothing", async () => {
    const { result } = renderScope(undefined)

    await waitFor(() =>
      expect(result.current.activeFlowId).toBe(PRIMARY_FLOW.id),
    )
  })

  it("writes the resolved flow back so the address describes the screen", async () => {
    const { onResolved } = renderScope(undefined)

    await waitFor(() =>
      expect(onResolved).toHaveBeenCalledWith(PRIMARY_FLOW.id),
    )
  })

  it("prefers the remembered flow over the default", async () => {
    window.localStorage.setItem(
      "edgeos.flow-scope",
      JSON.stringify({ "popup-1": OTHER_FLOW.id }),
    )

    const { result } = renderScope(undefined)

    await waitFor(() => expect(result.current.activeFlowId).toBe(OTHER_FLOW.id))
  })

  it("ignores a URL naming a flow of another gathering", async () => {
    /* A stale or shared link must not leave the page showing nothing. */
    const { result } = renderScope("flow-from-somewhere-else")

    await waitFor(() =>
      expect(result.current.activeFlowId).toBe(PRIMARY_FLOW.id),
    )
  })

  it("keeps the URL flow while a stale list is refetching", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    queryClient.setQueryData(salesFlowsQueryKey("popup-1"), {
      results: [PRIMARY_FLOW],
      paging: { offset: 0, limit: 100, total: 1 },
    } as unknown as Listed)
    const refresh = deferred<Listed>()
    mockList.mockReturnValueOnce(refresh.promise)
    const onResolved = vi.fn()

    const { result } = renderHook(
      () => useFlowScope("popup-1", OTHER_FLOW.id, onResolved),
      {
        wrapper: ({ children }: { children: ReactNode }) => (
          <QueryClientProvider client={queryClient}>
            {children}
          </QueryClientProvider>
        ),
      },
    )

    await waitFor(() => expect(mockList).toHaveBeenCalledTimes(1))
    expect(result.current.activeFlowId).toBeUndefined()
    expect(onResolved).not.toHaveBeenCalled()

    refresh.resolve({
      results: [PRIMARY_FLOW, OTHER_FLOW],
      paging: { offset: 0, limit: 100, total: 2 },
    } as unknown as Listed)

    await waitFor(() => expect(result.current.activeFlowId).toBe(OTHER_FLOW.id))
    expect(onResolved).not.toHaveBeenCalled()
  })

  it("remembers a pick per gathering, not globally", async () => {
    const { result } = renderScope(undefined)
    await waitFor(() => expect(result.current.activeFlowId).toBeDefined())

    result.current.selectFlow(OTHER_FLOW.id)

    const stored = JSON.parse(
      window.localStorage.getItem("edgeos.flow-scope") ?? "{}",
    )
    expect(stored).toEqual({ "popup-1": OTHER_FLOW.id })
  })

  it("reports no flow while the list is still loading", () => {
    const { result } = renderScope(OTHER_FLOW.id)

    expect(result.current.activeFlowId).toBeUndefined()
    expect(result.current.isLoading).toBe(true)
  })
})
