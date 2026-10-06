/**
 * The operator's attendance card (SIM-106).
 *
 * Pins what reaches the API (the occurrence a mark or void targets, and the
 * void reason) and which actions are offered: none outside the check-in
 * window, and nothing but the mode picker while attendance is off.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/client", () => ({
  EventParticipantsService: {
    getAttendance: vi.fn(),
    lookupAttendee: vi.fn(),
    adminManualCheckIn: vi.fn(),
    adminVoidCheckIn: vi.fn(),
  },
  EventsService: {
    updateEventAttendanceMode: vi.fn(),
  },
}))

const showErrorToast = vi.fn()
vi.mock("@/hooks/useCustomToast", () => ({
  default: () => ({
    showSuccessToast: vi.fn(),
    showErrorToast,
  }),
}))

import { EventParticipantsService } from "@/client"
import { EventAttendanceCard } from "./EventAttendanceCard"

const getAttendance = vi.mocked(EventParticipantsService.getAttendance)
const lookupAttendee = vi.mocked(EventParticipantsService.lookupAttendee)
const markPresent = vi.mocked(EventParticipantsService.adminManualCheckIn)
const voidCheckIn = vi.mocked(EventParticipantsService.adminVoidCheckIn)

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
  } as never
}

function renderCard(occurrenceStart: string | null = null) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  return render(
    <EventAttendanceCard
      eventId="event-1"
      occurrenceStart={occurrenceStart}
      timezone="UTC"
    />,
    { wrapper },
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("EventAttendanceCard", () => {
  it("marks an RSVP present for the occurrence on screen", async () => {
    getAttendance.mockResolvedValue(roster())
    markPresent.mockResolvedValue({ entry: entry() } as never)
    renderCard(OCC)

    await userEvent.click(
      await screen.findByRole("button", { name: "Mark present" }),
    )

    await waitFor(() =>
      expect(markPresent).toHaveBeenCalledWith({
        eventId: "event-1",
        requestBody: { profile_id: "h-1", occurrence_start: OCC },
      }),
    )
    expect(getAttendance).toHaveBeenCalledWith({
      eventId: "event-1",
      occurrenceStart: OCC,
    })
  })

  it("sends the void reason", async () => {
    getAttendance.mockResolvedValue(
      roster({ entries: [entry({ status: "checked_in" })] }),
    )
    voidCheckIn.mockResolvedValue(entry() as never)
    renderCard()

    await userEvent.click(await screen.findByRole("button", { name: /Void/ }))
    const confirm = screen.getByRole("button", { name: "Void check-in" })
    expect(confirm).toHaveProperty("disabled", true)
    await userEvent.type(
      screen.getByLabelText("Why is this check-in being voided?"),
      "Wrong person",
    )
    await userEvent.click(confirm)

    await waitFor(() =>
      expect(voidCheckIn).toHaveBeenCalledWith({
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
    getAttendance.mockResolvedValue(
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
    renderCard()

    await screen.findByText(/Check-in closed/)
    expect(screen.queryByRole("button", { name: "Mark present" })).toBeNull()
    expect(screen.queryByRole("button", { name: /Void/ })).toBeNull()
    expect(screen.queryByLabelText("Find someone by email")).toBeNull()
  })

  it("shows no roll call while attendance is off", async () => {
    getAttendance.mockResolvedValue(roster({ attendance_mode: "none" }))
    renderCard()

    await screen.findByText("Attendance is off for this event.")
    expect(screen.queryByText("Ada Lovelace")).toBeNull()
  })

  it("surfaces a failed lookup's message", async () => {
    getAttendance.mockResolvedValue(roster({ entries: [] }))
    lookupAttendee.mockRejectedValue({
      body: {
        detail: {
          code: "attendee_not_found",
          message: "No one who can attend matches that email.",
        },
      },
    })
    renderCard()

    await userEvent.type(
      await screen.findByLabelText("Find someone by email"),
      "nobody@test.com",
    )
    await userEvent.click(screen.getByRole("button", { name: /Find/ }))

    await waitFor(() =>
      expect(showErrorToast).toHaveBeenCalledWith(
        "No one who can attend matches that email.",
      ),
    )
  })
})
