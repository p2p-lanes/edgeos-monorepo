import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  occ: undefined as string | undefined,
  getEvent: vi.fn(),
  summary: vi.fn(),
  participants: vi.fn(),
  attendance: vi.fn((_props: { occurrenceStart: string | null }) => null),
}))

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: { component: () => ReactNode }) => ({
    options,
    useParams: () => ({ eventId: "event-1" }),
    useSearch: () => ({ occ: mocks.occ }),
  }),
  useNavigate: () => vi.fn(),
  Link: ({
    children,
    params,
  }: {
    children: ReactNode
    params: { eventId: string }
  }) => <a href={`/events/${params.eventId}`}>{children}</a>,
}))
vi.mock("@edgeos/shared-form-ui", () => ({ MarkdownContent: () => null }))
vi.mock("@/client", () => ({
  ApiError: Error,
  EventsService: {
    getEvent: mocks.getEvent,
    getEventSeriesSummary: mocks.summary,
  },
  EventParticipantsService: { listParticipants: mocks.participants },
  TenantsService: { getTenant: vi.fn(async () => ({ slug: "festival" })) },
  PopupsService: { getPopup: vi.fn(async () => ({ slug: "festival" })) },
}))
vi.mock("@/contexts/WorkspaceContext", () => ({
  useWorkspace: () => ({ effectiveTenantId: "tenant-1" }),
}))
vi.mock("@/hooks/useCustomToast", () => ({
  default: () => ({ showSuccessToast: vi.fn(), showErrorToast: vi.fn() }),
}))
vi.mock("@/components/Common/FormPageLayout", () => ({
  FormPageLayout: ({
    children,
    description,
  }: {
    children: ReactNode
    description: string
  }) => (
    <div>
      <p>{description}</p>
      {children}
    </div>
  ),
}))
vi.mock("@/components/Common/QueryErrorBoundary", () => ({
  QueryErrorBoundary: ({ children }: { children: ReactNode }) => children,
}))
vi.mock("@/components/events/EventAttendanceCard", () => ({
  EventAttendanceCard: mocks.attendance,
}))

import { Route } from "./$eventId"

const FIRST = "2031-03-03T10:00:00Z"
const SECOND = "2031-03-04T10:00:00Z"

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const Page = Route.options.component!
  render(
    <QueryClientProvider client={client}>
      <Page />
    </QueryClientProvider>,
  )
}

afterEach(cleanup)
beforeEach(() => {
  vi.clearAllMocks()
  mocks.occ = undefined
  mocks.participants.mockResolvedValue({ results: [] })
})

describe("backoffice participants by occurrence", () => {
  it("keeps the current participants and attendance scoped when all other rosters are shown", async () => {
    mocks.getEvent.mockResolvedValue({
      id: "event-1",
      popup_id: "popup-1",
      title: "Recurring class",
      start_time: FIRST,
      end_time: "2031-03-03T11:00:00Z",
      timezone: "UTC",
      rrule: "FREQ=DAILY;COUNT=3",
      attendee_count: 1,
      status: "published",
      visibility: "public",
    })
    mocks.summary.mockResolvedValue({
      series_id: "event-1",
      series_title: "Recurring class",
      timezone: "UTC",
      window_start: FIRST,
      window_end: "2031-03-06T10:00:00Z",
      occurrences: [
        {
          event_id: "event-1",
          occurrence_start: SECOND,
          start_time: SECOND,
          end_time: "2031-03-04T11:00:00Z",
          timezone: "UTC",
          attendee_count: 1,
          title: "Recurring class",
          status: "published",
          is_detached: false,
        },
      ],
    })
    mocks.participants.mockImplementation(async ({ occurrenceStart }) => ({
      results: [
        {
          id: occurrenceStart,
          first_name:
            occurrenceStart === FIRST ? "Current attendee" : "Other attendee",
          status: "registered",
          role: "attendee",
        },
      ],
    }))
    renderPage()
    await screen.findByText("Current attendee")
    expect(mocks.summary).not.toHaveBeenCalled()
    fireEvent.click(
      screen.getByRole("button", { name: /Other occurrences in this series/ }),
    )
    await screen.findByText("Other attendee")
    expect(screen.getByText("Current attendee")).toBeTruthy()
    expect(mocks.attendance.mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({ occurrenceStart: FIRST }),
    )
    expect(mocks.participants).toHaveBeenCalledWith({
      eventId: "event-1",
      occurrenceStart: SECOND,
      scopeToOccurrence: true,
    })
  })

  it("does not show a series section for an unrelated one-off", async () => {
    mocks.getEvent.mockResolvedValue({
      id: "event-1",
      popup_id: "popup-1",
      title: "One-off",
      start_time: FIRST,
      end_time: "2031-03-03T11:00:00Z",
      timezone: "UTC",
      rrule: null,
      status: "published",
      visibility: "public",
    })
    renderPage()
    await screen.findByRole("heading", { name: "Participants" })
    expect(
      screen.queryByRole("button", {
        name: /Other occurrences in this series/,
      }),
    ).toBeNull()
    expect(mocks.summary).not.toHaveBeenCalled()
  })

  it.each([
    undefined,
    SECOND,
  ])("selects the roster in the frontend without changing raw event reads when occ is %s", async (occ) => {
    mocks.occ = occ
    const selected = occ ?? FIRST
    mocks.getEvent.mockResolvedValue({
      id: "event-1",
      popup_id: "popup-1",
      title: "Recurring class",
      start_time: FIRST,
      end_time: "2031-03-03T11:00:00Z",
      timezone: "UTC",
      rrule: "FREQ=DAILY;COUNT=3",
      attendee_count: 99,
      status: "published",
      visibility: "public",
    })
    mocks.participants.mockResolvedValue({
      results: [
        {
          id: "1",
          first_name: "Maria",
          status: "registered",
          role: "attendee",
        },
        {
          id: "2",
          first_name: "Bruno",
          status: "checked_in",
          role: "attendee",
        },
        { id: "3", first_name: "Pablo", status: "cancelled", role: "attendee" },
      ],
    })
    renderPage()
    await waitFor(() =>
      expect(mocks.participants).toHaveBeenCalledWith({
        eventId: "event-1",
        occurrenceStart: selected,
        scopeToOccurrence: true,
      }),
    )
    expect(mocks.getEvent).toHaveBeenCalledWith({
      eventId: "event-1",
    })
    expect(mocks.attendance.mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({ occurrenceStart: selected }),
    )
    const expectedDay = occ ? "Tue, Mar 4, 2031" : "Mon, Mar 3, 2031"
    expect(screen.getAllByText(new RegExp(expectedDay)).length).toBeGreaterThan(
      0,
    )
    expect(await screen.findByText("2")).toBeTruthy()
    expect(screen.queryByText("99")).toBeNull()
    expect(screen.queryByText("Pablo")).toBeNull()
  })
})
