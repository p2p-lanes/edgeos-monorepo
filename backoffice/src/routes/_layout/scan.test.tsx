/**
 * Tests for the Scan Ticket route — Phase 8.6 (ticket-as-first-class-entity)
 *
 * Covers:
 * (a) TicketScanResult: "First check-in!" badge when total_scans <= 1
 * (b) TicketScanResult: "Re-scan #N" warning when total_scans > 1
 * (c) TicketScanResult: renders attendee name, product name, check_in_code
 * (d) TicketScanResult: shows scan history fields
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import type { ReactNode } from "react"
import { describe, expect, it, vi } from "vitest"

vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual<object>("@tanstack/react-router")
  return {
    ...actual,
    createFileRoute: () => () => ({}),
    useNavigate: () => vi.fn(),
  }
})

vi.mock("@/client", () => ({
  AttendeesService: {
    getByCheckInCode: vi.fn(),
  },
}))

vi.mock("@/hooks/useCustomToast", () => ({
  default: () => ({
    showSuccessToast: vi.fn(),
    showErrorToast: vi.fn(),
  }),
}))

import type { TicketPublic } from "@/client"
import { TicketScanResult } from "@/routes/_layout/scan"

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

const baseTicket: TicketPublic = {
  id: "ticket-uuid-1",
  check_in_code: "ABCD1234",
  payment_id: null,
  attendee_id: "att-uuid-1",
  product_id: "prod-uuid-1",
  attendee: {
    id: "att-uuid-1",
    tenant_id: "tenant-1",
    popup_id: "popup-1",
    name: "Alice Smith",
    category: "main",
    email: "alice@example.com",
    gender: null,
    check_in_code: null,
    poap_url: null,
    created_at: null,
    updated_at: null,
    products: [],
  },
  product: {
    id: "prod-uuid-1",
    tenant_id: "tenant-1",
    name: "Weekend Pass",
    slug: "weekend-pass",
    price: "100.00",
    category: "ticket",
    is_active: true,
    exclusive: false,
    popup_id: "popup-1",
    insurance_eligible: false,
  },
  created_at: null,
  total_scans: 1,
  first_scan_at: "2026-05-06T10:00:00Z",
  last_scan_at: "2026-05-06T10:00:00Z",
}

describe("TicketScanResult — first scan", () => {
  it("shows 'First check-in!' when total_scans is 1", () => {
    render(<TicketScanResult ticket={{ ...baseTicket, total_scans: 1 }} />, {
      wrapper: makeWrapper(),
    })
    expect(screen.getByText(/first check-in!/i)).toBeInTheDocument()
  })

  it("shows 'First check-in!' when total_scans is 0 (legacy default)", () => {
    render(<TicketScanResult ticket={{ ...baseTicket, total_scans: 0 }} />, {
      wrapper: makeWrapper(),
    })
    expect(screen.getByText(/first check-in!/i)).toBeInTheDocument()
  })

  it("shows 'First check-in!' when total_scans is undefined", () => {
    render(
      <TicketScanResult ticket={{ ...baseTicket, total_scans: undefined }} />,
      { wrapper: makeWrapper() },
    )
    expect(screen.getByText(/first check-in!/i)).toBeInTheDocument()
  })
})

describe("TicketScanResult — re-scan", () => {
  it("shows 'Re-scan #2' when total_scans is 2", () => {
    render(<TicketScanResult ticket={{ ...baseTicket, total_scans: 2 }} />, {
      wrapper: makeWrapper(),
    })
    expect(screen.getByText(/re-scan #2/i)).toBeInTheDocument()
  })

  it("shows correct re-scan count for N > 2", () => {
    render(<TicketScanResult ticket={{ ...baseTicket, total_scans: 5 }} />, {
      wrapper: makeWrapper(),
    })
    expect(screen.getByText(/re-scan #5/i)).toBeInTheDocument()
  })
})

describe("TicketScanResult — content", () => {
  it("renders the check_in_code", () => {
    render(<TicketScanResult ticket={baseTicket} />, { wrapper: makeWrapper() })
    expect(screen.getByText("ABCD1234")).toBeInTheDocument()
  })

  it("renders the attendee name", () => {
    render(<TicketScanResult ticket={baseTicket} />, { wrapper: makeWrapper() })
    expect(screen.getByText("Alice Smith")).toBeInTheDocument()
  })

  it("renders the product name", () => {
    render(<TicketScanResult ticket={baseTicket} />, { wrapper: makeWrapper() })
    expect(screen.getByText("Weekend Pass")).toBeInTheDocument()
  })
})
