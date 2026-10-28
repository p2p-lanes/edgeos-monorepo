import { render, screen } from "@testing-library/react"
import { AgenticAccessGate } from "./AgenticAccessGate"

const mocks = vi.hoisted(() => ({
  city: {
    id: "popup-1",
    takes_applications: true,
    events_enabled: true,
    show_attendee_directory: false,
  },
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

describe("AgenticAccessGate", () => {
  beforeEach(() => {
    mocks.city = {
      id: "popup-1",
      takes_applications: true,
      events_enabled: true,
      show_attendee_directory: false,
    }
    mocks.applications = []
    mocks.access = { state: "denied" }
  })

  it("allows Agentic access to a ticket holder without an application", () => {
    mocks.access = { state: "allowed" }

    render(
      <AgenticAccessGate>
        <div>agentic-access-content</div>
      </AgenticAccessGate>,
    )

    expect(screen.getByText("agentic-access-content")).toBeTruthy()
  })

  it("keeps Agentic access hidden when there is neither a ticket nor an application", () => {
    render(
      <AgenticAccessGate>
        <div>agentic-access-content</div>
      </AgenticAccessGate>,
    )

    expect(screen.queryByText("agentic-access-content")).toBeNull()
    expect(screen.getByText("agentic_access.unavailable_heading")).toBeTruthy()
  })

  it("allows a ticket holder in a direct-sale popup to use Agentic access", () => {
    mocks.city = {
      id: "popup-1",
      takes_applications: false,
      events_enabled: true,
      show_attendee_directory: false,
    }
    mocks.access = { state: "allowed" }

    render(
      <AgenticAccessGate>
        <div>agentic-access-content</div>
      </AgenticAccessGate>,
    )

    expect(screen.getByText("agentic-access-content")).toBeTruthy()
  })

  it("allows Agentic access with only the attendee directory enabled", () => {
    mocks.city = {
      id: "popup-1",
      takes_applications: true,
      events_enabled: false,
      show_attendee_directory: true,
    }
    mocks.access = { state: "allowed" }

    render(
      <AgenticAccessGate>
        <div>agentic-access-content</div>
      </AgenticAccessGate>,
    )

    expect(screen.getByText("agentic-access-content")).toBeTruthy()
  })

  it("keeps Agentic access hidden when neither events nor the directory is enabled", () => {
    mocks.city = {
      id: "popup-1",
      takes_applications: false,
      events_enabled: false,
      show_attendee_directory: true,
    }
    mocks.access = { state: "allowed" }

    render(
      <AgenticAccessGate>
        <div>agentic-access-content</div>
      </AgenticAccessGate>,
    )

    expect(screen.queryByText("agentic-access-content")).toBeNull()
  })
})
