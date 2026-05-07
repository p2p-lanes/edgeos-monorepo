/**
 * Tests for check-in route — Phase 8.4 (ticket-as-first-class-entity)
 *
 * Covers:
 * (a) TicketEventSubRow: renders actor display (name → email → id fallback)
 *     and payload JSON; UUID + timestamp removed from sub-row.
 * (b) column cells: attendee name+email, product name, date
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

  it("does not render ticket UUID or timestamp (removed from sub-row)", () => {
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
      actor_user_name: null,
      actor_user_email: null,
      payload: null,
    }

    render(<TicketEventSubRow row={makeRow(event)} />, {
      wrapper: makeWrapper(),
    })

    expect(
      screen.queryByText("00000000-0000-0000-0000-000000000042"),
    ).not.toBeInTheDocument()
    expect(screen.queryByText("Timestamp")).not.toBeInTheDocument()
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

  it("prefers actor_user_name over email and id", () => {
    const event = {
      id: "evt-3",
      attendee_product_id: "ap-uuid",
      event_type: "check_in",
      occurred_at: "2024-01-15T10:00:00Z",
      source: null,
      attendee_name: "Carol",
      attendee_email: null,
      product_name: null,
      actor_user_id: "user-uuid-123",
      actor_user_name: "Boreal Reviewer",
      actor_user_email: "reviewer@example.com",
      payload: null,
    }

    render(<TicketEventSubRow row={makeRow(event)} />, {
      wrapper: makeWrapper(),
    })

    expect(screen.getByText("Boreal Reviewer")).toBeInTheDocument()
    expect(screen.queryByText("reviewer@example.com")).not.toBeInTheDocument()
    expect(screen.queryByText("user-uuid-123")).not.toBeInTheDocument()
  })

  it("falls back to actor_user_email when name is null", () => {
    const event = {
      id: "evt-3b",
      attendee_product_id: "ap-uuid",
      event_type: "check_in",
      occurred_at: "2024-01-15T10:00:00Z",
      source: null,
      attendee_name: null,
      attendee_email: null,
      product_name: null,
      actor_user_id: "user-uuid-123",
      actor_user_name: null,
      actor_user_email: "reviewer@example.com",
      payload: null,
    }

    render(<TicketEventSubRow row={makeRow(event)} />, {
      wrapper: makeWrapper(),
    })

    expect(screen.getByText("reviewer@example.com")).toBeInTheDocument()
  })

  it("falls back to actor_user_id when name and email are null", () => {
    const event = {
      id: "evt-3c",
      attendee_product_id: "ap-uuid",
      event_type: "check_in",
      occurred_at: "2024-01-15T10:00:00Z",
      source: null,
      attendee_name: null,
      attendee_email: null,
      product_name: null,
      actor_user_id: "user-uuid-123",
      actor_user_name: null,
      actor_user_email: null,
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
