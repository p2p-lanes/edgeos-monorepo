import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { createElement } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { EventAttendance } from "./EventAttendance"

const { FakeApiError } = vi.hoisted(() => {
  class FakeApiError extends Error {
    status: number
    body: unknown
    constructor(status: number, body: unknown) {
      super("api error")
      this.status = status
      this.body = body
    }
  }
  return { FakeApiError }
})

const getPortalAttendance = vi.fn()
const lookupPortalAttendee = vi.fn()
const portalManualCheckIn = vi.fn()
const portalVoidCheckIn = vi.fn()
const updatePortalEventAttendanceMode = vi.fn()

vi.mock("@/client", () => ({
  ApiError: FakeApiError,
  EventParticipantsService: {
    getPortalAttendance: (...a: unknown[]) => getPortalAttendance(...a),
    lookupPortalAttendee: (...a: unknown[]) => lookupPortalAttendee(...a),
    portalManualCheckIn: (...a: unknown[]) => portalManualCheckIn(...a),
    portalVoidCheckIn: (...a: unknown[]) => portalVoidCheckIn(...a),
  },
  EventsService: {
    updatePortalEventAttendanceMode: (...a: unknown[]) =>
      updatePortalEventAttendanceMode(...a),
  },
}))

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en" },
  }),
}))

vi.mock("./EventCheckInQr", () => ({
  EventCheckInQr: () => <div data-testid="qr-panel" />,
}))

const OCC = "2026-09-30T18:00:00+00:00"

function entry(overrides: Record<string, unknown> = {}) {
  return {
    participant_id: "p-1",
    profile_id: "h-1",
    first_name: "Ada",
    last_name: "Lovelace",
    email: "ada@test.com",
    status: "registered",
    check_time: null,
    history: [],
    ...overrides,
  }
}

function roster(overrides: Record<string, unknown> = {}) {
  return {
    event_id: "event-1",
    occurrence_start: null,
    attendance_mode: "host_rollcall",
    window: {
      opens_at: "2026-09-30T17:30:00Z",
      closes_at: "2026-09-30T21:00:00Z",
      is_open: true,
    },
    max_participant: null,
    seats_taken: 1,
    checked_in_count: 0,
    entries: [entry()],
    ...overrides,
  }
}

function renderPanel(occurrenceStart: string | null = null) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children)
  return render(
    createElement(EventAttendance, {
      eventId: "event-1",
      occurrenceStart,
      canManage: true,
      timezone: "UTC",
    }),
    { wrapper },
  )
}

beforeEach(() => {
  for (const fn of [
    getPortalAttendance,
    lookupPortalAttendee,
    portalManualCheckIn,
    portalVoidCheckIn,
    updatePortalEventAttendanceMode,
  ]) {
    fn.mockReset()
  }
})

describe("EventAttendance", () => {
  it("renders nothing when the server refuses the roll call", async () => {
    getPortalAttendance.mockRejectedValue(
      new FakeApiError(403, { detail: { code: "not_event_manager" } }),
    )
    const { container } = renderPanel()
    await waitFor(() => expect(getPortalAttendance).toHaveBeenCalled())
    expect(container.innerHTML).toBe("")
  })

  it("shows the QR only in self check-in", async () => {
    getPortalAttendance.mockResolvedValue(roster())
    const { unmount } = renderPanel()
    await screen.findByText("Ada Lovelace")
    expect(screen.queryByTestId("qr-panel")).toBeNull()
    unmount()

    getPortalAttendance.mockResolvedValue(
      roster({ attendance_mode: "self_checkin" }),
    )
    renderPanel()
    expect(await screen.findByTestId("qr-panel")).toBeTruthy()
  })

  it("marks an RSVP present for the right occurrence", async () => {
    getPortalAttendance.mockResolvedValue(roster())
    portalManualCheckIn.mockResolvedValue({ entry: entry() })
    renderPanel(OCC)

    fireEvent.click(await screen.findByText("events.attendance.mark_present"))

    await waitFor(() =>
      expect(portalManualCheckIn).toHaveBeenCalledWith({
        eventId: "event-1",
        requestBody: { profile_id: "h-1", occurrence_start: OCC },
      }),
    )
    expect(getPortalAttendance).toHaveBeenCalledWith({
      eventId: "event-1",
      occurrenceStart: OCC,
    })
  })

  it("asks for a reason before voiding", async () => {
    getPortalAttendance.mockResolvedValue(
      roster({ entries: [entry({ status: "checked_in" })] }),
    )
    portalVoidCheckIn.mockResolvedValue(entry())
    renderPanel()

    fireEvent.click(await screen.findByText("events.attendance.void"))
    const confirm = screen.getByText("events.attendance.void_confirm")
    expect(confirm.closest("button")?.disabled).toBe(true)

    fireEvent.change(
      screen.getByLabelText("events.attendance.void_reason_label"),
      { target: { value: "Wrong person" } },
    )
    fireEvent.click(confirm)

    await waitFor(() =>
      expect(portalVoidCheckIn).toHaveBeenCalledWith({
        eventId: "event-1",
        requestBody: {
          profile_id: "h-1",
          reason: "Wrong person",
          occurrence_start: null,
        },
      }),
    )
  })

  it("offers no actions outside the window", async () => {
    getPortalAttendance.mockResolvedValue(
      roster({
        window: {
          opens_at: "2020-01-01T00:00:00Z",
          closes_at: "2020-01-01T03:00:00Z",
          is_open: false,
        },
        entries: [
          entry(),
          entry({ participant_id: "p-2", status: "checked_in" }),
        ],
      }),
    )
    renderPanel()

    await screen.findByText("events.attendance.window_closed")
    expect(screen.queryByText("events.attendance.mark_present")).toBeNull()
    expect(screen.queryByText("events.attendance.void")).toBeNull()
    expect(screen.queryByLabelText("events.attendance.search_label")).toBeNull()
  })

  it("finds a walk-in by email and marks them", async () => {
    getPortalAttendance.mockResolvedValue(roster({ entries: [] }))
    lookupPortalAttendee.mockResolvedValue({
      profile_id: "h-9",
      first_name: "Grace",
      last_name: "Hopper",
      email: "grace@test.com",
      status: null,
    })
    portalManualCheckIn.mockResolvedValue({ entry: entry() })
    renderPanel()

    fireEvent.change(
      await screen.findByLabelText("events.attendance.search_label"),
      { target: { value: "grace@test.com" } },
    )
    fireEvent.click(screen.getByText("events.attendance.search_button"))
    await screen.findByText("Grace Hopper")
    fireEvent.click(screen.getByText("events.attendance.mark_present"))

    await waitFor(() =>
      expect(portalManualCheckIn).toHaveBeenCalledWith({
        eventId: "event-1",
        requestBody: { profile_id: "h-9", occurrence_start: null },
      }),
    )
  })

  it("explains a failed search with the server's code", async () => {
    getPortalAttendance.mockResolvedValue(roster({ entries: [] }))
    lookupPortalAttendee.mockRejectedValue(
      new FakeApiError(404, { detail: { code: "attendee_not_found" } }),
    )
    renderPanel()

    fireEvent.change(
      await screen.findByLabelText("events.attendance.search_label"),
      { target: { value: "nobody@test.com" } },
    )
    fireEvent.click(screen.getByText("events.attendance.search_button"))

    expect(
      await screen.findByText("events.attendance.error_not_found"),
    ).toBeTruthy()
  })

  it("explains why attendance can't be turned off", async () => {
    getPortalAttendance.mockResolvedValue(roster())
    updatePortalEventAttendanceMode.mockRejectedValue(
      new FakeApiError(409, { detail: { code: "attendance_mode_locked" } }),
    )
    renderPanel()

    fireEvent.click(await screen.findByText("events.attendance.mode_none"))

    expect(
      await screen.findByText("events.attendance.error_mode_locked"),
    ).toBeTruthy()
    expect(updatePortalEventAttendanceMode).toHaveBeenCalledWith({
      eventId: "event-1",
      requestBody: { attendance_mode: "none" },
    })
  })
})
