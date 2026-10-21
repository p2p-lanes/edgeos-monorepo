import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  showErrorToast: vi.fn(),
  blockerOptions: null as {
    shouldBlockFn: () => boolean
    disabled: boolean
  } | null,
}))

const { emptyList } = vi.hoisted(() => ({
  emptyList: { results: [], paging: { limit: 100, offset: 0, total: 0 } },
}))

vi.mock("@/client", () => ({
  EventSettingsService: {
    getEventSettings: vi.fn().mockResolvedValue({ timezone: "UTC" }),
  },
  EventsService: {
    checkAvailability: vi.fn().mockResolvedValue({ available: true }),
    checkRecurringAvailability: vi.fn().mockResolvedValue({}),
    createEvent: vi.fn(),
    updateEvent: vi.fn(),
    deleteEvent: vi.fn(),
    listInvitations: vi.fn().mockResolvedValue([]),
    listOverrides: vi.fn().mockResolvedValue([]),
    bulkInvite: vi.fn(),
    deleteInvitation: vi.fn(),
    setRecurrence: vi.fn(),
  },
  EventVenuesService: {
    listVenues: vi.fn().mockResolvedValue(emptyList),
    getVenue: vi.fn(),
    getAvailability: vi.fn(),
  },
  HumansService: { listHumans: vi.fn().mockResolvedValue(emptyList) },
  // A future popup window, so the create form seeds its date to the first
  // open day on mount.
  PopupsService: {
    getPopup: vi.fn().mockResolvedValue({
      id: "popup-1",
      name: "Test popup",
      start_date: "2030-01-10T00:00:00",
      end_date: "2030-01-20T00:00:00",
    }),
  },
  TracksService: { listTracks: vi.fn().mockResolvedValue(emptyList) },
}))

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => <>{children}</>,
  useNavigate: () => vi.fn(),
  useBlocker: (options: {
    shouldBlockFn: () => boolean
    disabled: boolean
  }) => {
    mocks.blockerOptions = options
    return { status: "unblocked" }
  },
}))

vi.mock("@edgeos/shared-form-ui", () => ({
  MarkdownEditor: ({
    value,
    onChange,
  }: {
    value: string
    onChange: (v: string) => void
  }) => (
    <textarea
      aria-label="Description"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}))

vi.mock("@/contexts/WorkspaceContext", () => ({
  useWorkspace: () => ({ selectedPopupId: "popup-1", isContextReady: true }),
}))

vi.mock("@/hooks/useAuth", () => ({
  default: () => ({
    user: { id: "user-1", full_name: "Admin", email: "admin@example.com" },
    isOperatorOrAbove: true,
    isAdmin: true,
    isSuperadmin: true,
  }),
}))

vi.mock("@/hooks/useCustomToast", () => ({
  default: () => ({
    showSuccessToast: vi.fn(),
    showErrorToast: mocks.showErrorToast,
  }),
}))

// Keep the real recurrence parsing/building; simplify only the picker UI.
vi.mock("./EventForm/RepeatPicker", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./EventForm/RepeatPicker")>()
  return {
    ...actual,
    RepeatPicker: ({
      value,
      onChange,
    }: {
      value: import("./EventForm/RepeatPicker").RepeatState
      onChange: (value: import("./EventForm/RepeatPicker").RepeatState) => void
    }) => (
      <select
        aria-label="Repeats"
        value={value.mode}
        onChange={(e) =>
          onChange({ ...value, mode: e.target.value as typeof value.mode })
        }
      >
        <option value="none">Does not repeat</option>
        <option value="weekly">Weekly</option>
        <option value="daily">Daily</option>
      </select>
    ),
  }
})

vi.mock("./EventForm/StartTimeSelect", () => ({
  StartTimeSelect: ({
    value,
    onChange,
  }: {
    value: string
    onChange: (value: string) => void
  }) => (
    <input
      aria-label="Start time"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}))

import { type EventPublic, EventsService, PopupsService } from "@/client"
import { EventForm } from "./EventForm"

function Wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

describe("EventForm unsaved changes (create)", () => {
  beforeEach(() => {
    mocks.blockerOptions = null
  })

  it("does not block leaving an untouched form, even after Save as Draft", async () => {
    const user = userEvent.setup()
    render(<EventForm popupTimezone="UTC" onSuccess={vi.fn()} />, {
      wrapper: Wrapper,
    })

    // Wait for the popup to load and the date to be seeded.
    await waitFor(() => expect(PopupsService.getPopup).toHaveBeenCalled())
    await screen.findByText(/2030/)
    expect(mocks.blockerOptions?.disabled).toBe(true)

    await user.click(screen.getByRole("button", { name: "Save as Draft" }))

    await waitFor(() => expect(mocks.blockerOptions?.disabled).toBe(true))
    expect(mocks.blockerOptions?.shouldBlockFn()).toBe(false)
  })

  it("still blocks leaving after a real edit", async () => {
    const user = userEvent.setup()
    render(<EventForm popupTimezone="UTC" onSuccess={vi.fn()} />, {
      wrapper: Wrapper,
    })

    await user.type(screen.getByPlaceholderText("Event Title"), "Workshop")

    await waitFor(() => expect(mocks.blockerOptions?.disabled).toBe(false))
    expect(mocks.blockerOptions?.shouldBlockFn()).toBe(true)
  })

  it("blocks leaving after a duration-only change", async () => {
    const user = userEvent.setup()
    render(<EventForm popupTimezone="UTC" onSuccess={vi.fn()} />, {
      wrapper: Wrapper,
    })

    await screen.findByText(/2030/)
    expect(mocks.blockerOptions?.disabled).toBe(true)

    await user.click(screen.getByRole("button", { name: "2 h" }))

    await waitFor(() => expect(mocks.blockerOptions?.disabled).toBe(false))
    expect(mocks.blockerOptions?.shouldBlockFn()).toBe(true)
  })
})

const recurringEvent: EventPublic = {
  id: "event-1",
  tenant_id: "tenant-1",
  popup_id: "popup-1",
  owner_id: "human-1",
  title: "Orientation",
  start_time: "2030-01-14T07:00:00Z",
  end_time: "2030-01-14T07:30:00Z",
  timezone: "Asia/Kolkata",
  status: "published",
  custom_location_name: "Test Hall",
  custom_location_url: "https://maps.test/hall",
  rrule: "FREQ=WEEKLY;INTERVAL=1;BYDAY=MO;COUNT=3",
  recurrence_exdates: ["2030-01-21T07:00:00Z"],
}

describe("EventForm atomic recurrence updates", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(EventsService.updateEvent).mockResolvedValue(recurringEvent)
  })

  it.each([
    "none",
    "daily",
  ])("sends the new time and %s recurrence in a single update", async (mode) => {
    const user = userEvent.setup()
    const onSuccess = vi.fn()
    render(
      <EventForm
        defaultValues={recurringEvent}
        popupTimezone="Asia/Kolkata"
        onSuccess={onSuccess}
      />,
      {
        wrapper: Wrapper,
      },
    )
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Repeats" }),
      mode,
    )
    fireEvent.change(screen.getByRole("textbox", { name: "Start time" }), {
      target: { value: "12:00" },
    })
    await user.click(screen.getByRole("button", { name: "Publish Event" }))

    await waitFor(() => expect(onSuccess).toHaveBeenCalledOnce())
    expect(EventsService.updateEvent).toHaveBeenCalledOnce()
    expect(EventsService.updateEvent).toHaveBeenCalledWith({
      eventId: recurringEvent.id,
      requestBody: expect.objectContaining({
        start_time: "2030-01-14T06:30:00.000Z",
        end_time: "2030-01-14T07:00:00.000Z",
        recurrence:
          mode === "none" ? null : { freq: "DAILY", interval: 1, count: 3 },
      }),
    })
    expect(EventsService.setRecurrence).not.toHaveBeenCalled()
  })

  it("saves a quick-picked duration as the new end time", async () => {
    const user = userEvent.setup()
    const onSuccess = vi.fn()
    render(
      <EventForm
        defaultValues={recurringEvent}
        popupTimezone="Asia/Kolkata"
        onSuccess={onSuccess}
      />,
      { wrapper: Wrapper },
    )
    // Seeded from the stored 30-minute range; 12:30 IST + 30 min.
    expect(
      screen
        .getByRole("button", { name: "30 min" })
        .getAttribute("aria-pressed"),
    ).toBe("true")
    expect(screen.getByText("Ends at 13:00")).toBeTruthy()

    await user.click(screen.getByRole("button", { name: "1 h 30 min" }))
    expect(screen.getByText("Ends at 14:00")).toBeTruthy()
    await user.click(screen.getByRole("button", { name: "Publish Event" }))

    await waitFor(() => expect(onSuccess).toHaveBeenCalledOnce())
    expect(EventsService.updateEvent).toHaveBeenCalledWith({
      eventId: recurringEvent.id,
      requestBody: expect.objectContaining({
        start_time: "2030-01-14T07:00:00.000Z",
        end_time: "2030-01-14T08:30:00.000Z",
      }),
    })
  })

  it("refuses to save a zero duration", async () => {
    const user = userEvent.setup()
    render(
      <EventForm
        defaultValues={recurringEvent}
        popupTimezone="Asia/Kolkata"
        onSuccess={vi.fn()}
      />,
      { wrapper: Wrapper },
    )
    fireEvent.change(screen.getByLabelText("Minutes"), {
      target: { value: "0" },
    })
    expect(screen.getByRole("alert").textContent).toBe(
      "Duration must be greater than 0.",
    )

    await user.click(screen.getByRole("button", { name: "Publish Event" }))

    await waitFor(() =>
      expect(mocks.showErrorToast).toHaveBeenCalledWith(
        "Duration must be greater than 0.",
      ),
    )
    expect(EventsService.updateEvent).not.toHaveBeenCalled()
  })

  it("omits unchanged recurrence to preserve stored EXDATEs", async () => {
    const user = userEvent.setup()
    render(
      <EventForm
        defaultValues={recurringEvent}
        popupTimezone="Asia/Kolkata"
        onSuccess={vi.fn()}
      />,
      {
        wrapper: Wrapper,
      },
    )
    await user.click(screen.getByRole("button", { name: "Publish Event" }))
    await waitFor(() =>
      expect(EventsService.updateEvent).toHaveBeenCalledOnce(),
    )
    const body = vi.mocked(EventsService.updateEvent).mock.calls[0][0]
      .requestBody
    expect(body).not.toHaveProperty("recurrence")
    expect(EventsService.setRecurrence).not.toHaveBeenCalled()
  })

  it("does not make a second mutation after a rejected atomic update", async () => {
    vi.mocked(EventsService.updateEvent).mockRejectedValue(
      new Error("Venue already booked"),
    )
    const user = userEvent.setup()
    const onSuccess = vi.fn()
    render(
      <EventForm
        defaultValues={recurringEvent}
        popupTimezone="Asia/Kolkata"
        onSuccess={onSuccess}
      />,
      {
        wrapper: Wrapper,
      },
    )
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Repeats" }),
      "none",
    )
    await user.click(screen.getByRole("button", { name: "Publish Event" }))
    await waitFor(() => expect(mocks.showErrorToast).toHaveBeenCalled())
    expect(EventsService.updateEvent).toHaveBeenCalledOnce()
    expect(EventsService.setRecurrence).not.toHaveBeenCalled()
    expect(onSuccess).not.toHaveBeenCalled()
  })
})
