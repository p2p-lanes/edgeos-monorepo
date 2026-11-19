import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import PopupsHistory from "./PopupsHistory"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

type TestApplication = {
  id: string
  popup_id: string
  status: string
  attendees: unknown[]
}
type TestPopup = {
  id: string
  name: string
  status?: string
  start_date: string | null
  end_date: string | null
}

const state = vi.hoisted(() => ({
  applications: [] as TestApplication[],
  popups: [] as TestPopup[],
}))

vi.mock("@/providers/applicationProvider", () => ({
  useApplication: () => ({ applications: state.applications }),
}))
vi.mock("@/providers/cityProvider", () => ({
  useCityProvider: () => ({ getPopups: () => state.popups }),
}))

beforeEach(() => {
  state.applications = [
    { id: "app-1", popup_id: "popup-1", status: "withdrawn", attendees: [] },
  ]
  state.popups = [
    {
      id: "popup-1",
      name: "Withdrawn gathering",
      start_date: "2099-07-01",
      end_date: "2099-07-07",
    },
  ]
})

describe("PopupsHistory", () => {
  it("labels a withdrawn application as withdrawn instead of upcoming", () => {
    render(<PopupsHistory popups={[]} />)
    expect(screen.getByText("Withdrawn gathering")).toBeTruthy()
    expect(screen.getByText("status.withdrawn")).toBeTruthy()
    expect(screen.queryByText("status.upcoming")).toBeNull()
    expect(screen.queryByText("status.application_approved")).toBeNull()
    expect(screen.queryByText("profile.no_events")).toBeNull()
  })

  it("lists an upcoming gathering without dates and hides its date line", () => {
    state.applications = [
      { id: "app-1", popup_id: "popup-1", status: "accepted", attendees: [] },
      { id: "app-2", popup_id: "popup-2", status: "accepted", attendees: [] },
    ]
    state.popups = [
      {
        id: "popup-2",
        name: "Undated gathering",
        status: "active",
        start_date: null,
        end_date: null,
      },
      {
        id: "popup-1",
        name: "Dated gathering",
        status: "active",
        start_date: "2099-07-01",
        end_date: "2099-07-07",
      },
    ]

    const { container } = render(<PopupsHistory popups={[]} />)

    const names = screen
      .getAllByRole("heading", { level: 5 })
      .map((heading) => heading.textContent)
    // Gatherings without dates sort after dated ones.
    expect(names).toEqual(["Dated gathering", "Undated gathering"])
    expect(container.textContent).not.toContain("Invalid Date")
    expect(screen.getAllByText(/2099/)).toHaveLength(1)
  })

  it("does not list an undated gathering the organizer already ended", () => {
    state.applications = [
      { id: "app-1", popup_id: "popup-1", status: "accepted", attendees: [] },
    ]
    state.popups = [
      {
        id: "popup-1",
        name: "Ended gathering",
        status: "ended",
        start_date: null,
        end_date: null,
      },
    ]

    render(<PopupsHistory popups={[]} />)

    expect(screen.queryByText("Ended gathering")).toBeNull()
    expect(screen.getByText("profile.no_upcoming_events")).toBeTruthy()
  })

  it("shows past gatherings without rendering Invalid Date for a missing start date", () => {
    state.applications = []
    const { container } = render(
      <PopupsHistory
        popups={[
          {
            popup_id: "past-1",
            popup_name: "Past gathering",
            start_date: null,
            end_date: "2020-01-10",
            total_days: 3,
          },
        ]}
      />,
    )

    expect(screen.getByText("Past gathering")).toBeTruthy()
    expect(container.textContent).not.toContain("Invalid Date")
    expect(screen.getByText(/2020/)).toBeTruthy()
  })
})
