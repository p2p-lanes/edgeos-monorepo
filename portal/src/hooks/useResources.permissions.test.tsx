import { cleanup, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({
  city: {
    id: "popup-1",
    slug: "india",
    status: "active",
    takes_applications: true,
    show_attendee_directory: true,
  } as null | {
    id: string
    slug: string
    status: string
    takes_applications: boolean
    show_attendee_directory: boolean
  },
  popupsLoaded: true,
  applicationsLoading: false,
  participationLoading: false,
  applications: [] as { status: string }[],
  participation: null as null | { type: string; application_status: string },
  access: "loading",
}))
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock("@/hooks/useAuth", () => ({
  default: () => ({ user: { id: "human-1" } }),
}))
vi.mock("@/providers/cityProvider", () => ({
  useCityProvider: () => ({
    getCity: () => state.city,
    popupsLoaded: state.popupsLoaded,
  }),
}))
vi.mock("@/providers/applicationProvider", () => ({
  useApplication: () => ({
    getApplicationsForPopup: () => state.applications,
    participation: state.participation,
    applicationsLoading: state.applicationsLoading,
    participationLoading: state.participationLoading,
  }),
}))
vi.mock("@/hooks/useHumanPopupAccess", () => ({
  useHumanPopupAccess: () => ({ state: state.access }),
}))
vi.mock("@/hooks/useGatheringDoors", () => ({
  useGatheringDoors: () => ({ doors: [], isLoading: true }),
}))
vi.mock("@/hooks/usePortalSalesFlows", () => ({
  usePortalSalesFlows: () => ({ data: undefined, isPending: true }),
}))
vi.mock("@/hooks/usePortalDirectSalesFlows", () => ({
  usePortalDirectSalesFlows: () => ({ data: undefined, isPending: true }),
}))
vi.mock("@/hooks/usePortalUpsaleFlows", () => ({
  usePortalUpsaleFlows: () => ({ data: undefined, isPending: true }),
}))
vi.mock("@/hooks/useCanShareReferrals", () => ({
  useCanShareReferrals: () => false,
}))

import useResources from "./useResources"

afterEach(cleanup)
beforeEach(() => {
  state.city = {
    id: "popup-1",
    slug: "india",
    status: "active",
    takes_applications: true,
    show_attendee_directory: true,
  }
  state.popupsLoaded = true
  state.applicationsLoading = false
  state.participationLoading = false
  state.applications = []
  state.participation = null
  state.access = "loading"
})

const directoryStatus = (
  resources: ReturnType<typeof useResources>["resources"],
) =>
  resources.find((resource) => resource.path === "/portal/india/attendees")
    ?.status

describe("useResources permission readiness", () => {
  it("waits for popup configuration before making an access decision", () => {
    state.city = null
    state.popupsLoaded = false
    // A query disabled because there is no popup is also pending in React Query.
    state.participationLoading = true
    const { result, rerender } = renderHook(() => useResources())
    expect(result.current.permissionsLoading).toBe(true)
    expect(result.current.resources).toEqual([])
    state.popupsLoaded = true
    rerender()
    expect(result.current.permissionsLoading).toBe(false)
  })

  it("waits independently for applications and participation without granting access", () => {
    state.applicationsLoading = true
    state.participationLoading = true
    const { result, rerender } = renderHook(() => useResources())
    expect(result.current.permissionsLoading).toBe(true)
    expect(directoryStatus(result.current.resources)).toBe("hidden")
    state.applicationsLoading = false
    rerender()
    expect(result.current.permissionsLoading).toBe(true)
    state.participationLoading = false
    rerender()
    expect(result.current.permissionsLoading).toBe(false)
    expect(directoryStatus(result.current.resources)).toBe("hidden")
  })

  it("keeps the existing accepted-application rule and ignores unrelated pending queries", () => {
    state.applications = [{ status: "accepted" }]
    const { result } = renderHook(() => useResources())
    expect(result.current.permissionsLoading).toBe(false)
    expect(directoryStatus(result.current.resources)).toBe("active")
  })

  it("allows an accepted companion after their participation resolves", () => {
    state.participationLoading = true
    const { result, rerender } = renderHook(() => useResources())
    expect(result.current.permissionsLoading).toBe(true)
    state.participationLoading = false
    state.participation = { type: "companion", application_status: "accepted" }
    rerender()
    expect(result.current.permissionsLoading).toBe(false)
    expect(directoryStatus(result.current.resources)).toBe("active")
  })

  it("keeps a pending participant or disabled directory denied once queries settle", () => {
    state.applications = [{ status: "in review" }]
    const { result, rerender } = renderHook(() => useResources())
    expect(result.current.permissionsLoading).toBe(false)
    expect(directoryStatus(result.current.resources)).toBe("hidden")
    state.applications = [{ status: "accepted" }]
    state.city!.show_attendee_directory = false
    rerender()
    expect(directoryStatus(result.current.resources)).toBe("hidden")
  })

  it("does not wait for participation when nobody applies, or expose a directory", () => {
    state.city!.takes_applications = false
    state.applicationsLoading = true
    state.participationLoading = true
    const { result } = renderHook(() => useResources())
    expect(result.current.permissionsLoading).toBe(false)
    expect(directoryStatus(result.current.resources)).toBeUndefined()
  })

  it("waits for the existing access query when the popup has ended", () => {
    state.city!.status = "ended"
    const { result, rerender } = renderHook(() => useResources())
    expect(result.current.permissionsLoading).toBe(true)
    state.access = "allowed"
    rerender()
    expect(result.current.permissionsLoading).toBe(false)
    expect(directoryStatus(result.current.resources)).toBe("active")
  })
})
