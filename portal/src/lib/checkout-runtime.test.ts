import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { createElement } from "react"
import { useCheckoutRuntime } from "@/app/checkout/[popupSlug]/hooks/useCheckoutRuntime"
import type { CheckoutRuntimeResponse } from "@/client"
import { fetchCheckoutRuntime } from "./checkout-runtime"

vi.mock("@/client", () => ({
  CheckoutService: {
    getRuntime: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    status: number
    constructor(status: number, message: string) {
      super(message)
      this.status = status
    }
  },
}))

const runtimeData: CheckoutRuntimeResponse = {
  popup: {
    id: "popup-1",
    slug: "festival-2026",
    name: "Festival 2026",
  },
  products: [],
  buyer_form: [],
  ticketing_steps: [],
} as unknown as CheckoutRuntimeResponse

function createWrapper(): ({ children }: { children: ReactNode }) => ReactNode {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: 30_000,
      },
    },
  })

  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children)
  }
}

describe("fetchCheckoutRuntime", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns typed CheckoutRuntimeResponse on 200", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(runtimeData),
    })

    const result = await fetchCheckoutRuntime("festival-2026", "tenant-1")

    expect(result).toEqual(runtimeData)
  })

  it("returns null on 404", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    })

    const result = await fetchCheckoutRuntime("not-found", "tenant-1")

    expect(result).toBeNull()
  })

  it("returns null on 500", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    })

    const result = await fetchCheckoutRuntime("festival-2026", "tenant-1")

    expect(result).toBeNull()
  })

  it("returns null when fetch throws a network error", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("Network error"))

    const result = await fetchCheckoutRuntime("festival-2026", "tenant-1")

    expect(result).toBeNull()
  })

  it("returns null on AbortController timeout after 1500ms", async () => {
    vi.useFakeTimers()

    global.fetch = vi.fn().mockImplementation(
      (_url: string, { signal }: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            const err = new DOMException(
              "The operation was aborted.",
              "AbortError",
            )
            reject(err)
          })
        }),
    )

    const resultPromise = fetchCheckoutRuntime("festival-2026", "tenant-1")

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500)
    })

    const result = await resultPromise

    expect(result).toBeNull()

    vi.useRealTimers()
  })

  it("issues request with cache: no-store and X-Tenant-Id header", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(runtimeData),
    })

    await fetchCheckoutRuntime("festival-2026", "tenant-abc")

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/checkout/festival-2026/runtime"),
      expect.objectContaining({
        cache: "no-store",
        headers: expect.objectContaining({
          "X-Tenant-Id": "tenant-abc",
        }),
      }),
    )
  })
})

describe("useCheckoutRuntime opts", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("does not trigger a fetch when initialData and initialDataUpdatedAt within staleTime are supplied", async () => {
    const { CheckoutService } = await import("@/client")
    const getRuntime = vi.mocked(CheckoutService.getRuntime)

    const { result } = renderHook(
      () =>
        useCheckoutRuntime("festival-2026", {
          initialData: runtimeData,
          initialDataUpdatedAt: Date.now(),
        }),
      { wrapper: createWrapper() },
    )

    // Data should be available immediately from initialData
    expect(result.current.data).toEqual(runtimeData)
    expect(result.current.isLoading).toBe(false)

    // queryFn should NOT have been called on mount (data is fresh within staleTime)
    expect(getRuntime).not.toHaveBeenCalled()
  })

  it("behaves as before (client fetch) when no opts are provided", async () => {
    const { CheckoutService } = await import("@/client")
    const getRuntime = vi.mocked(CheckoutService.getRuntime)
    getRuntime.mockResolvedValue(runtimeData)

    const { result } = renderHook(() => useCheckoutRuntime("festival-2026"), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(result.current.data).toEqual(runtimeData)
    })

    expect(getRuntime).toHaveBeenCalledTimes(1)
    expect(getRuntime).toHaveBeenCalledWith({ slug: "festival-2026" })
  })
})
