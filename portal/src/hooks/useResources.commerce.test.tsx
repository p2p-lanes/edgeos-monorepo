import { renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  applicationStatus: "accepted" as string | null,
  applicationFlows: undefined as Flow[] | undefined,
  directFlows: undefined as Flow[] | undefined,
  upsaleFlows: undefined as Flow[] | undefined,
  applications: [] as Array<{ sales_flow_id: string; status: string }>,
  flowIdentifier: null as string | null,
  participation: null as null | {
    type: "companion"
    application_status: string
  },
  takesApplications: true,
  directoryEnabled: false,
}))

type Flow = {
  id: string
  slug: string
  name: string
  type: "application" | "direct" | "upsale"
}

vi.mock("next/navigation", () => ({
  useSearchParams: () =>
    new URLSearchParams(
      mocks.flowIdentifier ? { flow: mocks.flowIdentifier } : undefined,
    ),
}))

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock("@/hooks/useAuth", () => ({
  default: () => ({ user: { id: "human-1" } }),
}))

vi.mock("@/hooks/useGatheringDoors", () => ({
  useGatheringDoors: () => ({ doors: [] }),
}))

vi.mock("@/hooks/useHumanPopupAccess", () => ({
  useHumanPopupAccess: () => ({ state: "allowed" }),
}))

vi.mock("@/hooks/usePortalSalesFlows", () => ({
  usePortalSalesFlows: () => ({ data: mocks.applicationFlows }),
}))

vi.mock("@/hooks/usePortalDirectSalesFlows", () => ({
  usePortalDirectSalesFlows: () => ({ data: mocks.directFlows }),
}))

vi.mock("@/hooks/usePortalUpsaleFlows", () => ({
  usePortalUpsaleFlows: () => ({ data: mocks.upsaleFlows }),
}))

vi.mock("@/providers/applicationProvider", () => ({
  useApplication: () => ({
    getApplicationsForPopup: () => mocks.applications,
    getRelevantApplication: () =>
      mocks.applicationStatus ? { status: mocks.applicationStatus } : null,
    participation: mocks.participation,
  }),
}))

vi.mock("@/providers/cityProvider", () => ({
  useCityProvider: () => ({
    getCity: () => ({
      id: "popup-1",
      slug: "summit",
      status: "active",
      takes_applications: mocks.takesApplications,
      show_attendee_directory: mocks.directoryEnabled,
    }),
  }),
}))

import useResources from "./useResources"

const attendeeFlow = {
  id: "attendee-1",
  slug: "attendee",
  name: "Attendee",
  type: "application" as const,
}
const volunteerFlow = {
  id: "volunteer-1",
  slug: "volunteer",
  name: "Volunteer",
  type: "application" as const,
}
const directFlow = {
  id: "direct-1",
  slug: "merch-store",
  name: "Merch Store",
  type: "direct" as const,
}
const upsaleFlow = {
  id: "upsale-1",
  slug: "meal-plan",
  name: "Meal Plan",
  type: "upsale" as const,
}

const visibleCommerce = (
  resources: ReturnType<typeof useResources>["resources"],
) =>
  resources.filter(
    (resource) => resource.group === "commerce" && resource.status !== "hidden",
  )

const visibleCheckouts = (
  resources: ReturnType<typeof useResources>["resources"],
) =>
  resources.filter(
    (resource) =>
      resource.group === "checkouts" && resource.status !== "hidden",
  )

describe("useResources Commerce navigation", () => {
  beforeEach(() => {
    mocks.applicationStatus = "accepted"
    mocks.applicationFlows = []
    mocks.directFlows = []
    mocks.upsaleFlows = []
    mocks.applications = []
    mocks.flowIdentifier = null
    mocks.participation = null
    mocks.takesApplications = true
    mocks.directoryEnabled = false
  })

  it("lists only application flows with a matching approved application", () => {
    mocks.applicationFlows = [attendeeFlow, volunteerFlow]
    mocks.directFlows = [directFlow]
    mocks.upsaleFlows = [upsaleFlow]
    mocks.applications = [
      { sales_flow_id: attendeeFlow.id, status: "accepted" },
      { sales_flow_id: volunteerFlow.id, status: "in review" },
    ]

    const { result } = renderHook(() => useResources())
    const commerce = visibleCommerce(result.current.resources)
    const checkouts = visibleCheckouts(result.current.resources)

    expect(commerce.map((resource) => resource.name)).toEqual([
      "sidebar.application",
      "sidebar.passes",
      "sidebar.orders",
    ])
    expect(checkouts.map((resource) => resource.name)).toEqual([
      "Attendee",
      "Merch Store",
      "Meal Plan",
    ])
    expect(checkouts.some((resource) => resource.name === "Volunteer")).toBe(
      false,
    )
    expect(
      commerce.find((resource) => resource.name === "sidebar.passes")?.path,
    ).toBe("/portal/summit/passes")
    expect(
      checkouts.find((resource) => resource.name === "Attendee")?.path,
    ).toBe("/portal/summit/shop/attendee")
    expect(
      checkouts.find((resource) => resource.name === "Merch Store")?.path,
    ).toBe("/portal/summit/shop/merch-store")
    expect(
      checkouts.find((resource) => resource.name === "Meal Plan")?.path,
    ).toBe("/portal/summit/shop/meal-plan")
    expect(
      checkouts.every((resource) =>
        resource.path?.startsWith("/portal/summit/shop/"),
      ),
    ).toBe(true)
  })

  it("does not expose application flows before approval", () => {
    mocks.applicationStatus = "in review"
    mocks.applicationFlows = [attendeeFlow]
    mocks.directFlows = [directFlow]
    mocks.upsaleFlows = [upsaleFlow]
    mocks.applications = [
      { sales_flow_id: attendeeFlow.id, status: "in review" },
    ]

    const { result } = renderHook(() => useResources())
    const commerce = visibleCommerce(result.current.resources)
    const checkouts = visibleCheckouts(result.current.resources)

    expect(commerce.map((resource) => resource.name)).toEqual([
      "sidebar.application",
      "sidebar.orders",
    ])
    expect(checkouts.map((resource) => resource.name)).toEqual([
      "Merch Store",
      "Meal Plan",
    ])
    expect(
      checkouts.some(
        (resource) => resource.path === "/portal/summit/shop/attendee",
      ),
    ).toBe(false)
  })

  it("deduplicates returned flows by ID or slug", () => {
    mocks.directFlows = [
      directFlow,
      {
        id: directFlow.id,
        slug: "alternate-merch",
        name: "Duplicate ID",
        type: "direct",
      },
    ]
    mocks.upsaleFlows = [
      {
        id: "duplicate-slug",
        slug: directFlow.slug,
        name: "Duplicate slug",
        type: "upsale",
      },
      upsaleFlow,
      upsaleFlow,
    ]

    const { result } = renderHook(() => useResources())
    const flowPaths = visibleCheckouts(result.current.resources)
      .map((resource) => resource.path)
      .filter((path) => path?.includes("/shop/"))

    expect(flowPaths).toEqual([
      "/portal/summit/shop/merch-store",
      "/portal/summit/shop/meal-plan",
    ])
  })

  it("keeps static navigation intact while flow queries load or fail", () => {
    const { result } = renderHook(() => useResources())
    const commerce = visibleCommerce(result.current.resources)

    expect(commerce.map((resource) => resource.name)).toEqual([
      "sidebar.application",
      "sidebar.orders",
    ])
    expect(visibleCheckouts(result.current.resources)).toEqual([])
    expect(
      result.current.resources.some((resource) =>
        resource.path?.endsWith("/people"),
      ),
    ).toBe(false)
    expect(
      result.current.resources.some((resource) =>
        resource.path?.endsWith("/shop"),
      ),
    ).toBe(false)
  })

  it("keeps popup-wide Passes and Directory when no application flow is selected", () => {
    mocks.applicationStatus = null
    mocks.applications = [
      { sales_flow_id: attendeeFlow.id, status: "accepted" },
      { sales_flow_id: volunteerFlow.id, status: "in review" },
    ]
    mocks.directoryEnabled = true

    const { result } = renderHook(() => useResources())
    const passes = result.current.resources.find(
      (resource) => resource.name === "sidebar.passes",
    )
    const directory = result.current.resources.find(
      (resource) => resource.name === "sidebar.attendee_directory",
    )

    expect(passes).toMatchObject({
      status: "active",
      path: "/portal/summit/passes",
    })
    expect(directory).toMatchObject({
      status: "active",
      path: "/portal/summit/attendees",
    })
    expect(
      result.current.resources.find(
        (resource) => resource.name === "sidebar.events",
      )?.status,
    ).toBe("hidden")
  })

  it("shows popup-wide Passes and Directory for an accepted companion", () => {
    mocks.applicationStatus = null
    mocks.directoryEnabled = true
    mocks.participation = {
      type: "companion",
      application_status: "accepted",
    }

    const { result } = renderHook(() => useResources())

    expect(
      result.current.resources.find(
        (resource) => resource.name === "sidebar.passes",
      ),
    ).toMatchObject({ status: "active", path: "/portal/summit/passes" })
    expect(
      result.current.resources.find(
        (resource) => resource.name === "sidebar.attendee_directory",
      ),
    ).toMatchObject({ status: "active", path: "/portal/summit/attendees" })
  })

  it("keeps pending companion Passes available while Directory stays hidden", () => {
    mocks.applicationStatus = null
    mocks.directoryEnabled = true
    mocks.participation = {
      type: "companion",
      application_status: "in review",
    }

    const { result } = renderHook(() => useResources())

    expect(
      result.current.resources.find(
        (resource) => resource.name === "sidebar.passes",
      )?.status,
    ).toBe("active")
    expect(
      result.current.resources.find(
        (resource) => resource.name === "sidebar.attendee_directory",
      )?.status,
    ).toBe("hidden")
  })

  it("keeps Directory excluded when nobody applies", () => {
    mocks.takesApplications = false
    mocks.directoryEnabled = true

    const { result } = renderHook(() => useResources())

    expect(
      result.current.resources.some(
        (resource) => resource.name === "sidebar.attendee_directory",
      ),
    ).toBe(false)
    expect(
      result.current.resources.find(
        (resource) => resource.name === "sidebar.passes",
      ),
    ).toMatchObject({ status: "active", path: "/portal/summit/passes" })
  })
})
