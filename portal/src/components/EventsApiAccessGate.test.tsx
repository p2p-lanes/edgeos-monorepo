import { render, screen } from "@testing-library/react"
import { EventsApiAccessGate } from "./EventsApiAccessGate"

const mocks = vi.hoisted(() => ({
  city: { id: "popup-1", takes_applications: true, events_enabled: true },
  applications: [] as Array<{ status: string }>,
  access: { state: "denied" as "allowed" | "denied" | "loading" },
}))

vi.mock("@/providers/cityProvider", () => ({
  useCityProvider: () => ({ getCity: () => mocks.city }),
}))

vi.mock("@/providers/applicationProvider", () => ({
  useApplication: () => ({
    getApplicationsForPopup: () => mocks.applications,
    participation: null,
  }),
}))

vi.mock("@/hooks/useHumanPopupAccess", () => ({
  useHumanPopupAccess: () => mocks.access,
}))

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

describe("EventsApiAccessGate", () => {
  beforeEach(() => {
    mocks.city = {
      id: "popup-1",
      takes_applications: true,
      events_enabled: true,
    }
    mocks.applications = []
    mocks.access = { state: "denied" }
  })

  it("allows Agentic access to a ticket holder without an application", () => {
    mocks.access = { state: "allowed" }

    render(
      <EventsApiAccessGate>
        <div>agentic-access-content</div>
      </EventsApiAccessGate>,
    )

    expect(screen.getByText("agentic-access-content")).toBeTruthy()
  })

  it("keeps Agentic access hidden when there is neither a ticket nor an application", () => {
    render(
      <EventsApiAccessGate>
        <div>agentic-access-content</div>
      </EventsApiAccessGate>,
    )

    expect(screen.queryByText("agentic-access-content")).toBeNull()
    expect(
      screen.getByText("events.api_access.unavailable_heading"),
    ).toBeTruthy()
  })

  it("allows a ticket holder in a direct-sale popup to use Agentic access", () => {
    mocks.city = {
      id: "popup-1",
      takes_applications: false,
      events_enabled: true,
    }
    mocks.access = { state: "allowed" }

    render(
      <EventsApiAccessGate>
        <div>agentic-access-content</div>
      </EventsApiAccessGate>,
    )

    expect(screen.getByText("agentic-access-content")).toBeTruthy()
  })
})
