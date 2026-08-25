import { renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  city: {
    id: "popup-1",
    slug: "summit",
    status: "ended",
    takes_applications: false,
  },
  directFlows: [] as Array<{ id: string; slug: string; name: string }>,
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
  useHumanPopupAccess: () => ({ state: "allowed", source: "payment" }),
}))

vi.mock("@/hooks/usePortalSalesFlows", () => ({
  usePortalSalesFlows: () => ({ data: [] }),
}))

vi.mock("@/hooks/usePortalDirectSalesFlows", () => ({
  usePortalDirectSalesFlows: () => ({ data: mocks.directFlows }),
}))

vi.mock("@/hooks/usePortalUpsaleFlows", () => ({
  usePortalUpsaleFlows: () => ({ data: [] }),
}))

vi.mock("@/providers/applicationProvider", () => ({
  useApplication: () => ({
    getRelevantApplication: () => null,
    participation: null,
  }),
}))

vi.mock("@/providers/cityProvider", () => ({
  useCityProvider: () => ({
    getCity: () => mocks.city,
  }),
}))

import useResources from "./useResources"

describe("useResources", () => {
  beforeEach(() => {
    mocks.city.status = "ended"
    mocks.directFlows = []
  })

  it("removes commerce links from an ended direct-sale popup while retaining Orders", () => {
    const { result } = renderHook(() => useResources())
    const paths = result.current.resources.map((resource) => resource.path)

    expect(paths).not.toContain("/portal/summit/shop")
    expect(paths).toContain("/portal/summit/orders")
  })

  it("keeps Shop available for an active direct-sale popup", () => {
    mocks.city.status = "active"
    mocks.directFlows = [
      { id: "direct-1", slug: "merch-store", name: "Merch Store" },
    ]

    const { result } = renderHook(() => useResources())
    const paths = result.current.resources.map((resource) => resource.path)

    expect(paths).toContain("/portal/summit/shop")
  })
})
