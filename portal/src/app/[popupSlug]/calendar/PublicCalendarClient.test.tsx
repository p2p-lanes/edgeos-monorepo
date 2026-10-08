import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { EventPublicCalendarResponse } from "@/client"
import { PublicCalendarClient } from "./PublicCalendarClient"

const state = vi.hoisted(() => ({
  params: new URLSearchParams("view=calendar"),
  replace: vi.fn(),
  data: undefined as EventPublicCalendarResponse | undefined,
}))
vi.mock("@/i18n/config", () => ({}))
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: state.replace, push: vi.fn() }),
  usePathname: () => "/test/calendar",
  useSearchParams: () => state.params,
  notFound: vi.fn(),
}))
vi.mock("@/providers/tenantProvider", () => ({
  useTenant: () => ({ tenantId: "tenant" }),
}))
vi.mock("@/hooks/useIsAuthenticated", () => ({
  useIsAuthenticated: () => false,
}))
vi.mock("@/components/LoginRequiredDialog", () => ({
  LoginRequiredDialog: () => null,
}))
vi.mock("./usePublicCalendarEvents", () => ({
  usePublicCalendarEvents: () => ({
    data: state.data,
    isLoading: !state.data,
    isError: false,
  }),
}))
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: undefined, isLoading: false }),
}))
vi.mock("@/app/portal/[popupSlug]/events/lib/useEventRsvp", () => ({
  useEventRsvp: () => ({
    rsvpMutation: {},
    cancelRsvpMutation: {},
    pendingRsvpKey: null,
  }),
}))
vi.mock("@/app/portal/[popupSlug]/events/lib/useMeasuredHeight", () => ({
  useMeasuredHeight: () => [null, 112],
}))
vi.mock("@/app/portal/[popupSlug]/events/lib/EventsToolbar", () => ({
  EventsToolbar: ({
    onViewChange,
    onSearchChange,
  }: {
    onViewChange: (view: string) => void
    onSearchChange: (search: string) => void
  }) => (
    <div>
      <button type="button" onClick={() => onViewChange("day")}>
        Day view
      </button>
      <input
        aria-label="Search events"
        onChange={(event) => onSearchChange(event.target.value)}
      />
    </div>
  ),
}))

const schedule: EventPublicCalendarResponse = {
  meta: {
    popup_id: "popup",
    popup_slug: "test",
    popup_name: "Test",
    timezone: "UTC",
    popup_start_date: "2026-10-01T00:00:00Z",
    popup_end_date: "2026-10-31T00:00:00Z",
  },
  results: [3, 28].map((day) => ({
    id: `${day}`,
    title: `Event ${day}`,
    timezone: "UTC",
    start_time: `2026-10-${String(day).padStart(2, "0")}T12:00:00Z`,
    end_time: `2026-10-${String(day).padStart(2, "0")}T13:00:00Z`,
  })),
  paging: { offset: 0, limit: 200, total: 2 },
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date("2026-09-01T12:00:00Z"))
  state.params = new URLSearchParams("view=calendar")
  state.data = schedule
  state.replace.mockClear()
  Element.prototype.scrollTo = vi.fn()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe("public calendar navigation", () => {
  it("reads the grid view from the URL and waits for the schedule's first event day", () => {
    state.data = undefined
    const { rerender } = render(<PublicCalendarClient popupSlug="test" />)
    expect(screen.queryByText("Saturday, October 3")).toBeNull()
    state.data = schedule
    rerender(<PublicCalendarClient popupSlug="test" />)
    expect(screen.getByText("Saturday, October 3")).toBeTruthy()
  })
  it("opens a past gathering on its last event day and includes past events", () => {
    vi.setSystemTime(new Date("2026-11-01T12:00:00Z"))
    render(<PublicCalendarClient popupSlug="test" />)
    expect(screen.getByText("Wednesday, October 28")).toBeTruthy()
    expect(screen.getByText("Event 28")).toBeTruthy()
  })
  it("does not reset a user-picked grid day on filtering or schedule refresh", () => {
    const { rerender } = render(<PublicCalendarClient popupSlug="test" />)
    fireEvent.click(screen.getByRole("button", { name: "15" }))
    fireEvent.change(screen.getByLabelText("Search events"), {
      target: { value: "Event 28" },
    })
    state.data = { ...schedule, results: [...schedule.results] }
    rerender(<PublicCalendarClient popupSlug="test" />)
    expect(screen.getByText("Thursday, October 15")).toBeTruthy()
  })
  it("keeps the initial event day when filters exclude that event", () => {
    render(<PublicCalendarClient popupSlug="test" />)
    fireEvent.change(screen.getByLabelText("Search events"), {
      target: { value: "Event 28" },
    })
    expect(screen.getByText("Saturday, October 3")).toBeTruthy()
  })
  it("writes view changes to the URL without dropping other params or scrolling", () => {
    state.params = new URLSearchParams("view=calendar&source=embed")
    render(<PublicCalendarClient popupSlug="test" />)
    fireEvent.click(screen.getByRole("button", { name: "Day view" }))
    expect(state.replace).toHaveBeenCalledWith(
      "/test/calendar?view=day&source=embed",
      { scroll: false },
    )
  })
  it("responds to URL view changes and opens day view on the same default date", () => {
    const { rerender } = render(<PublicCalendarClient popupSlug="test" />)
    state.params = new URLSearchParams("view=day")
    rerender(<PublicCalendarClient popupSlug="test" />)
    expect(screen.getByText("Saturday, October 3, 2026")).toBeTruthy()
  })
  it("defaults invalid views to list and shows ended popup history", () => {
    vi.setSystemTime(new Date("2026-11-01T12:00:00Z"))
    state.params = new URLSearchParams("view=invalid")
    render(<PublicCalendarClient popupSlug="test" />)
    expect(screen.getByText("Event 3")).toBeTruthy()
    expect(screen.getByText("Event 28")).toBeTruthy()
    expect(screen.queryByText("Wednesday, October 28")).toBeNull()
  })
})
