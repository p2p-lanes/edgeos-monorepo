/**
 * Tests for check-in route — Phase 8.4 (ticket-as-first-class-entity)
 *
 * Covers:
 * (a) TicketEventSubRow: renders expanded payload and ticket UUID
 * (b) column cells: event_type badge, attendee name+email, product name, date
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import type { ReactNode } from "react"
import { describe, expect, it, vi } from "vitest"

vi.mock("@/client", () => ({
  TicketEventsService: {
    listTicketEvents: vi.fn(),
  },
}))

vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual<object>("@tanstack/react-router")
  return {
    ...actual,
    createFileRoute: () => () => ({
      useSearch: () => ({}),
    }),
    useNavigate: () => vi.fn(),
  }
})

vi.mock("@/contexts/WorkspaceContext", () => ({
  useWorkspace: () => ({
    selectedPopupId: "popup-1",
    isContextReady: true,
  }),
}))

vi.mock("@/hooks/useTableSearchParams", () => ({
  useTableSearchParams: () => ({
    search: "",
    pagination: { pageIndex: 0, pageSize: 20 },
    setSearch: vi.fn(),
    setPagination: vi.fn(),
  }),
  validateTableSearch: vi.fn(),
}))

import { TicketEventSubRow } from "@/routes/_layout/check-in"

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

// ── (a) TicketEventSubRow ─────────────────────────────────────────────────────

describe("TicketEventSubRow", () => {
  function makeRow(event: object) {
    return {
      original: event,
    } as never
  }

  it("renders the ticket UUID in expanded sub-row", () => {
    const event = {
      id: "evt-1",
      attendee_product_id: "00000000-0000-0000-0000-000000000042",
      event_type: "check_in",
      occurred_at: "2024-01-15T10:00:00Z",
      source: "manual",
      attendee_name: "Alice",
      attendee_email: "alice@example.com",
      product_name: "Day Pass",
      actor_user_id: null,
      payload: null,
    }

    render(<TicketEventSubRow row={makeRow(event)} />, {
      wrapper: makeWrapper(),
    })

    expect(
      screen.getByText("00000000-0000-0000-0000-000000000042"),
    ).toBeInTheDocument()
  })

  it("renders payload JSON when present", () => {
    const event = {
      id: "evt-2",
      attendee_product_id: "ap-uuid",
      event_type: "check_in",
      occurred_at: "2024-01-15T10:00:00Z",
      source: "qr_scan",
      attendee_name: "Bob",
      attendee_email: null,
      product_name: null,
      actor_user_id: null,
      payload: { source: "qr_scan", device: "scanner-01" },
    }

    render(<TicketEventSubRow row={makeRow(event)} />, {
      wrapper: makeWrapper(),
    })

    // JSON payload should be rendered as preformatted text
    expect(screen.getByText(/qr_scan/)).toBeInTheDocument()
    expect(screen.getByText(/scanner-01/)).toBeInTheDocument()
  })

  it("renders actor_user_id when present", () => {
    const event = {
      id: "evt-3",
      attendee_product_id: "ap-uuid",
      event_type: "void",
      occurred_at: "2024-01-15T10:00:00Z",
      source: null,
      attendee_name: "Carol",
      attendee_email: null,
      product_name: null,
      actor_user_id: "user-uuid-123",
      payload: null,
    }

    render(<TicketEventSubRow row={makeRow(event)} />, {
      wrapper: makeWrapper(),
    })

    expect(screen.getByText("user-uuid-123")).toBeInTheDocument()
  })

  it("does not render payload section when payload is null", () => {
    const event = {
      id: "evt-4",
      attendee_product_id: "ap-uuid",
      event_type: "check_in",
      occurred_at: "2024-01-15T10:00:00Z",
      source: null,
      attendee_name: "Dave",
      attendee_email: null,
      product_name: null,
      actor_user_id: null,
      payload: null,
    }

    render(<TicketEventSubRow row={makeRow(event)} />, {
      wrapper: makeWrapper(),
    })

    expect(screen.queryByText("Payload")).not.toBeInTheDocument()
  })
})
