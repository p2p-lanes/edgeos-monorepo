import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { createInstance } from "i18next"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import en from "@/i18n/locales/en.json"
import es from "@/i18n/locales/es.json"
import is from "@/i18n/locales/is.json"
import zh from "@/i18n/locales/zh.json"

const mocks = vi.hoisted(() => ({
  search: "",
  translate: vi.fn((key: string, _options?: { count?: number }) => key),
  getEvent: vi.fn(),
  participants: vi.fn(),
  emails: vi.fn(),
  register: vi.fn(),
  attendance: vi.fn((_props: { occurrenceStart?: string | null }) => null),
  messages: vi.fn((_props: { occurrenceStart?: string | null }) => null),
}))

vi.mock("next/navigation", () => ({
  useParams: () => ({ eventId: "event-1" }),
  useSearchParams: () => new URLSearchParams(mocks.search),
  useRouter: () => ({ push: vi.fn() }),
}))
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: mocks.translate }),
}))
vi.mock("@edgeos/shared-form-ui", () => ({ MarkdownContent: () => null }))
vi.mock("@/providers/cityProvider", () => ({
  useCityProvider: () => ({
    getCity: () => ({ id: "popup-1", slug: "festival", status: "active" }),
  }),
}))
vi.mock("@/client", () => ({
  ApiError: Error,
  EventsService: {
    getPortalEvent: mocks.getEvent,
    getPortalEventAdminNotes: vi.fn(async () => ({ notes: null })),
    listPortalInvitations: vi.fn(async () => []),
  },
  EventParticipantsService: {
    listPortalParticipants: mocks.participants,
    listPortalAttendeeEmails: mocks.emails,
    registerForEvent: mocks.register,
  },
  HumansService: {
    getCurrentHumanInfo: vi.fn(async () => ({ id: "viewer-1" })),
  },
}))
vi.mock("../lib/useEventTimezone", () => ({
  useEventTimezone: () => ({
    timezone: "UTC",
    formatTime: (value: string) => value,
    formatDateFull: (value: string) => value,
    isLoading: false,
  }),
  usePortalEventSettings: () => ({ data: {} }),
}))
vi.mock("../lib/useCanRsvp", () => ({ useCanRsvp: () => ({ canRsvp: true }) }))
vi.mock("../lib/useCalendarAddedFlag", () => ({
  useCalendarAddedFlag: () => [false, vi.fn(), vi.fn()],
}))
vi.mock("../lib/EventAttendance", () => ({ EventAttendance: mocks.attendance }))
vi.mock("../lib/EventMessages", () => ({ EventMessages: mocks.messages }))
vi.mock("../lib/AddToCalendarModal", () => ({ AddToCalendarModal: () => null }))

import EventDetailPage from "./page"

const FIRST = "2031-03-03T10:00:00Z"
const SECOND = "2031-03-04T10:00:00Z"
const translations = createInstance()
translations.init({
  lng: "en",
  fallbackLng: "en",
  initAsync: false,
  resources: {
    en: { translation: en },
    es: { translation: es },
    is: { translation: is },
    zh: { translation: zh },
  },
})

function participant(name: string, status = "registered") {
  return {
    id: name,
    profile_id: name,
    first_name: name,
    role: "attendee",
    status,
  }
}

function event(overrides: Record<string, unknown> = {}) {
  return {
    id: "event-1",
    title: "Recurring class",
    owner_id: "viewer-1",
    status: "published",
    start_time: FIRST,
    end_time: "2031-03-03T11:00:00Z",
    rrule: "FREQ=DAILY;COUNT=3",
    collaborators: [],
    tags: [],
    attendee_count: 1,
    ...overrides,
  }
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <EventDetailPage />
    </QueryClientProvider>,
  )
  return client
}

afterEach(cleanup)
beforeEach(() => {
  vi.clearAllMocks()
  mocks.participants.mockReset()
  mocks.search = ""
  translations.changeLanguage("en")
  mocks.translate.mockImplementation((key, options) =>
    key.startsWith("events.detail.participants_")
      ? translations.t(key, options)
      : key,
  )
  mocks.getEvent.mockResolvedValue(event())
  mocks.participants.mockResolvedValue({ results: [] })
  mocks.emails.mockResolvedValue({ emails: [], count: 0 })
  mocks.register.mockResolvedValue({})
})

describe("participant roster summary", () => {
  it.each([
    1, 2,
  ])("shows and %i more after three visible names", async (extra) => {
    mocks.getEvent.mockResolvedValue(event({ attendee_count: 3 + extra }))
    mocks.participants.mockResolvedValue({
      results: [
        participant("Maria"),
        participant("Diego"),
        participant("Bruno"),
      ],
    })
    renderPage()
    expect(await screen.findByText(`and ${extra} more`)).toBeTruthy()
    for (const name of ["Maria", "Diego", "Bruno"]) {
      expect(screen.getByText(name)).toBeTruthy()
    }
    expect(screen.queryByText("events.detail.no_participants_yet")).toBeNull()
  })

  it.each([
    ["en", 1, "1 participant"],
    ["en", 4, "4 participants"],
    ["es", 1, "1 participante"],
    ["es", 4, "4 participantes"],
    ["is", 1, "1 þátttakandi"],
    ["is", 4, "4 þátttakendur"],
    ["zh", 1, "1 位参与者"],
    ["zh", 4, "4 位参与者"],
  ])("summarizes a roster with no visible names (%s, %i)", async (language, count, label) => {
    translations.changeLanguage(language as string)
    mocks.getEvent.mockResolvedValue(event({ attendee_count: count }))
    renderPage()
    expect(await screen.findByText(label as string)).toBeTruthy()
    expect(screen.queryByText(/^and \d+ more$/)).toBeNull()
    expect(screen.queryByText("events.detail.no_participants_yet")).toBeNull()
  })

  it.each([
    ["es", "y 1 más"],
    ["is", "og 1 í viðbót"],
    ["zh", "另有 1 人"],
  ])("localizes the extra-participant line (%s)", async (language, label) => {
    translations.changeLanguage(language)
    mocks.getEvent.mockResolvedValue(event({ attendee_count: 2 }))
    mocks.participants.mockResolvedValue({ results: [participant("Maria")] })
    renderPage()
    expect(await screen.findByText(label)).toBeTruthy()
  })

  it("does not treat cancelled rows as visible active participants", async () => {
    mocks.getEvent.mockResolvedValue(event({ attendee_count: 3 }))
    mocks.participants.mockResolvedValue({
      results: [
        participant("Maria"),
        participant("Bruno", "checked_in"),
        participant("Pablo", "cancelled"),
      ],
    })
    renderPage()
    expect(await screen.findByText("and 1 more")).toBeTruthy()
    expect(screen.queryByText("Pablo")).toBeNull()
  })

  it.each([
    3,
    2,
    null,
  ])("omits the line when there is no positive count difference (%s)", async (count) => {
    mocks.getEvent.mockResolvedValue(event({ attendee_count: count }))
    mocks.participants.mockResolvedValue({
      results: [
        participant("Maria"),
        participant("Diego"),
        participant("Bruno"),
      ],
    })
    renderPage()
    await screen.findByText("Maria")
    expect(screen.queryByText(/^and .* more$/)).toBeNull()
  })

  it("keeps the existing empty state when there are no active RSVPs", async () => {
    mocks.getEvent.mockResolvedValue(event({ attendee_count: 0 }))
    renderPage()
    expect(
      await screen.findByText("events.detail.no_participants_yet"),
    ).toBeTruthy()
    expect(screen.queryByText(/^and .* more$/)).toBeNull()
  })

  it("does not infer unlisted participants before the roster has loaded or on a failed request", async () => {
    mocks.getEvent.mockResolvedValue(event({ attendee_count: 4 }))
    mocks.participants.mockRejectedValue(new Error("Roster unavailable"))
    const client = renderPage()
    await waitFor(() =>
      expect(
        client.getQueryState(["portal-event-participants", "event-1", FIRST])
          ?.status,
      ).toBe("error"),
    )
    expect(screen.queryByText("4 participants")).toBeNull()
    expect(screen.queryByText("events.detail.no_participants_yet")).toBeNull()
  })

  it("shows a roster error with retry, rather than an empty or privacy summary", async () => {
    mocks.getEvent.mockResolvedValue(event({ attendee_count: 4 }))
    mocks.participants
      .mockRejectedValueOnce(new Error("Unavailable"))
      .mockResolvedValueOnce({ results: [participant("Maria")] })
    renderPage()
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Couldn't load participants.",
    )
    expect(screen.queryByText("4 participants")).toBeNull()
    expect(screen.queryByText(/^and .* more$/)).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Retry" }))
    expect(await screen.findByText("Maria")).toBeTruthy()
    expect(screen.getByText("and 3 more")).toBeTruthy()
  })

  it("keeps collapsed visible names separate from unlisted RSVPs", async () => {
    mocks.getEvent.mockResolvedValue(event({ attendee_count: 14 }))
    mocks.participants.mockResolvedValue({
      results: Array.from({ length: 12 }, (_, i) =>
        participant(`Person ${i + 1}`),
      ),
    })
    renderPage()
    expect(await screen.findByText("and 2 more")).toBeTruthy()
    expect(screen.queryByText("Person 11")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Show 2 more" }))
    expect(screen.getByText("Person 11")).toBeTruthy()
    expect(screen.getByText("and 2 more")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Show less" }))
    expect(screen.queryByText("Person 11")).toBeNull()
    expect(screen.getByText("and 2 more")).toBeTruthy()
  })

  it("loads later API pages before counting RSVPs absent from the roster", async () => {
    let finishPage!: (value: unknown) => void
    mocks.getEvent.mockResolvedValue(event({ attendee_count: 5 }))
    mocks.participants
      .mockResolvedValueOnce({
        results: [participant("Maria"), participant("Bruno")],
        paging: { offset: 0, limit: 3, total: 5 },
      })
      .mockReturnValueOnce(
        new Promise((resolve) => {
          finishPage = resolve
        }),
      )
    renderPage()
    await waitFor(() =>
      expect(mocks.participants).toHaveBeenCalledWith({
        eventId: "event-1",
        occurrenceStart: FIRST,
        skip: 3,
      }),
    )
    expect(screen.queryByText(/^and .* more$/)).toBeNull()
    expect(screen.queryByText("5 participants")).toBeNull()
    finishPage({
      results: [participant("Diego"), participant("Pablo", "cancelled")],
      paging: { offset: 3, limit: 3, total: 5 },
    })
    expect(await screen.findByText("and 2 more")).toBeTruthy()
    expect(screen.getByText("Diego")).toBeTruthy()
    expect(mocks.participants).toHaveBeenCalledTimes(2)
  })

  it("continues past a page where every name is filtered out", async () => {
    mocks.getEvent.mockResolvedValue(event({ attendee_count: 6 }))
    mocks.participants
      .mockResolvedValueOnce({
        results: [],
        paging: { offset: 0, limit: 3, total: 3 },
      })
      .mockResolvedValueOnce({
        results: [
          participant("Maria"),
          participant("Bruno"),
          participant("Diego"),
        ],
        paging: { offset: 3, limit: 3, total: 6 },
      })
    renderPage()
    expect(await screen.findByText("and 3 more")).toBeTruthy()
    expect(screen.getByText("Maria")).toBeTruthy()
    expect(mocks.participants).toHaveBeenCalledTimes(2)
  })
})

describe("portal roster occurrence selection", () => {
  it("defaults only the roster to the first date, preserving existing event reads and actions", async () => {
    renderPage()
    await waitFor(() =>
      expect(mocks.participants).toHaveBeenCalledWith({
        eventId: "event-1",
        occurrenceStart: FIRST,
      }),
    )
    expect(mocks.getEvent).toHaveBeenCalledWith({
      eventId: "event-1",
      occurrenceStart: undefined,
    })
    await waitFor(() => expect(mocks.messages).toHaveBeenCalled())
    expect(mocks.messages.mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({ occurrenceStart: null }),
    )
    fireEvent.click(
      screen.getByRole("button", {
        name: "events.detail.copy_attendee_emails",
      }),
    )
    await waitFor(() =>
      expect(mocks.emails).toHaveBeenCalledWith({
        eventId: "event-1",
        occurrenceStart: undefined,
      }),
    )
    fireEvent.click(screen.getByRole("button", { name: "events.rsvp.rsvp" }))
    await waitFor(() =>
      expect(mocks.register).toHaveBeenCalledWith({
        eventId: "event-1",
        requestBody: { occurrence_start: FIRST },
      }),
    )
  })

  it("uses the selected date for the roster while retaining frontend date presentation", async () => {
    mocks.search = `occ=${encodeURIComponent(SECOND)}`
    renderPage()
    await waitFor(() =>
      expect(mocks.participants).toHaveBeenCalledWith({
        eventId: "event-1",
        occurrenceStart: SECOND,
      }),
    )
    expect(screen.getByText(SECOND)).toBeTruthy()
    expect(
      screen.getByText(`${SECOND} – 2031-03-04T11:00:00.000Z`),
    ).toBeTruthy()
  })

  it.each([
    null,
    "master-1",
  ])("does not send a recurring date for a one-off/detached event (%s)", async (master) => {
    mocks.getEvent.mockResolvedValue(
      event({
        rrule: null,
        recurrence_master_id: master,
      }),
    )
    renderPage()
    await waitFor(() =>
      expect(mocks.participants).toHaveBeenCalledWith({
        eventId: "event-1",
        occurrenceStart: undefined,
      }),
    )
  })
})
