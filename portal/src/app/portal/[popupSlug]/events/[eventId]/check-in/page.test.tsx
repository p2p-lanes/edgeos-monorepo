import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { createElement } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import EventCheckInPage from "./page"

const checkIn = vi.fn()
const searchParams = new Map<string, string>()

// vi.mock factories are hoisted above the module body, so the stand-in for
// ApiError has to be hoisted with them.
const { FakeApiError } = vi.hoisted(() => {
  class FakeApiError extends Error {
    constructor(
      public status: number,
      public body: unknown,
    ) {
      super("api error")
    }
  }
  return { FakeApiError }
})

vi.mock("@/client", () => ({
  ApiError: FakeApiError,
  EventParticipantsService: {
    checkIn: (...args: unknown[]) => checkIn(...args),
  },
}))

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock("next/navigation", () => ({
  useParams: () => ({ popupSlug: "edge-city", eventId: "event-1" }),
  useSearchParams: () => ({
    get: (key: string) => searchParams.get(key) ?? null,
  }),
}))

vi.mock("@/providers/cityProvider", () => ({
  useCityProvider: () => ({
    getCity: () => ({ id: "popup-1", slug: "edge-city" }),
  }),
}))

vi.mock("../../lib/useEventTimezone", () => ({
  useEventTimezone: () => ({
    formatDateFull: () => "Monday, June 2, 2026",
    formatTime: () => "18:00",
  }),
}))

// next/image needs a loader config the test env doesn't have; the cover is
// asserted through its alt text, which a plain img preserves.
vi.mock("../../lib/CoverImage", () => ({
  CoverImage: ({ src, alt }: { src: string | null; alt: string }) => (
    <div role="img" aria-label={alt} data-src={src ?? ""} />
  ),
}))

const RESULT = {
  participant: {
    id: "p-1",
    status: "checked_in",
    check_time: "2026-06-02T18:02:00Z",
  },
  already_checked_in: false,
  created: true,
  event: {
    id: "event-1",
    title: "Sunset talk",
    cover_url: "https://img/cover.png",
    host_display_name: "Ada",
    start_time: "2026-06-02T18:00:00Z",
    end_time: "2026-06-02T19:00:00Z",
    timezone: "UTC",
    venue_title: "The Rooftop",
    occurrence_start: null,
    popup_slug: "edge-city",
  },
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children)
  return render(createElement(EventCheckInPage), { wrapper })
}

function rejectWith(status: number, detail: unknown) {
  checkIn.mockRejectedValue(new FakeApiError(status, { detail }))
}

beforeEach(() => {
  checkIn.mockReset()
  searchParams.clear()
})

describe("EventCheckInPage", () => {
  it("checks in on arrival and shows the event, host and a link back", async () => {
    checkIn.mockResolvedValue(RESULT)

    renderPage()

    expect(
      await screen.findByText("events.check_in.success_heading"),
    ).toBeTruthy()
    expect(screen.getByText("Sunset talk")).toBeTruthy()
    expect(
      screen.getByRole("img", { name: "Sunset talk" }).getAttribute("data-src"),
    ).toBe("https://img/cover.png")
    expect(screen.getByText(/Ada/)).toBeTruthy()
    expect(
      screen.getByRole("link", { name: "events.check_in.view_event" }),
    ).toHaveProperty(
      "href",
      expect.stringContaining("/portal/edge-city/events/event-1"),
    )
  })

  it("fires exactly one check-in per visit", async () => {
    checkIn.mockResolvedValue(RESULT)

    renderPage()

    await screen.findByText("events.check_in.success_heading")
    expect(checkIn).toHaveBeenCalledTimes(1)
  })

  it("forwards the scanned occurrence so a series records the right date", async () => {
    searchParams.set("occ", "2026-06-09T18:00:00Z")
    checkIn.mockResolvedValue(RESULT)

    renderPage()

    await screen.findByText("events.check_in.success_heading")
    expect(checkIn).toHaveBeenCalledWith({
      eventId: "event-1",
      requestBody: { occurrence_start: "2026-06-09T18:00:00Z" },
    })
  })

  it("keeps the occurrence on the link back to the event", async () => {
    searchParams.set("occ", "2026-06-09T18:00:00Z")
    checkIn.mockResolvedValue(RESULT)

    renderPage()

    await screen.findByText("events.check_in.success_heading")
    expect(
      screen.getByRole("link", { name: "events.check_in.view_event" }),
    ).toHaveProperty(
      "href",
      expect.stringContaining("occ=2026-06-09T18%3A00%3A00Z"),
    )
  })

  it("reports a second scan without claiming a new check-in", async () => {
    checkIn.mockResolvedValue({
      ...RESULT,
      already_checked_in: true,
      created: false,
    })

    renderPage()

    expect(
      await screen.findByText("events.check_in.already_heading"),
    ).toBeTruthy()
    expect(screen.queryByText("events.check_in.success_heading")).toBeNull()
  })

  it("says the event is full on a 409", async () => {
    rejectWith(409, { code: "event_full", message: "This event is full." })

    renderPage()

    expect(
      await screen.findByText("events.check_in.error_event_full"),
    ).toBeTruthy()
  })

  it("explains a missing ticket", async () => {
    rejectWith(403, { code: "ticket_required", message: "Need a ticket." })

    renderPage()

    expect(
      await screen.findByText("events.check_in.error_ticket_required"),
    ).toBeTruthy()
  })

  it("distinguishes a window that hasn't opened from one that closed", async () => {
    rejectWith(403, { code: "check_in_not_open", message: "Too early." })
    renderPage()
    expect(
      await screen.findByText("events.check_in.error_not_open"),
    ).toBeTruthy()
  })

  it("falls back to the server's sentence for shared guards with a plain detail", async () => {
    // ensure_popup_writable and friends still answer with a bare string.
    rejectWith(403, "This popup has ended and is read-only.")

    renderPage()

    expect(
      await screen.findByText("This popup has ended and is read-only."),
    ).toBeTruthy()
  })

  it("falls back to a generic message for an unrecognized failure", async () => {
    checkIn.mockRejectedValue(new Error("network down"))

    renderPage()

    expect(
      await screen.findByText("events.check_in.error_generic"),
    ).toBeTruthy()
  })

  it("shows a loading state before the result lands", async () => {
    let resolve: ((value: unknown) => void) | undefined
    checkIn.mockReturnValue(
      new Promise((r) => {
        resolve = r
      }),
    )

    renderPage()

    expect(screen.getByText("events.check_in.checking_in")).toBeTruthy()
    resolve?.(RESULT)
    await waitFor(() =>
      expect(screen.getByText("events.check_in.success_heading")).toBeTruthy(),
    )
  })
})
