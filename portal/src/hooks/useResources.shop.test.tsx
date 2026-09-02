import { renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  applicationStatus: "accepted" as string | null,
  applicationFlows: [] as Array<{ id: string; slug: string; name: string }>,
  directFlows: [] as Array<{ id: string; slug: string; name: string }>,
  upsaleFlows: [] as Array<{ id: string; slug: string; name: string }>,
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
    getRelevantApplication: () =>
      mocks.applicationStatus ? { status: mocks.applicationStatus } : null,
    participation: null,
  }),
}))

vi.mock("@/providers/cityProvider", () => ({
  useCityProvider: () => ({
    getCity: () => ({
      id: "popup-1",
      slug: "summit",
      status: "active",
      takes_applications: true,
    }),
  }),
}))

import useResources from "./useResources"

const shopPath = "/portal/summit/shop"
const attendeeFlow = { id: "attendee-1", slug: "attendee", name: "Attendee" }
const directFlow = { id: "direct-1", slug: "merch-store", name: "Merch Store" }

describe("useResources Shop navigation", () => {
  beforeEach(() => {
    mocks.applicationStatus = "accepted"
    mocks.applicationFlows = []
    mocks.directFlows = []
    mocks.upsaleFlows = []
  })

  it("shows Shop for an approved applicant with purchasable attendee inventory", () => {
    mocks.applicationFlows = [attendeeFlow]

    const { result } = renderHook(() => useResources())

    expect(
      result.current.resources.find((resource) => resource.path === shopPath)
        ?.status,
    ).toBe("active")
  })

  it("hides Shop for an unapproved applicant with attendee inventory", () => {
    mocks.applicationStatus = "in review"
    mocks.applicationFlows = [attendeeFlow]

    const { result } = renderHook(() => useResources())

    expect(
      result.current.resources.find((resource) => resource.path === shopPath)
        ?.status,
    ).toBe("hidden")
  })

  it("hides Shop when an approved applicant has no purchasable inventory", () => {
    const { result } = renderHook(() => useResources())

    expect(
      result.current.resources.find((resource) => resource.path === shopPath)
        ?.status,
    ).toBe("hidden")
  })

  it("keeps Shop visible when another eligible flow is available", () => {
    mocks.applicationStatus = "in review"
    mocks.applicationFlows = [attendeeFlow]
    mocks.directFlows = [directFlow]

    const { result } = renderHook(() => useResources())

    expect(
      result.current.resources.find((resource) => resource.path === shopPath)
        ?.status,
    ).toBe("active")
  })
})
