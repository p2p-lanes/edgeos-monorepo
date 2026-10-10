import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderHook, waitFor } from "@testing-library/react"
import type { PropsWithChildren } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import useMyTicketsQuery from "./useMyTicketsQuery"

const mocks = vi.hoisted(() => ({
  auth: {
    user: null as null | { id: string; tenant_id: string },
    isUserLoading: false,
  },
  read: vi.fn(async () => []),
}))

vi.mock("@/hooks/useAuth", () => ({ default: () => mocks.auth }))
vi.mock("@/client", () => ({
  ApplicationsService: { listMyTickets: mocks.read },
}))

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { client, wrapper }
}

describe("personal ticket query identity", () => {
  beforeEach(() => {
    mocks.auth = { user: null, isUserLoading: false }
    mocks.read.mockClear()
  })

  it("does not fetch tickets until the authenticated profile is known", () => {
    mocks.auth.isUserLoading = true
    const { wrapper } = setup()
    const { result } = renderHook(() => useMyTicketsQuery(), { wrapper })
    expect(result.current.isLoading).toBe(true)
    expect(mocks.read).not.toHaveBeenCalled()
  })

  it("scopes caches by tenant and account rather than reusing another person's tickets", async () => {
    mocks.auth.user = { id: "person-a", tenant_id: "tenant-a" }
    const { client, wrapper } = setup()
    const { rerender } = renderHook(() => useMyTicketsQuery(), { wrapper })
    await waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(1))
    mocks.auth.user = { id: "person-b", tenant_id: "tenant-b" }
    rerender()
    await waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(2))
    expect(
      client
        .getQueryCache()
        .getAll()
        .map((query) => query.queryKey),
    ).toEqual([
      ["tickets", "mine", "tenant-a", "person-a"],
      ["tickets", "mine", "tenant-b", "person-b"],
    ])
  })
})
