/**
 * Tests for attendees route — Phase 8.4 (ticket-as-first-class-entity)
 *
 * Covers:
 * (a) flattenAttendeesForCsv: expands attendee + per-ticket rows for CSV export
 * (b) ViewAttendee dialog: shows per-ticket check_in_codes from products[]
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import type React from "react"
import type { ReactNode } from "react"
import { describe, expect, it, vi } from "vitest"

vi.mock("@/client", () => ({
  AttendeesService: {
    listAttendees: vi.fn(),
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

vi.mock("@/lib/export", () => ({
  fetchAllPages: vi.fn(),
  exportToCsv: vi.fn(),
}))

// DialogClose requires a Dialog ancestor — stub it for unit tests
vi.mock("@/components/ui/dialog", async () => {
  const actual = await vi.importActual<object>("@/components/ui/dialog")
  return {
    ...actual,
    DialogClose: ({ children }: { children: React.ReactNode }) => children,
  }
})

import {
  AttendeeDetailsContent,
  flattenAttendeesForCsv,
} from "@/routes/_layout/attendees"

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

// ── (a) CSV flattening ────────────────────────────────────────────────────────

describe("flattenAttendeesForCsv", () => {
  it("returns one row per ticket when attendee has multiple products", () => {
    const attendee = {
      id: "att-1",
      name: "Alice",
      email: "alice@example.com",
      category: "main",
      gender: null,
      check_in_code: null,
      products: [
        {
          id: "ap-1",
          attendee_id: "att-1",
          product_id: "prod-1",
          check_in_code: "CODE1",
        },
        {
          id: "ap-2",
          attendee_id: "att-1",
          product_id: "prod-2",
          check_in_code: "CODE2",
        },
      ],
    }
    const rows = flattenAttendeesForCsv([attendee as never])
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      name: "Alice",
      ticket_check_in_code: "CODE1",
      product_id: "prod-1",
    })
    expect(rows[1]).toMatchObject({
      name: "Alice",
      ticket_check_in_code: "CODE2",
      product_id: "prod-2",
    })
  })

  it("returns one row with empty ticket fields when attendee has no products", () => {
    const attendee = {
      id: "att-1",
      name: "Bob",
      email: "bob@example.com",
      category: "main",
      gender: null,
      check_in_code: null,
      products: [],
    }
    const rows = flattenAttendeesForCsv([attendee as never])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      name: "Bob",
      ticket_check_in_code: "",
      product_id: "",
    })
  })

  it("handles mixed attendees — preserves attendee-level data in each row", () => {
    const attendees = [
      {
        id: "att-1",
        name: "Alice",
        email: "alice@example.com",
        category: "main",
        gender: "female",
        check_in_code: null,
        products: [
          {
            id: "ap-1",
            attendee_id: "att-1",
            product_id: "prod-1",
            check_in_code: "CODE1",
          },
        ],
      },
      {
        id: "att-2",
        name: "Bob",
        email: null,
        category: "spouse",
        gender: null,
        check_in_code: null,
        products: [],
      },
    ]
    const rows = flattenAttendeesForCsv(attendees as never[])
    expect(rows).toHaveLength(2)
    expect(rows[0].name).toBe("Alice")
    expect(rows[1].name).toBe("Bob")
    expect(rows[1].ticket_check_in_code).toBe("")
  })
})

// ── (b) AttendeeDetailsContent — per-ticket check_in_codes ──────────────────────

describe("AttendeeDetailsContent", () => {
  it("renders per-ticket check_in_codes from products array", async () => {
    const attendee = {
      id: "att-1",
      name: "Alice",
      email: "alice@example.com",
      category: "main",
      gender: null,
      check_in_code: null,
      products: [
        {
          id: "ap-1",
          attendee_id: "att-1",
          product_id: "prod-1",
          check_in_code: "TICKET-CODE-A",
        },
        {
          id: "ap-2",
          attendee_id: "att-1",
          product_id: "prod-2",
          check_in_code: "TICKET-CODE-B",
        },
      ],
    }

    render(<AttendeeDetailsContent attendee={attendee as never} />, {
      wrapper: makeWrapper(),
    })

    expect(screen.getByText("TICKET-CODE-A")).toBeInTheDocument()
    expect(screen.getByText("TICKET-CODE-B")).toBeInTheDocument()
  })

  it("shows fallback attendee-level check_in_code when no products", async () => {
    const attendee = {
      id: "att-1",
      name: "Alice",
      email: "alice@example.com",
      category: "main",
      gender: null,
      check_in_code: "ATT-LEGACY-CODE",
      products: [],
    }

    render(<AttendeeDetailsContent attendee={attendee as never} />, {
      wrapper: makeWrapper(),
    })

    expect(screen.getByText("ATT-LEGACY-CODE")).toBeInTheDocument()
  })
})
