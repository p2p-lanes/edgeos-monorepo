import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import type { PersonalTicketsPublic } from "@/client"
import { PersonalTicketPasses } from "./PersonalTicketPasses"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock("./common/QRcode", () => ({
  default: ({
    isOpen,
    check_in_code,
    lastScanAt,
  }: {
    isOpen: boolean
    check_in_code: string
    lastScanAt: string | null
  }) =>
    isOpen ? (
      <div role="dialog">
        {check_in_code} {lastScanAt}
      </div>
    ) : null,
}))

const recipient: PersonalTicketsPublic = {
  id: "recipient",
  name: "Jon",
  email: "jon@example.com",
  category: "spouse",
  popup_id: "popup",
  popup_name: "Festival",
  products: [{ name: "Spouse pass", category: "ticket", quantity: 2 }],
  tickets: [
    {
      id: "unit-1",
      attendee_id: "recipient",
      product_id: "same-product",
      product_name: "Spouse pass",
      check_in_code: "FIRSTQR",
      requires_check_in: true,
    },
    {
      id: "unit-2",
      attendee_id: "recipient",
      product_id: "same-product",
      product_name: "Spouse pass",
      check_in_code: "SECONDQR",
      requires_check_in: true,
      last_scan_at: "2026-10-01T00:00:00Z",
    },
  ],
}

describe("read-only personal ticket cards", () => {
  it("shows each physical unit and opens its own QR with scan status", () => {
    render(<PersonalTicketPasses attendees={[recipient]} />)
    expect(screen.getAllByText("Spouse pass")).toHaveLength(2)
    fireEvent.click(
      screen.getByRole("button", { name: "passes.check_in_code" }),
    )
    expect(screen.getByRole("dialog").textContent).toContain("FIRSTQR")
    fireEvent.click(
      screen.getByRole("button", { name: "passes.qr_already_scanned" }),
    )
    expect(screen.getByRole("dialog").textContent).toContain("SECONDQR")
    expect(screen.getByRole("dialog").textContent).toContain(
      "2026-10-01T00:00:00Z",
    )
    expect(
      screen.queryByRole("button", { name: /edit|delete|buy|meal/i }),
    ).toBeNull()
  })

  it("closes a displayed QR if a refetch removes that ticket", () => {
    const { rerender } = render(
      <PersonalTicketPasses attendees={[recipient]} />,
    )
    fireEvent.click(
      screen.getByRole("button", { name: "passes.check_in_code" }),
    )
    rerender(
      <PersonalTicketPasses
        attendees={[{ ...recipient, tickets: [recipient.tickets![1]] }]}
      />,
    )
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("renders summary-only tickets without inventing a QR or edit controls", () => {
    render(<PersonalTicketPasses attendees={[{ ...recipient, tickets: [] }]} />)
    expect(screen.getByText("Spouse pass")).toBeTruthy()
    expect(screen.getByText("×2")).toBeTruthy()
    expect(screen.queryByRole("button")).toBeNull()
  })

  it("does not offer a check-in QR for tickets that do not require it", () => {
    render(
      <PersonalTicketPasses
        attendees={[
          {
            ...recipient,
            tickets: [{ ...recipient.tickets![0], requires_check_in: false }],
          },
        ]}
      />,
    )
    expect(screen.getByText("Spouse pass")).toBeTruthy()
    expect(screen.queryByRole("button")).toBeNull()
  })
})
