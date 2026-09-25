import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { CalendarBody } from "./CalendarBody"
import { todayInTimezone } from "./calendarDate"
import { DayBody } from "./DayBody"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}))
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: undefined, isLoading: false }),
}))
vi.mock("./useEventRsvp", () => ({
  useEventRsvp: () => ({
    rsvpMutation: {},
    cancelRsvpMutation: {},
    pendingRsvpKey: null,
  }),
}))

const props = {
  popupId: undefined,
  slug: "test",
  search: "",
  rsvpedOnly: false,
  mode: "public" as const,
  eventsOverride: [],
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date("2026-10-09T01:00:00Z"))
  Element.prototype.scrollTo = vi.fn()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe("gathering calendar dates", () => {
  it.each([
    ["UTC", "2026-10-09T01:00:00Z", [2026, 9, 9]],
    ["America/Argentina/Buenos_Aires", "2026-10-09T01:00:00Z", [2026, 9, 8]],
    ["Pacific/Kiritimati", "2026-12-31T12:00:00Z", [2027, 0, 1]],
    ["America/Los_Angeles", "2026-03-01T01:00:00Z", [2026, 1, 28]],
  ])("uses nominal day in %s", (tz, instant, expected) => {
    const date = todayInTimezone(tz, new Date(instant))
    expect([date.getFullYear(), date.getMonth(), date.getDate()]).toEqual(
      expected,
    )
  })

  it("opens Calendar and Day on the gathering day", () => {
    render(<CalendarBody {...props} timezoneOverride="UTC" />)
    expect(screen.getByText("Friday, October 9")).toBeTruthy()
    cleanup()
    render(
      <DayBody
        {...props}
        timezoneOverride="UTC"
        venuesOverride={[]}
        selectedDate={null}
        onSelectedDateChange={vi.fn()}
      />,
    )
    expect(screen.getByText("Friday, October 9, 2026")).toBeTruthy()
  })

  it("follows a loaded timezone until a user selects a day", () => {
    const { rerender } = render(
      <CalendarBody {...props} timezoneOverride="UTC" />,
    )
    rerender(
      <CalendarBody
        {...props}
        timezoneOverride="America/Argentina/Buenos_Aires"
      />,
    )
    expect(screen.getByText("Thursday, October 8")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "15" }))
    rerender(<CalendarBody {...props} timezoneOverride="Pacific/Kiritimati" />)
    expect(screen.getByText("Thursday, October 15")).toBeTruthy()
  })

  it("preserves explicit URL dates through timezone changes in both views", () => {
    const date = new Date(2026, 9, 20)
    const { rerender } = render(
      <CalendarBody {...props} defaultDate={date} timezoneOverride="UTC" />,
    )
    rerender(
      <CalendarBody
        {...props}
        defaultDate={date}
        timezoneOverride="America/Los_Angeles"
      />,
    )
    expect(screen.getByText("Tuesday, October 20")).toBeTruthy()
    cleanup()
    const day = render(
      <DayBody
        {...props}
        venuesOverride={[]}
        selectedDate={date}
        onSelectedDateChange={vi.fn()}
        timezoneOverride="UTC"
      />,
    )
    day.rerender(
      <DayBody
        {...props}
        venuesOverride={[]}
        selectedDate={date}
        onSelectedDateChange={vi.fn()}
        timezoneOverride="America/Los_Angeles"
      />,
    )
    expect(screen.getByText("Tuesday, October 20, 2026")).toBeTruthy()
  })
})
