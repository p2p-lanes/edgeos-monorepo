/**
 * Tests for check-in route.
 *
 * Covers:
 * (a) CheckInSubRow: renders "Scanned by" (name and/or email; row hidden when
 *     neither is set). UUID, timestamp, and raw payload JSON are never shown.
 *     Shows the unit code, and "Bought by" only when someone else holds it.
 * (b) HolderCell / ProductCell: ownerless merch falls back to the buyer, and
 *     multi-unit lines show which unit was scanned.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import type { ReactNode } from "react"
import { describe, expect, it, vi } from "vitest"

vi.mock("@/client", () => ({
  CheckInService: {
    listCheckIns: vi.fn(),
  },
  PopupsService: {
    getPopup: vi.fn(),
  },
  ProductsService: {
    listProducts: vi.fn(),
  },
  SalesFlowsService: {
    listSalesFlows: vi.fn(),
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

import type { CheckInListItem } from "@/client"
import {
  CheckInSubRow,
  HolderCell,
  ProductCell,
} from "@/routes/_layout/check-in"

function makeEvent(overrides: Partial<CheckInListItem> = {}): CheckInListItem {
  return {
    id: "evt",
    attendee_product_id: "ap-uuid",
    occurred_at: "2024-01-15T10:00:00Z",
    source: "qr",
    attendee_name: null,
    attendee_email: null,
    product_name: "Conference T-Shirt",
    actor_user_id: null,
    actor_user_name: null,
    actor_user_email: null,
    payload: null,
    ...overrides,
  }
}

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

  it("shows the unit code", () => {
    render(
      <CheckInSubRow row={makeRow(makeEvent({ check_in_code: "ETTFGBZR" }))} />,
      { wrapper: makeWrapper() },
    )

    expect(screen.getByText("Code")).toBeInTheDocument()
    expect(screen.getByText("ETTFGBZR")).toBeInTheDocument()
  })

  it("shows 'Bought by' when the holder is not the buyer", () => {
    const event = makeEvent({
      attendee_name: "Guest Holder",
      attendee_email: "guest@example.com",
      buyer_name: "Alice Johnson",
      buyer_email: "alice@example.com",
    })

    render(<CheckInSubRow row={makeRow(event)} />, { wrapper: makeWrapper() })

    expect(screen.getByText("Bought by")).toBeInTheDocument()
    expect(
      screen.getByText("Alice Johnson - alice@example.com"),
    ).toBeInTheDocument()
  })

  it("hides 'Bought by' when the holder bought it, or there is no holder", () => {
    const self = makeEvent({
      attendee_name: "Alice Johnson",
      attendee_email: "Alice@Example.com",
      buyer_email: "alice@example.com",
    })
    const ownerless = makeEvent({ buyer_email: "alice@example.com" })

    const { unmount } = render(<CheckInSubRow row={makeRow(self)} />, {
      wrapper: makeWrapper(),
    })
    expect(screen.queryByText("Bought by")).not.toBeInTheDocument()
    unmount()

    render(<CheckInSubRow row={makeRow(ownerless)} />, {
      wrapper: makeWrapper(),
    })
    expect(screen.queryByText("Bought by")).not.toBeInTheDocument()
  })
})

// ── (b) Cells ─────────────────────────────────────────────────────────────

describe("HolderCell", () => {
  it("shows the participant when the unit has one", () => {
    render(
      <HolderCell
        event={makeEvent({
          attendee_name: "Bob Smith",
          attendee_email: "bob@example.com",
          buyer_name: "Alice Johnson",
          buyer_email: "alice@example.com",
        })}
      />,
    )

    expect(screen.getByText("Bob Smith")).toBeInTheDocument()
    expect(screen.getByText("bob@example.com")).toBeInTheDocument()
    expect(screen.queryByText("Buyer")).not.toBeInTheDocument()
    expect(screen.queryByText("Alice Johnson")).not.toBeInTheDocument()
  })

  it("falls back to the buyer for ownerless merch and labels it", () => {
    render(
      <HolderCell
        event={makeEvent({
          buyer_name: "Alice Johnson",
          buyer_email: "alice@example.com",
        })}
      />,
    )

    expect(screen.getByText("Alice Johnson")).toBeInTheDocument()
    expect(screen.getByText("alice@example.com")).toBeInTheDocument()
    expect(screen.getByText("Buyer")).toBeInTheDocument()
  })

  it("renders a placeholder when nobody is known", () => {
    render(<HolderCell event={makeEvent()} />)

    expect(screen.getByText("—")).toBeInTheDocument()
    expect(screen.queryByText("Buyer")).not.toBeInTheDocument()
  })
})

describe("ProductCell", () => {
  it("labels the category and which unit of a multi-unit line was scanned", () => {
    render(
      <ProductCell
        event={makeEvent({
          product_category: "merch",
          unit_index: 1,
          unit_count: 2,
        })}
      />,
    )

    expect(screen.getByText("Conference T-Shirt")).toBeInTheDocument()
    expect(screen.getByText("Merch")).toBeInTheDocument()
    expect(screen.getByText("Unit 2 of 2")).toBeInTheDocument()
  })

  it("omits the unit label for single-unit lines and shows raw categories", () => {
    render(
      <ProductCell
        event={makeEvent({
          product_category: "parking",
          unit_index: 0,
          unit_count: 1,
        })}
      />,
    )

    expect(screen.getByText("parking")).toBeInTheDocument()
    expect(screen.queryByText(/Unit \d of/)).not.toBeInTheDocument()
  })
})
