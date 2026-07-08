import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import type { PopupPublic } from "@/client"
import RecapLanding from "./RecapLanding"

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
//
// RecapLanding pulls in react-i18next and the useRecapStats query hook. We
// mock both so the test focuses on the ended-popup contract (hero copy,
// stats rendering, directory CTA gating) without real network/i18n setup.

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (key === "recap.hero_heading")
        return `Thanks for ${options?.popupName}`
      if (key === "recap.status_pill") return `Ended · ${options?.date}`
      return key
    },
  }),
}))

const mockUseRecapStats = vi.fn()
vi.mock("@/hooks/useRecapStats", () => ({
  useRecapStats: (...args: unknown[]) => mockUseRecapStats(...args),
}))

const basePopup: PopupPublic = {
  id: "popup-1",
  name: "Edge City",
  slug: "edge-city",
  status: "ended",
  sale_type: "application",
  end_date: "2026-01-15",
  show_attendee_directory: true,
} as PopupPublic

describe("RecapLanding", () => {
  it("renders hero copy and stats from useRecapStats", () => {
    mockUseRecapStats.mockReturnValue({
      data: { events_count: 12, attendees_count: 340, days: 5 },
      isLoading: false,
    })

    render(<RecapLanding popup={basePopup} />)

    expect(screen.getByText("Thanks for Edge City")).toBeTruthy()
    expect(screen.getByText("12")).toBeTruthy()
    expect(screen.getByText("340")).toBeTruthy()
    expect(screen.getByText("5")).toBeTruthy()
  })

  it("hides the directory stat/CTA when the directory is disabled", () => {
    mockUseRecapStats.mockReturnValue({
      data: { events_count: 12, attendees_count: 340, days: 5 },
      isLoading: false,
    })

    render(
      <RecapLanding popup={{ ...basePopup, show_attendee_directory: false }} />,
    )

    expect(screen.queryByText("340")).toBeNull()
    expect(screen.queryByText("recap.cta.directory_title")).toBeNull()
  })

  it("shows placeholders while loading", () => {
    mockUseRecapStats.mockReturnValue({ data: undefined, isLoading: true })

    render(<RecapLanding popup={basePopup} />)

    expect(screen.getAllByText("…").length).toBeGreaterThan(0)
  })
})
