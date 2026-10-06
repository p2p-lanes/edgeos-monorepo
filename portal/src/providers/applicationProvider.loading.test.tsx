import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, renderHook } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({
  popupId: "popup-1",
  applications: {
    data: undefined as unknown,
    isPending: true,
    isFetching: true,
  },
  participation: {
    data: undefined as unknown,
    isPending: true,
    isFetching: true,
  },
}))
vi.mock("@/hooks/useGetApplications", () => ({
  useApplicationsQuery: () => state.applications,
}))
vi.mock("@/hooks/useParticipationQuery", () => ({
  useParticipationQuery: () => state.participation,
}))
vi.mock("./cityProvider", () => ({
  useCityProvider: () => ({ getCity: () => ({ id: state.popupId }) }),
}))

import ApplicationProvider, { useApplication } from "./applicationProvider"

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <ApplicationProvider>{children}</ApplicationProvider>
    </QueryClientProvider>
  )
}

afterEach(cleanup)
beforeEach(() => {
  state.popupId = "popup-1"
  state.applications = { data: undefined, isPending: true, isFetching: true }
  state.participation = { data: undefined, isPending: true, isFetching: true }
})

describe("ApplicationProvider access-query loading", () => {
  it("exposes pending state separately from the initially missing data", () => {
    const { result, rerender } = renderHook(() => useApplication(), { wrapper })
    expect(result.current.applicationsLoading).toBe(true)
    expect(result.current.participationLoading).toBe(true)

    state.applications = { data: [], isPending: false, isFetching: false }
    rerender()
    expect(result.current.applicationsLoading).toBe(false)
    expect(result.current.participationLoading).toBe(true)

    state.participation = { data: null, isPending: false, isFetching: false }
    rerender()
    expect(result.current.participationLoading).toBe(false)
  })

  it("does not mark cached data as pending during background revalidation", () => {
    state.applications = { data: [], isPending: false, isFetching: true }
    state.participation = { data: null, isPending: false, isFetching: true }
    const { result } = renderHook(() => useApplication(), { wrapper })
    expect(result.current.applicationsLoading).toBe(false)
    expect(result.current.participationLoading).toBe(false)
  })

  it("settles after query failures rather than leaving permissions loading forever", () => {
    state.applications = {
      data: undefined,
      isPending: false,
      isFetching: false,
    }
    state.participation = {
      data: undefined,
      isPending: false,
      isFetching: false,
    }
    const { result } = renderHook(() => useApplication(), { wrapper })
    expect(result.current.applicationsLoading).toBe(false)
    expect(result.current.participationLoading).toBe(false)
    expect(result.current.applications).toBeNull()
    expect(result.current.participation).toBeNull()
  })

  it("waits for a newly selected popup's participation query", () => {
    state.applications = { data: [], isPending: false, isFetching: false }
    state.participation = { data: null, isPending: false, isFetching: false }
    const { result, rerender } = renderHook(() => useApplication(), { wrapper })
    expect(result.current.participationLoading).toBe(false)
    state.popupId = "popup-2"
    state.participation = { data: undefined, isPending: true, isFetching: true }
    rerender()
    expect(result.current.applicationsLoading).toBe(false)
    expect(result.current.participationLoading).toBe(true)
  })
})
