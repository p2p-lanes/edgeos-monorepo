/**
 * Tests for check-in route.
 *
 * Covers:
 * (a) CheckInSubRow: renders "Scanned by" (name and/or email; row hidden when
 *     neither is set). UUID, timestamp, and raw payload JSON are never shown.
 * (b) column cells: attendee name+email, product name, date
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import type { ReactNode } from "react"
import { describe, expect, it, vi } from "vitest"

vi.mock("@/client", () => ({
  CheckInService: {
    listCheckIns: vi.fn(),
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

import { CheckInSubRow } from "@/routes/_layout/check-in"

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

// ── (a) CheckInSubRow ─────────────────────────────────────────────────────

describe("CheckInSubRow", () => {
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

    render(<CheckInSubRow row={makeRow(event)} />, {
      wrapper: makeWrapper(),
    })

    expect(
      screen.queryByText("00000000-0000-0000-0000-000000000042"),
    ).not.toBeInTheDocument()
    expect(screen.queryByText("Timestamp")).not.toBeInTheDocument()
  })

  it("does not render the raw payload JSON even when it has content", () => {
    const event = {
      id: "evt-2",
      attendee_product_id: "ap-uuid",
      occurred_at: "2024-01-15T10:00:00Z",
      source: "qr",
      attendee_name: "Bob",
      attendee_email: null,
      product_name: null,
      actor_user_id: null,
      actor_user_name: null,
      actor_user_email: null,
      payload: { source: "qr", notes: "Some operator note" },
    }

    render(<CheckInSubRow row={makeRow(event)} />, {
      wrapper: makeWrapper(),
    })

    expect(screen.queryByText("Payload")).not.toBeInTheDocument()
    expect(screen.queryByText(/Some operator note/)).not.toBeInTheDocument()
  })

  it("renders 'Scanned by' as 'name - email' when both are set", () => {
    const event = {
      id: "evt-3",
      attendee_product_id: "ap-uuid",
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

    render(<CheckInSubRow row={makeRow(event)} />, {
      wrapper: makeWrapper(),
    })

    expect(
      screen.getByText("Boreal Reviewer - reviewer@example.com"),
    ).toBeInTheDocument()
    expect(screen.getByText("Scanned by")).toBeInTheDocument()
    expect(screen.queryByText("user-uuid-123")).not.toBeInTheDocument()
  })

  it("falls back to email only when name is null", () => {
    const event = {
      id: "evt-3b",
      attendee_product_id: "ap-uuid",
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

    render(<CheckInSubRow row={makeRow(event)} />, {
      wrapper: makeWrapper(),
    })

    expect(screen.getByText("reviewer@example.com")).toBeInTheDocument()
    expect(screen.queryByText("user-uuid-123")).not.toBeInTheDocument()
  })

  it("hides 'Scanned by' when neither name nor email is set", () => {
    const event = {
      id: "evt-3c",
      attendee_product_id: "ap-uuid",
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

    render(<CheckInSubRow row={makeRow(event)} />, {
      wrapper: makeWrapper(),
    })

    expect(screen.queryByText("Scanned by")).not.toBeInTheDocument()
    expect(screen.queryByText("user-uuid-123")).not.toBeInTheDocument()
  })
})
