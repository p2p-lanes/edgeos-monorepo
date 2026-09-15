import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
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
  useBlocker: (options: { shouldBlockFn: () => boolean; disabled: boolean }) => {
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
  default: () => ({ showSuccessToast: vi.fn(), showErrorToast: vi.fn() }),
}))

import { PopupsService } from "@/client"
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
})
