import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import PopupsHistory from "./PopupsHistory"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock("@/providers/applicationProvider", () => ({
  useApplication: () => ({
    applications: [
      { id: "app-1", popup_id: "popup-1", status: "withdrawn", attendees: [] },
    ],
  }),
}))
vi.mock("@/providers/cityProvider", () => ({
  useCityProvider: () => ({
    getPopups: () => [
      {
        id: "popup-1",
        name: "Withdrawn gathering",
        start_date: "2099-07-01",
        end_date: "2099-07-07",
      },
    ],
  }),
}))

describe("PopupsHistory", () => {
  it("labels a withdrawn application as withdrawn instead of upcoming", () => {
    render(<PopupsHistory popups={[]} />)
    expect(screen.getByText("Withdrawn gathering")).toBeTruthy()
    expect(screen.getByText("status.withdrawn")).toBeTruthy()
    expect(screen.queryByText("status.upcoming")).toBeNull()
    expect(screen.queryByText("status.application_approved")).toBeNull()
    expect(screen.queryByText("profile.no_events")).toBeNull()
  })
})
