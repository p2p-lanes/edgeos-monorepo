import { render, waitFor } from "@testing-library/react"
import { StrictMode } from "react"
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from "vitest"

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
//
// The events page wires up many real dependencies (TanStack Query, several
// services, lib body components, i18n). We mock all of them so each test
// can focus on the `?focus=<eventId>` scroll-into-view contract without
// pulling in real network/state code. The pattern follows
// `portal/src/app/coming-soon/page.test.tsx`.
//
// `currentSearch` and `mockReplace` are referenced from inside the
// `next/navigation` factory by closure. Vitest hoists `vi.mock` above the
// imports, but the factory body is only invoked when the mocked module is
// loaded — by which point the top-level `let`/`const` here are
// initialised. Functions inside the factory close over the live bindings,
// not snapshots, so updates to `currentSearch` propagate to subsequent
// `useSearchParams()` calls.

let currentSearch = ""

const mockReplace = vi.fn((url: string) => {
  const q = url.indexOf("?")
  currentSearch = q >= 0 ? url.slice(q + 1) : ""
  if (typeof window !== "undefined") {
    window.history.replaceState({}, "", url)
  }
})

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: mockReplace,
    push: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => "/portal/festival/events",
  useSearchParams: () => new URLSearchParams(currentSearch),
}))

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock("@/providers/cityProvider", () => ({
  useCityProvider: () => ({
    getCity: () => ({
      id: "city-1",
      slug: "festival",
      name: "Festival",
      events_enabled: true,
      start_date: "2026-05-10",
      end_date: "2026-05-20",
    }),
  }),
}))

// Minimal event-shaped objects. Only `id` and `title` are touched by the
// stub bodies; the page's selection/sorting code only looks at `id`,
// `start_time`, and `owner_id`.
const mockEvents = [
  {
    id: "evt-1",
    title: "Event One",
    start_time: "2026-05-11T10:00:00Z",
    end_time: "2026-05-11T11:00:00Z",
    status: "published",
    owner_id: "h-1",
  },
  {
    id: "evt-2",
    title: "Event Two",
    start_time: "2026-05-12T10:00:00Z",
    end_time: "2026-05-12T11:00:00Z",
    status: "published",
    owner_id: "h-1",
  },
  {
    id: "evt-3",
    title: "Event Three",
    start_time: "2026-05-13T10:00:00Z",
    end_time: "2026-05-13T11:00:00Z",
    status: "published",
    owner_id: "h-1",
  },
]

vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => {
    const key = queryKey[0]
    if (key === "portal-events") {
      return { data: { results: mockEvents }, isLoading: false }
    }
    if (key === "current-human") {
      return { data: { id: "h-1" }, isLoading: false }
    }
    if (key === "portal-tracks") {
      return { data: { results: [] }, isLoading: false }
    }
    if (key === "portal-events-hidden-count") {
      return { data: { count: 0 }, isLoading: false }
    }
    return { data: null, isLoading: false }
  },
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}))

// The page imports services for queryFn bodies; useQuery is mocked so
// none of these are actually invoked. Empty stubs are enough.
vi.mock("@/client", () => ({
  EventsService: {},
  EventParticipantsService: {},
  HumansService: {},
  TracksService: {},
}))

vi.mock("@/app/portal/[popupSlug]/events/lib/useEventTimezone", () => ({
  useEventTimezone: () => ({
    timezone: "UTC",
    formatTime: (s: string) => s,
    formatDateShort: (s: string) => s,
    formatDayKey: (s: string) => s.slice(0, 10),
  }),
  usePortalEventSettings: () => ({
    data: {
      event_enabled: true,
      allowed_tags: [],
      can_publish_event: "everyone",
    },
    isLoading: false,
  }),
}))

const mockConsumeEventsViewState = vi.fn().mockReturnValue(null)
vi.mock("@/app/portal/[popupSlug]/events/lib/eventsViewState", () => ({
  consumeEventsViewState: (...args: unknown[]) =>
    mockConsumeEventsViewState(...args),
  saveEventsViewState: vi.fn(),
}))

// Captures the latest `onViewChange` so a test can simulate a toolbar
// click without poking around inside the real ViewSwitcher.
let mockOnViewChange: ((v: string) => void) | null = null
vi.mock("@/app/portal/[popupSlug]/events/lib/EventsToolbar", () => ({
  EventsToolbar: ({ onViewChange }: { onViewChange: (v: string) => void }) => {
    mockOnViewChange = onViewChange
    return (
      <button
        type="button"
        data-testid="toolbar-switch-view"
        onClick={() => onViewChange("calendar")}
      >
        switch
      </button>
    )
  },
}))

// Minimal ListBody stub. Renders one div per event with the same DOM id
// convention as the real component, so `document.getElementById` finds
// the focused card.
vi.mock("@/app/portal/[popupSlug]/events/lib/ListBody", () => ({
  ListBody: ({ events }: { events: Array<{ id: string; title: string }> }) => (
    <div data-testid="list-body">
      {events.map((e) => (
        <div key={e.id} id={`event-card-${e.id}`} data-testid={`card-${e.id}`}>
          {e.title}
        </div>
      ))}
    </div>
  ),
}))

vi.mock("@/app/portal/[popupSlug]/events/lib/CalendarBody", () => ({
  CalendarBody: () => <div data-testid="calendar-body" />,
}))

vi.mock("@/app/portal/[popupSlug]/events/lib/DayBody", () => ({
  DayBody: () => <div data-testid="day-body" />,
}))

// Import the page AFTER mocks so the module resolves to the mocked
// dependencies. The path is relative because the test sits in the same
// directory as `page.tsx`.
import EventsPage from "./page"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setLocationSearch(search: string) {
  // Both the mocked useSearchParams and the page's direct read from
  // window.location.search must reflect the test URL — the page captures
  // `focus` straight from window.location.search.
  const qs = search.startsWith("?") ? search.slice(1) : search
  currentSearch = qs
  const url = qs ? `/portal/festival/events?${qs}` : "/portal/festival/events"
  window.history.replaceState({}, "", url)
}

function injectPortalScrollMain(): HTMLElement {
  // The events page reads `document.getElementById("portal-scroll")` to
  // apply its outer-scroll restore. The test environment lacks the portal
  // shell that normally renders it, so we synthesize the element here.
  const existing = document.getElementById("portal-scroll")
  if (existing) return existing
  const main = document.createElement("main")
  main.id = "portal-scroll"
  document.body.appendChild(main)
  return main
}

let scrollIntoViewTargets: HTMLElement[] = []
let scrollIntoViewSpy: Mock

beforeEach(() => {
  currentSearch = ""
  window.history.replaceState({}, "", "/portal/festival/events")
  mockReplace.mockClear()
  mockConsumeEventsViewState.mockReset().mockReturnValue(null)
  mockOnViewChange = null
  document.getElementById("portal-scroll")?.remove()

  scrollIntoViewTargets = []
  scrollIntoViewSpy = vi.fn(function (this: HTMLElement) {
    scrollIntoViewTargets.push(this)
  })
  // jsdom doesn't implement scrollIntoView. We track which element it was
  // called on (via `this`) so each test can assert the correct card was
  // focused, not just that *some* scrollIntoView was called.
  Element.prototype.scrollIntoView =
    scrollIntoViewSpy as unknown as typeof Element.prototype.scrollIntoView

  // Make `requestAnimationFrame` run its callback synchronously. The
  // focus-scroll retry loop and the outer-scroll restore loop both
  // schedule via rAF; without this they'd run asynchronously across many
  // 16ms ticks, slowing tests down and making the retry path (FOC-5)
  // flaky under default `waitFor` timeouts.
  vi.spyOn(window, "requestAnimationFrame").mockImplementation(
    (cb: FrameRequestCallback) => {
      cb(0)
      return 0 as unknown as number
    },
  )
})

afterEach(() => {
  vi.restoreAllMocks()
  document.getElementById("portal-scroll")?.remove()
})

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

describe("EventsPage – focus param", () => {
  it("FOC-1: scrolls the focused card into view and cleans the URL (list view)", async () => {
    setLocationSearch("?focus=evt-2")

    render(<EventsPage />)

    await waitFor(() => {
      expect(scrollIntoViewTargets).toHaveLength(1)
    })

    expect(scrollIntoViewTargets[0]?.id).toBe("event-card-evt-2")
    // router.replace was called to clean the focus param. The resulting
    // URL must not contain `focus=`.
    expect(mockReplace).toHaveBeenCalled()
    const cleanCall = mockReplace.mock.calls.find(
      ([url]) => !String(url).includes("focus="),
    )
    expect(cleanCall).toBeTruthy()
    for (const [url] of mockReplace.mock.calls) {
      expect(String(url)).not.toMatch(/focus=/)
    }
  })

  it("FOC-2: setView after focus consume does not re-introduce focus to the URL", async () => {
    setLocationSearch("?focus=evt-2")

    const { rerender } = render(<EventsPage />)

    await waitFor(() => expect(scrollIntoViewTargets.length).toBeGreaterThan(0))

    // Simulate Next.js re-rendering after router.replace mutated the URL
    // — that's what would refresh useSearchParams() in production.
    rerender(<EventsPage />)

    expect(mockOnViewChange).toBeTruthy()
    mockOnViewChange?.("calendar")

    // Across every router.replace invocation, the `focus` param must
    // never reappear.
    for (const [url] of mockReplace.mock.calls) {
      expect(String(url)).not.toMatch(/focus=/)
    }
    // And the last replace did set view=calendar — proving setView ran.
    const lastUrl = String(mockReplace.mock.calls.at(-1)?.[0] ?? "")
    expect(lastUrl).toMatch(/view=calendar/)
  })

  it("FOC-3: without focus param, outer scrollTop is restored and scrollIntoView is not called", async () => {
    mockConsumeEventsViewState.mockReturnValue({
      scroll: { outer: 250 },
      listFilters: null,
    })
    const main = injectPortalScrollMain()

    render(<EventsPage />)

    await waitFor(() => {
      expect(main.scrollTop).toBe(250)
    })

    expect(scrollIntoViewTargets).toHaveLength(0)
  })

  it("FOC-4: focus param takes priority over sessionStorage outer-scroll restore", async () => {
    mockConsumeEventsViewState.mockReturnValue({
      scroll: { outer: 250 },
      listFilters: null,
    })
    const main = injectPortalScrollMain()
    setLocationSearch("?focus=evt-2")

    render(<EventsPage />)

    await waitFor(() => {
      expect(scrollIntoViewTargets.length).toBeGreaterThan(0)
    })

    expect(scrollIntoViewTargets[0]?.id).toBe("event-card-evt-2")
    // Outer restore must have been skipped — main.scrollTop stays at 0.
    expect(main.scrollTop).toBe(0)
  })

  it("FOC-5: missing focus target does not throw and the param is eventually cleaned", async () => {
    setLocationSearch("?focus=does-not-exist")

    expect(() => render(<EventsPage />)).not.toThrow()

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalled()
    })

    // Final URL contains no focus param even though no card matched.
    const lastUrl = String(mockReplace.mock.calls.at(-1)?.[0] ?? "")
    expect(lastUrl).not.toMatch(/focus=/)
    // No card was scrolled into view (none matched the id).
    expect(scrollIntoViewTargets).toHaveLength(0)
  })

  it("FOC-7: navigation transition — useSearchParams has focus, window.location lags", async () => {
    // Simulates a Next.js client-side navigation back from the detail
    // page: `<Link>` triggers a transition where the router store (and
    // therefore useSearchParams) is updated synchronously with the new
    // `?focus=` param, but `window.location.search` still points at the
    // outgoing route until the transition commits. Reading focus from
    // useSearchParams must work; if the page only consulted
    // window.location.search it would miss the param and never scroll.
    currentSearch = "focus=evt-2"
    window.history.replaceState({}, "", "/portal/festival/events/some-event")

    render(<EventsPage />)

    await waitFor(() => {
      expect(scrollIntoViewTargets).toHaveLength(1)
    })
    expect(scrollIntoViewTargets[0]?.id).toBe("event-card-evt-2")
  })

  it("FOC-6: StrictMode double-mount calls scrollIntoView exactly once", async () => {
    setLocationSearch("?focus=evt-2")

    render(
      <StrictMode>
        <EventsPage />
      </StrictMode>,
    )

    await waitFor(() => expect(scrollIntoViewTargets.length).toBeGreaterThan(0))

    // The first mount consumes the param and cleans the URL. The second
    // (StrictMode) mount reads an empty window.location.search and skips
    // the scroll — so the total stays at exactly one call.
    expect(scrollIntoViewTargets).toHaveLength(1)
    expect(scrollIntoViewTargets[0]?.id).toBe("event-card-evt-2")
  })
})
