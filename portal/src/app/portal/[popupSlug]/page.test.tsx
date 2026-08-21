import { render, screen } from "@testing-library/react"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import Home from "./page"

const mocks = vi.hoisted(() => ({
  city: {
    id: "popup-1",
    slug: "my-event",
    status: "active",
    takes_applications: false,
  },
  doors: [] as Array<{ flowId: string }>,
  participation: null as { type: string } | null,
  directPanel: vi.fn(),
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

vi.mock("@/providers/cityProvider", () => ({
  useCityProvider: () => ({ getCity: () => mocks.city }),
}))

vi.mock("@/providers/applicationProvider", () => ({
  useApplication: () => ({
    getRelevantApplication: () => null,
    participation: mocks.participation,
  }),
}))

vi.mock("@/hooks/useGatheringDoors", () => ({
  useGatheringDoors: () => ({ doors: mocks.doors }),
}))

vi.mock("@/components/Portal/DirectSalesFlowsPanel", () => ({
  DirectSalesFlowsPanel: (props: { popupSlug: string; popupId: string }) => {
    mocks.directPanel(props)
    return <div data-testid="direct-sales-panel" />
  },
}))

vi.mock("@/components/Card/EventCard", () => {
  const EventCard = Object.assign(
    ({ children }: { children: ReactNode }) => <div>{children}</div>,
    {
      Image: () => null,
      Content: ({ children }: { children: ReactNode }) => <div>{children}</div>,
      Title: () => null,
      Tagline: () => null,
      Location: () => null,
      DateRange: () => null,
      Progress: () => null,
      ApplyButton: () => null,
    },
  )
  return { EventCard }
})

vi.mock("@/components/Portal/GatheringDoorCard", () => ({
  GatheringDoorCard: () => <div data-testid="application-door" />,
}))

vi.mock("@/components/CompanionView", () => ({
  CompanionView: () => <div data-testid="companion-view" />,
}))

vi.mock("@/components/ScholarshipStatusBadge", () => ({
  ScholarshipStatusBadge: () => null,
}))

describe("portal event overview", () => {
  beforeEach(() => {
    mocks.city.takes_applications = false
    mocks.doors = []
    mocks.participation = null
    mocks.directPanel.mockClear()
  })

  it("does not mount direct sales for an event without applications", () => {
    render(<Home />)

    expect(screen.queryByTestId("direct-sales-panel")).toBeNull()
    expect(mocks.directPanel).not.toHaveBeenCalled()
  })

  it("does not mount direct sales alongside multiple application options", () => {
    mocks.city.takes_applications = true
    mocks.doors = [{ flowId: "application-1" }, { flowId: "application-2" }]

    render(<Home />)

    expect(screen.queryByTestId("direct-sales-panel")).toBeNull()
    expect(screen.getAllByTestId("application-door")).toHaveLength(2)
  })

  it("does not mount direct sales for a companion overview", () => {
    mocks.city.takes_applications = true
    mocks.participation = { type: "companion" }

    render(<Home />)

    expect(screen.getByTestId("companion-view")).toBeTruthy()
    expect(screen.queryByTestId("direct-sales-panel")).toBeNull()
  })
})
