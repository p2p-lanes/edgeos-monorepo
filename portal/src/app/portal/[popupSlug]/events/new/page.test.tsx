import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// ---------------------------------------------------------------------------
// Mocks
//
// The wrapper-vs-form split (NewPortalEventPage → NewPortalEventForm) exists
// solely to guarantee `displayTz` is the popup's real timezone before
// `useEventScheduling` runs its lazy init. These tests pin that contract.
//
// We mock the child components (form fields, venue availability) because
// their internals aren't the unit under test; we want to assert what the
// wrapper does with `settings.timezone` and what it forwards into
// `EventsService.createPortalEvent` on submit.
// ---------------------------------------------------------------------------

// next/navigation — stubs router/push/pathname so the form's Link/Cancel
// button don't crash and we can spy on navigation.
const mockPush = vi.fn()
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => "/portal/festival/events/new",
}))

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    // Echo back the key with a tag of the interpolated `timezone`. That
    // lets `getByText` assertions confirm the resolved displayTz is what
    // the wrapper passed in.
    t: (key: string, vars?: Record<string, string>) => {
      if (vars && Object.keys(vars).length > 0) {
        const parts = Object.entries(vars)
          .map(([k, v]) => `${k}=${v}`)
          .join(";")
        return `${key}|${parts}`
      }
      return key
    },
  }),
}))

const mockCity = {
  id: "city-1",
  slug: "festival",
  name: "Festival",
  events_enabled: true,
  start_date: "2026-06-01",
  end_date: "2026-06-30",
}

vi.mock("@/providers/cityProvider", () => ({
  useCityProvider: () => ({ getCity: () => mockCity }),
}))

// Toast: no-op so the submit success branch doesn't throw.
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

// Stub the child form/field components — they're rendered but their inner
// DOM isn't what we're testing. The venue field stub exposes a button that
// picks the explicit "virtual meeting" option — there is no location
// default anymore, and `canSubmit` requires a choice.
vi.mock("../components/EventVenueField", () => ({
  EventVenueField: ({
    onVenueChange,
  }: {
    onVenueChange: (next: string) => void
  }) => (
    <button
      type="button"
      data-testid="venue-field"
      onClick={() => onVenueChange("__meeting__")}
    />
  ),
}))
// MarkdownEditor drags tiptap/prosemirror into jsdom, which can't mount a
// real contenteditable view — stub it down to a plain textarea.
vi.mock("@edgeos/shared-form-ui", () => ({
  MarkdownEditor: ({ id }: { id?: string }) => <textarea id={id} />,
}))
vi.mock("../components/EventScheduleFields", () => ({
  EventScheduleFields: () => <div data-testid="schedule-fields" />,
}))
vi.mock("../components/HostDisplayField", () => ({
  HostDisplayField: () => <div data-testid="host-field" />,
}))
vi.mock("@/components/CoverImageCropper", () => ({
  CoverImageCropper: () => null,
}))

// Stub the auxiliary hooks the form uses; their internals are tested
// elsewhere and would otherwise drag in TanStack Query / fetch.
vi.mock("../lib/useVenueAvailability", () => ({
  useVenueAvailability: () => ({
    venues: [],
    selectedVenue: undefined,
    isVenueClosedOnDay: undefined,
    selectedDateIsClosed: false,
    startOptions: [],
    nearbyStartOptions: [],
    withinOpenHours: true,
    availability: "idle",
    availabilityData: undefined,
    effectiveBookingMode: null,
  }),
}))
vi.mock("../lib/useFileUpload", () => ({
  useFileUpload: () => ({
    uploadFile: vi.fn(),
    isUploading: false,
  }),
}))

// usePortalEventSettings — drives the loading/gating flow under test.
// Each test overrides the returned settings via `mockSettingsResult`.
type SettingsResult = {
  data:
    | {
        event_enabled?: boolean
        can_publish_event?: string
        timezone?: string | null
        allowed_tags?: string[]
      }
    | undefined
  isLoading: boolean
}
let mockSettingsResult: SettingsResult = { data: undefined, isLoading: true }
vi.mock("../lib/useEventTimezone", () => ({
  usePortalEventSettings: () => mockSettingsResult,
}))

// Capture the create-event payload so the most important test —
// "submitted payload uses the resolved displayTz, not a UTC fallback" —
// can read it without going through Axios.
const mockCreatePortalEvent = vi.fn(async (args: { requestBody: unknown }) => ({
  id: "evt-1",
  status: "published",
  ...((args.requestBody as Record<string, unknown>) ?? {}),
}))

vi.mock("@/client", () => ({
  // Stub ApiError; the wrapper only references it inside an onError branch
  // that submit-success tests don't exercise. A simple class is enough.
  ApiError: class ApiError extends Error {
    body: unknown
    constructor(message: string) {
      super(message)
      this.body = null
    }
  },
  EventSettingsService: {},
  EventsService: {
    createPortalEvent: (args: { requestBody: unknown }) =>
      mockCreatePortalEvent(args),
  },
  HumansService: {
    getCurrentHumanInfo: async () => ({ id: "h-1", first_name: "Test" }),
  },
  TracksService: {
    listPortalTracks: async () => ({ results: [] }),
  },
}))

// TanStack Query — useQuery is keyed on `queryKey`; we hand back different
// shapes per key so the form doesn't crash on null returns.
vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => {
    const key = queryKey[0]
    if (key === "currentHuman") {
      return {
        data: { id: "h-1", first_name: "Test", last_name: "User" },
        isLoading: false,
      }
    }
    if (key === "portal-tracks") {
      return { data: { results: [] }, isLoading: false }
    }
    return { data: null, isLoading: false }
  },
  useMutation: <T,>({
    mutationFn,
    onSuccess,
  }: {
    mutationFn: () => Promise<T>
    onSuccess?: (data: T) => void
  }) => ({
    mutate: async () => {
      const result = await mutationFn()
      onSuccess?.(result)
    },
    isPending: false,
  }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}))

import NewPortalEventPage from "./page"

beforeEach(() => {
  mockPush.mockClear()
  mockCreatePortalEvent.mockClear()
  mockSettingsResult = { data: undefined, isLoading: true }
})

afterEach(() => {
  vi.clearAllMocks()
})

describe("NewPortalEventPage – wrapper gating + displayTz contract", () => {
  it("renders the loader while settings are loading and does NOT mount the form", () => {
    mockSettingsResult = { data: undefined, isLoading: true }

    render(<NewPortalEventPage />)

    // The form's heading must be absent — the wrapper has not mounted
    // `NewPortalEventForm` yet, so `useEventScheduling` hasn't initialised.
    expect(screen.queryByText(/events\.form\.create_heading/)).toBeNull()
    expect(screen.queryByTestId("schedule-fields")).toBeNull()
  })

  it("mounts the form with the resolved popup timezone once settings load", async () => {
    mockSettingsResult = {
      data: {
        event_enabled: true,
        can_publish_event: "everyone",
        timezone: "America/Los_Angeles",
        allowed_tags: [],
      },
      isLoading: false,
    }

    render(<NewPortalEventPage />)

    // Subheading interpolates the resolved tz — proves the wrapper passed
    // the real popup tz (not "UTC") into the form.
    await waitFor(() => {
      expect(screen.getByText(/timezone=America\/Los_Angeles/)).toBeTruthy()
    })
    expect(screen.getByTestId("schedule-fields")).toBeTruthy()
  })

  it("settings without a timezone fall back to UTC but still mount the form", async () => {
    // The wrapper has a defensive `settings?.timezone || "UTC"`. This
    // guards against an empty-string regression from the upstream
    // settings response.
    mockSettingsResult = {
      data: {
        event_enabled: true,
        can_publish_event: "everyone",
        timezone: "",
        allowed_tags: [],
      },
      isLoading: false,
    }

    render(<NewPortalEventPage />)

    await waitFor(() => {
      expect(screen.getByText(/timezone=UTC/)).toBeTruthy()
    })
    expect(screen.getByTestId("schedule-fields")).toBeTruthy()
  })

  it("event_enabled=false renders the gated message instead of the form", async () => {
    mockSettingsResult = {
      data: {
        event_enabled: false,
        can_publish_event: "everyone",
        timezone: "America/Los_Angeles",
        allowed_tags: [],
      },
      isLoading: false,
    }

    render(<NewPortalEventPage />)

    await waitFor(() => {
      expect(
        screen.getByText(/events\.list\.events_disabled_heading/),
      ).toBeTruthy()
    })
    expect(screen.queryByTestId("schedule-fields")).toBeNull()
  })

  it("can_publish_event='admin_only' renders the restricted message instead of the form", async () => {
    mockSettingsResult = {
      data: {
        event_enabled: true,
        can_publish_event: "admin_only",
        timezone: "America/Los_Angeles",
        allowed_tags: [],
      },
      isLoading: false,
    }

    render(<NewPortalEventPage />)

    await waitFor(() => {
      expect(
        screen.getByText(/events\.form\.creation_restricted_heading/),
      ).toBeTruthy()
    })
    expect(screen.queryByTestId("schedule-fields")).toBeNull()
  })

  it("submit forwards the resolved displayTz — never a UTC fallback — to createPortalEvent", async () => {
    // This is the headline guard against the original bug. If a future
    // refactor reintroduces `timezone || "UTC"` at submit time, the form
    // would call createPortalEvent with timezone="UTC" even though the
    // popup runs in LA. We assert the exact tz string round-trips.
    mockSettingsResult = {
      data: {
        event_enabled: true,
        can_publish_event: "everyone",
        timezone: "America/Los_Angeles",
        allowed_tags: [],
      },
      isLoading: false,
    }

    const { container } = render(<NewPortalEventPage />)

    await waitFor(() => {
      expect(screen.getByTestId("schedule-fields")).toBeTruthy()
    })

    // Fill the title, pick the explicit "virtual meeting" location (no
    // location is selected by default), and fill the meeting URL it
    // requires to pass `canSubmit`.
    const titleInput = container.querySelector(
      "input#title",
    ) as HTMLInputElement
    expect(titleInput).toBeTruthy()
    fireEvent.change(titleInput, { target: { value: "My LA Event" } })

    fireEvent.click(screen.getByTestId("venue-field"))

    const meetingInput = container.querySelector(
      "input#meeting",
    ) as HTMLInputElement | null
    expect(meetingInput).toBeTruthy()
    fireEvent.change(meetingInput as HTMLInputElement, {
      target: { value: "https://meet.example.com/abc" },
    })

    // Submitting the form triggers createMutation → createPortalEvent. The
    // form's onSubmit handler also runs through React, so fireEvent.submit
    // exercises the same canSubmit gate the user would hit.
    const form = container.querySelector("form")
    expect(form).toBeTruthy()
    fireEvent.submit(form as HTMLFormElement)

    await waitFor(() => {
      expect(mockCreatePortalEvent).toHaveBeenCalled()
    })

    const payload = mockCreatePortalEvent.mock.calls.at(-1)?.[0]?.requestBody as
      | Record<string, unknown>
      | undefined
    expect(payload).toBeTruthy()
    expect(payload?.timezone).toBe("America/Los_Angeles")
    // The popup_id forwarded must be the same as the city id the wrapper
    // resolved — extra sanity check that the wrapper-to-form prop flow is
    // intact.
    expect(payload?.popup_id).toBe(mockCity.id)
  })

  it("a pending_approval result swaps the form for the success screen instead of redirecting", async () => {
    mockSettingsResult = {
      data: {
        event_enabled: true,
        can_publish_event: "everyone",
        timezone: "America/Los_Angeles",
        allowed_tags: [],
      },
      isLoading: false,
    }
    mockCreatePortalEvent.mockImplementationOnce(async () => ({
      id: "evt-2",
      status: "pending_approval",
    }))

    const { container } = render(<NewPortalEventPage />)

    await waitFor(() => {
      expect(screen.getByTestId("schedule-fields")).toBeTruthy()
    })

    const titleInput = container.querySelector(
      "input#title",
    ) as HTMLInputElement
    fireEvent.change(titleInput, { target: { value: "Needs approval" } })
    fireEvent.click(screen.getByTestId("venue-field"))
    fireEvent.change(
      container.querySelector("input#meeting") as HTMLInputElement,
      { target: { value: "https://meet.example.com/abc" } },
    )
    fireEvent.submit(container.querySelector("form") as HTMLFormElement)

    await waitFor(() => {
      expect(
        screen.getByText(/events\.form\.pending_success_heading/),
      ).toBeTruthy()
    })
    expect(
      screen.getByText(/events\.form\.pending_success_message/),
    ).toBeTruthy()
    // No redirect — the user stays on the success screen with links out.
    expect(mockPush).not.toHaveBeenCalled()
    expect(screen.queryByTestId("schedule-fields")).toBeNull()
  })
})
