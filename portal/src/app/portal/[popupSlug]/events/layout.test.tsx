import { render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  applications: [] as Array<{ status: string }>,
  participation: null as null | {
    type: "companion"
    application_status: string
  },
  replace: vi.fn(),
}))

vi.mock("next/navigation", () => ({
  useParams: () => ({ popupSlug: "summit" }),
  useRouter: () => ({ replace: mocks.replace }),
}))

vi.mock("@/hooks/useGetApplications", () => ({
  useApplicationsQuery: () => ({ isLoading: false }),
}))

vi.mock("@/hooks/useParticipationQuery", () => ({
  useParticipationQuery: () => ({ isLoading: false }),
}))

vi.mock("@/hooks/useHumanPopupAccess", () => ({
  useHumanPopupAccess: () => ({ state: "loading" }),
}))

vi.mock("@/providers/applicationProvider", () => ({
  useApplication: () => ({
    getApplicationsForPopup: () => mocks.applications,
    participation: mocks.participation,
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

import EventsLayout from "./layout"

describe("EventsLayout", () => {
  beforeEach(() => {
    mocks.applications = []
    mocks.participation = null
    mocks.replace.mockReset()
  })

  it("allows a direct event URL when any popup application is accepted", () => {
    mocks.applications = [{ status: "in review" }, { status: "accepted" }]

    render(
      <EventsLayout>
        <div>Calendar content</div>
      </EventsLayout>,
    )

    expect(screen.getByText("Calendar content")).toBeTruthy()
    expect(mocks.replace).not.toHaveBeenCalled()
  })

  it("redirects when every popup application is still pending", async () => {
    mocks.applications = [{ status: "in review" }]

    render(
      <EventsLayout>
        <div>Calendar content</div>
      </EventsLayout>,
    )

    expect(screen.queryByText("Calendar content")).toBeNull()
    await waitFor(() =>
      expect(mocks.replace).toHaveBeenCalledWith("/portal/summit"),
    )
  })
})
