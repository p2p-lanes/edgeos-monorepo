// @vitest-environment jsdom
/**
 * RED tests — Phase 7.4: per-ticket QR display
 *
 * Tests for the TicketQRList component which renders one QR per
 * AttendeeProductPublic entry when product.requires_check_in === true.
 */
import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import type { AttendeeProductPublic } from "@/client"
import TicketQRList from "./TicketQRList"

// Minimal mock so react-qr-code doesn't blow up in jsdom
vi.mock("react-qr-code", () => ({
  default: ({ value }: { value: string }) => (
    <div data-testid="qr-code" data-value={value} />
  ),
}))

function makeTicketEntry(overrides: Partial<AttendeeProductPublic & { product_name?: string; requires_check_in?: boolean }>): AttendeeProductPublic & { product_name?: string; requires_check_in?: boolean } {
  return {
    id: overrides.id ?? "ticket-1",
    attendee_id: overrides.attendee_id ?? "attendee-1",
    product_id: overrides.product_id ?? "product-1",
    check_in_code: overrides.check_in_code ?? "ABCD1234",
    payment_id: overrides.payment_id ?? null,
    product_name: overrides.product_name ?? "General Ticket",
    requires_check_in: overrides.requires_check_in ?? true,
  }
}

describe("TicketQRList", () => {
  it("renders one QR per ticket when requires_check_in is true", () => {
    const tickets = [
      makeTicketEntry({ id: "t1", check_in_code: "AAAA1111", product_name: "Ticket A" }),
      makeTicketEntry({ id: "t2", check_in_code: "BBBB2222", product_name: "Ticket B" }),
    ]

    render(<TicketQRList tickets={tickets} />)

    const qrs = screen.getAllByTestId("qr-code")
    expect(qrs).toHaveLength(2)
    expect(screen.getByText("AAAA1111")).toBeInTheDocument()
    expect(screen.getByText("BBBB2222")).toBeInTheDocument()
  })

  it("skips tickets where requires_check_in is false", () => {
    const tickets = [
      makeTicketEntry({ id: "t1", check_in_code: "AAAA1111", requires_check_in: true }),
      makeTicketEntry({ id: "t2", check_in_code: "BBBB2222", requires_check_in: false }),
    ]

    render(<TicketQRList tickets={tickets} />)

    const qrs = screen.getAllByTestId("qr-code")
    expect(qrs).toHaveLength(1)
    expect(screen.queryByText("BBBB2222")).not.toBeInTheDocument()
  })

  it("renders nothing when all tickets have requires_check_in false", () => {
    const tickets = [
      makeTicketEntry({ id: "t1", requires_check_in: false }),
      makeTicketEntry({ id: "t2", requires_check_in: false }),
    ]

    const { container } = render(<TicketQRList tickets={tickets} />)

    expect(screen.queryByTestId("qr-code")).not.toBeInTheDocument()
    // Container should be empty or show a placeholder
    expect(container.firstChild).toBeNull()
  })

  it("renders the product name next to each QR when provided", () => {
    const tickets = [
      makeTicketEntry({ id: "t1", product_name: "VIP Pass", check_in_code: "VIP12345" }),
    ]

    render(<TicketQRList tickets={tickets} />)

    expect(screen.getByText("VIP Pass")).toBeInTheDocument()
  })
})
