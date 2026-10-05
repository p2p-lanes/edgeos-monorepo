import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type {
  EventPublic,
  EventSeriesOccurrence,
  EventSeriesSummary,
} from "@/client"

const mocks = vi.hoisted(() => ({ summary: vi.fn(), participants: vi.fn() }))
vi.mock("@/client", () => ({
  ApiError: Error,
  EventsService: { getEventSeriesSummary: mocks.summary },
  EventParticipantsService: { listParticipants: mocks.participants },
}))
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    params,
    search,
    children,
    "aria-label": label,
  }: {
    params: { eventId: string }
    search: { occ?: string }
    children: ReactNode
    "aria-label"?: string
  }) => (
    <a
      aria-label={label}
      href={`/events/${params.eventId}${search.occ ? `?occ=${encodeURIComponent(search.occ)}` : ""}`}
    >
      {children}
    </a>
  ),
}))

import { OtherSeriesOccurrences } from "./OtherSeriesOccurrences"

const FIRST = "2031-03-03T10:00:00Z"
const SECOND = "2031-03-04T10:00:00Z"
const THIRD = "2031-03-05T10:00:00Z"
const FOURTH = "2031-03-06T12:00:00Z"
const EVENT: EventPublic = {
  id: "master",
  tenant_id: "tenant",
  popup_id: "popup",
  owner_id: "host",
  title: "Yoga",
  start_time: FIRST,
  end_time: "2031-03-03T11:00:00Z",
  timezone: "UTC",
  rrule: "FREQ=DAILY;COUNT=4",
  resolved_occurrence_start: FIRST,
}
function occurrence(
  start: string,
  overrides: Partial<EventSeriesOccurrence> = {},
): EventSeriesOccurrence {
  return {
    event_id: "master",
    occurrence_start: start,
    start_time: start,
    end_time: start.replace("10:00", "11:00"),
    timezone: "UTC",
    title: "Yoga",
    status: "published",
    is_detached: false,
    attendee_count: 2,
    ...overrides,
  }
}
const SUMMARY: EventSeriesSummary = {
  series_id: "master",
  series_title: "Yoga",
  timezone: "UTC",
  window_start: "2031-03-03T00:00:00Z",
  window_end: "2031-03-07T00:00:00Z",
  occurrences: [
    occurrence(FIRST),
    occurrence(SECOND),
    occurrence(THIRD, { attendee_count: 0 }),
    occurrence(FOURTH, {
      event_id: "child",
      occurrence_start: null,
      is_detached: true,
    }),
  ],
  outside_schedule: [],
}
function person(name: string, status = "registered") {
  return {
    id: name,
    profile_id: name,
    first_name: name,
    status,
    role: "attendee",
  }
}
function renderSection(event: EventPublic = EVENT) {
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <OtherSeriesOccurrences event={event} formatRange={(start) => start} />
    </QueryClientProvider>,
  )
}
async function openSection() {
  fireEvent.click(
    screen.getByRole("button", { name: /Other occurrences in this series/ }),
  )
  await screen.findByRole("heading", { name: SECOND })
}

afterEach(cleanup)
beforeEach(() => {
  vi.clearAllMocks()
  mocks.summary.mockResolvedValue(SUMMARY)
  mocks.participants.mockImplementation(
    async ({ eventId, occurrenceStart }) => ({
      results:
        eventId === "child"
          ? [person("Detached attendee")]
          : occurrenceStart === FIRST
            ? [person("First-date attendee")]
            : [person("Maria"), person("Bruno")],
    }),
  )
})

describe("other series occurrences", () => {
  it("loads only on expansion and excludes the current date by instant", async () => {
    renderSection({
      ...EVENT,
      resolved_occurrence_start: "2031-03-03T10:00:00+00:00",
    })
    expect(mocks.summary).not.toHaveBeenCalled()
    expect(mocks.participants).not.toHaveBeenCalled()
    await openSection()
    expect(mocks.summary).toHaveBeenCalledWith({
      eventId: "master",
    })
    expect(screen.queryByRole("heading", { name: FIRST })).toBeNull()
    expect(await screen.findByText("Maria")).toBeTruthy()
    expect(await screen.findByText("Detached attendee")).toBeTruthy()
    expect(mocks.participants).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole("button", { name: SECOND })).toBeNull()
    expect(screen.queryByRole("button", { name: FOURTH })).toBeNull()
    expect(screen.getByText("0 RSVPs")).toBeTruthy()
  })

  it("shows zero-RSVP occurrences immediately, without a roster request", async () => {
    renderSection()
    await openSection()
    expect(await screen.findByText("No active RSVPs")).toBeTruthy()
    expect(mocks.participants).not.toHaveBeenCalledWith({
      eventId: "master",
      occurrenceStart: THIRD,
    })
    expect(
      screen
        .getAllByRole("link", { name: /^View occurrence:/ })[1]
        .getAttribute("href"),
    ).toBe(`/events/master?occ=${encodeURIComponent(THIRD)}`)
  })

  it("automatically shows read-only rosters, filtering cancelled rows", async () => {
    mocks.participants.mockImplementation(async ({ eventId }) => ({
      results:
        eventId === "child"
          ? [person("Detached attendee")]
          : [
              person("Maria"),
              person("Bruno", "checked_in"),
              person("Pablo", "cancelled"),
            ],
    }))
    renderSection()
    await openSection()
    await screen.findByText("Maria")
    expect(mocks.participants).toHaveBeenCalledWith({
      eventId: "master",
      occurrenceStart: SECOND,
    })
    expect(screen.getByText("Checked in")).toBeTruthy()
    expect(screen.getAllByText("RSVP'd").length).toBeGreaterThan(0)
    expect(screen.queryByText("RSVPed")).toBeNull()
    expect(screen.queryByText("Pablo")).toBeNull()
    expect(
      screen.queryByRole("button", { name: /Mark present|Cancel RSVP|Edit/ }),
    ).toBeNull()
  })

  it("opens detached children by their own ID without an occurrence parameter", async () => {
    renderSection()
    await openSection()
    expect(screen.getByText("Separate occurrence")).toBeTruthy()
    const link = screen.getByRole("link", {
      name: `View occurrence: ${FOURTH}`,
    })
    expect(link.getAttribute("href")).toBe("/events/child")
    await screen.findByText("Detached attendee")
    expect(mocks.participants).toHaveBeenCalledWith({
      eventId: "child",
      occurrenceStart: undefined,
    })
  })

  it("works from a detached detail and excludes only that child", async () => {
    renderSection({
      ...EVENT,
      id: "child",
      recurrence_master_id: "master",
      rrule: null,
      resolved_occurrence_start: null,
      start_time: FOURTH,
    })
    fireEvent.click(
      screen.getByRole("button", { name: /Other occurrences in this series/ }),
    )
    await screen.findByRole("heading", { name: FIRST })
    expect(screen.queryByRole("heading", { name: FOURTH })).toBeNull()
    expect(mocks.summary.mock.calls.at(-1)?.[0].eventId).toBe("master")
  })

  it("loads all API pages instead of silently truncating the roster", async () => {
    mocks.participants.mockImplementation(async ({ eventId, skip }) => {
      if (eventId === "child") return { results: [person("Detached attendee")] }
      return skip === 2
        ? {
            results: [person("Bruno"), person("Diego")],
            paging: { offset: 2, limit: 2, total: 4 },
          }
        : {
            results: [person("Maria"), person("Pablo", "cancelled")],
            paging: { offset: 0, limit: 2, total: 4 },
          }
    })
    renderSection()
    await openSection()
    await screen.findByText("Diego")
    expect(mocks.participants).toHaveBeenCalledWith({
      eventId: "master",
      occurrenceStart: SECOND,
      skip: 2,
    })
    expect(screen.queryByText("Pablo")).toBeNull()
  })

  it("renders obsolete and legacy groups separately without scheduled-date links", async () => {
    mocks.summary.mockResolvedValue({
      ...SUMMARY,
      outside_schedule: [
        {
          event_id: "master",
          occurrence_start: null,
          title: "Yoga",
          timezone: "UTC",
          attendee_count: 1,
          participants: [person("Legacy attendee")],
        },
      ],
    })
    renderSection()
    await openSection()
    expect(screen.getByText("RSVPs outside the current schedule")).toBeTruthy()
    expect(await screen.findByText("Legacy attendee")).toBeTruthy()
    expect(
      screen.queryByRole("button", {
        name: /No occurrence date \(legacy RSVP\)/,
      }),
    ).toBeNull()
    expect(
      screen.getAllByRole("link", { name: /^View occurrence:/ }),
    ).toHaveLength(3)
    expect(mocks.participants).not.toHaveBeenCalledWith({
      eventId: "master",
      occurrenceStart: undefined,
    })
  })

  it("shows an inline summary error and allows retry", async () => {
    mocks.summary.mockRejectedValueOnce(new Error("Unavailable"))
    renderSection()
    fireEvent.click(
      screen.getByRole("button", { name: /Other occurrences in this series/ }),
    )
    await screen.findByRole("alert")
    fireEvent.click(screen.getByRole("button", { name: "Retry" }))
    await screen.findByRole("heading", { name: SECOND })
    expect(mocks.summary).toHaveBeenCalledTimes(2)
  })

  it("shows an inline roster error without losing the date list", async () => {
    mocks.participants.mockRejectedValueOnce(new Error("Unavailable"))
    renderSection()
    await openSection()
    await screen.findByRole("alert")
    expect(screen.getByRole("heading", { name: THIRD })).toBeTruthy()
    expect(screen.getByText("Detached attendee")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Retry" }))
    await screen.findByText("Maria")
  })

  it("shows the fixed gathering range without date navigation controls", async () => {
    renderSection()
    await openSection()
    expect(screen.getByText(/Mar 3, 2031 – Mar 6, 2031/)).toBeTruthy()
    for (const name of ["Previous dates", "Next dates", "Default dates"]) {
      expect(screen.queryByRole("button", { name })).toBeNull()
    }
    expect(mocks.summary).toHaveBeenCalledWith({ eventId: "master" })
  })

  it("explains when gathering dates must be configured", async () => {
    const message =
      "Set gathering start and end dates to view other occurrences."
    mocks.summary.mockRejectedValueOnce(
      Object.assign(new Error(message), {
        status: 400,
        body: { detail: message },
      }),
    )
    renderSection()
    fireEvent.click(
      screen.getByRole("button", { name: /Other occurrences in this series/ }),
    )
    expect(await screen.findByRole("alert")).toHaveTextContent(message)
    expect(mocks.participants).not.toHaveBeenCalled()
  })
})
