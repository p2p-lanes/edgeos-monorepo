import { renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ApplicationPublic, SalesFlowPortalPublic } from "@/client"
import { useGatheringDoors } from "./useGatheringDoors"

const mocks = vi.hoisted(() => ({
  flows: undefined as SalesFlowPortalPublic[] | undefined,
  popupApplications: [] as ApplicationPublic[],
  applicationsQueryState: {
    isPending: true,
    isFetching: true,
    isFetchedAfterMount: false,
    isLoadingError: false,
  },
  participationQueryState: {
    isPending: true,
    isFetching: true,
    isFetchedAfterMount: false,
    isLoadingError: false,
  },
  flowState: {
    isPending: true,
    isFetching: true,
    isFetchedAfterMount: false,
    isLoadingError: false,
  },
}))

vi.mock("@/hooks/useGetApplications", () => ({
  useApplicationsQuery: () => mocks.applicationsQueryState,
}))

vi.mock("@/hooks/useParticipationQuery", () => ({
  useParticipationQuery: () => mocks.participationQueryState,
}))

vi.mock("@/hooks/usePortalSalesFlows", () => ({
  usePortalSalesFlows: () => ({ data: mocks.flows, ...mocks.flowState }),
}))

vi.mock("@/providers/applicationProvider", () => ({
  useApplication: () => ({
    getApplicationsForPopup: () => mocks.popupApplications,
  }),
}))

describe("useGatheringDoors", () => {
  beforeEach(() => {
    mocks.flows = undefined
    mocks.popupApplications = []
    mocks.applicationsQueryState = {
      isPending: true,
      isFetching: true,
      isFetchedAfterMount: false,
      isLoadingError: false,
    }
    mocks.participationQueryState = {
      isPending: true,
      isFetching: true,
      isFetchedAfterMount: false,
      isLoadingError: false,
    }
    mocks.flowState = {
      isPending: true,
      isFetching: true,
      isFetchedAfterMount: false,
      isLoadingError: false,
    }
  })

  it("stays loading until applications, participation, and flows resolve", () => {
    const { result, rerender } = renderHook(() => useGatheringDoors("popup-1"))

    expect(result.current).toEqual({
      doors: [],
      isLoading: true,
      isError: false,
    })

    mocks.applicationsQueryState = {
      isPending: false,
      isFetching: false,
      isFetchedAfterMount: true,
      isLoadingError: false,
    }
    rerender()
    expect(result.current.isLoading).toBe(true)

    mocks.participationQueryState = {
      isPending: false,
      isFetching: false,
      isFetchedAfterMount: true,
      isLoadingError: false,
    }
    rerender()
    expect(result.current.isLoading).toBe(true)

    mocks.flows = []
    mocks.flowState = {
      isPending: false,
      isFetching: false,
      isFetchedAfterMount: true,
      isLoadingError: false,
    }
    rerender()
    expect(result.current).toEqual({
      doors: [],
      isLoading: false,
      isError: false,
    })
  })

  it("combines settled flows with the matching application status", () => {
    mocks.applicationsQueryState = {
      isPending: false,
      isFetching: false,
      isFetchedAfterMount: true,
      isLoadingError: false,
    }
    mocks.participationQueryState = {
      isPending: false,
      isFetching: false,
      isFetchedAfterMount: true,
      isLoadingError: false,
    }
    mocks.flowState = {
      isPending: false,
      isFetching: false,
      isFetchedAfterMount: true,
      isLoadingError: false,
    }
    mocks.flows = [
      { id: "flow-a", slug: "attendee", name: "Attendee", order: 0 },
      { id: "flow-b", slug: "volunteers", name: "Volunteers", order: 1 },
    ] as SalesFlowPortalPublic[]
    mocks.popupApplications = [
      {
        id: "application-a",
        popup_id: "popup-1",
        sales_flow_id: "flow-a",
        status: "accepted",
      } as ApplicationPublic,
    ]

    const { result } = renderHook(() => useGatheringDoors("popup-1"))

    expect(result.current.isLoading).toBe(false)
    expect(
      result.current.doors.map(({ flowId, status }) => ({ flowId, status })),
    ).toEqual([
      { flowId: "flow-a", status: "accepted" },
      { flowId: "flow-b", status: "none" },
    ])
  })

  it("reports an initial flow query error instead of loading forever", () => {
    mocks.applicationsQueryState = {
      isPending: false,
      isFetching: false,
      isFetchedAfterMount: true,
      isLoadingError: false,
    }
    mocks.participationQueryState = {
      isPending: false,
      isFetching: false,
      isFetchedAfterMount: true,
      isLoadingError: false,
    }
    mocks.flowState = {
      isPending: false,
      isFetching: false,
      isFetchedAfterMount: true,
      isLoadingError: true,
    }

    const { result } = renderHook(() => useGatheringDoors("popup-1"))

    expect(result.current).toEqual({
      doors: [],
      isLoading: false,
      isError: true,
    })
  })

  it("waits for an on-mount stale-cache refresh but not later refetches", () => {
    mocks.applicationsQueryState = {
      isPending: false,
      isFetching: false,
      isFetchedAfterMount: true,
      isLoadingError: false,
    }
    mocks.participationQueryState = {
      isPending: false,
      isFetching: false,
      isFetchedAfterMount: true,
      isLoadingError: false,
    }
    mocks.flows = [
      { id: "flow-a", slug: "attendee", name: "Attendee", order: 0 },
    ] as SalesFlowPortalPublic[]
    mocks.flowState = {
      isPending: false,
      isFetching: true,
      isFetchedAfterMount: false,
      isLoadingError: false,
    }

    const { result, rerender } = renderHook(() => useGatheringDoors("popup-1"))
    expect(result.current.isLoading).toBe(true)

    mocks.flowState = {
      ...mocks.flowState,
      isFetchedAfterMount: true,
    }
    rerender()

    expect(result.current.isLoading).toBe(false)
    expect(result.current.doors).toHaveLength(1)
  })
})
