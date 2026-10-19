import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { TicketEntry } from "@/types/Attendee"
import PurchasedTicketRow from "./PurchasedTicketRow"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

const entry = (overrides: Partial<TicketEntry> = {}): TicketEntry => ({
  id: "ticket-1",
  attendee_id: "attendee-1",
  product_id: "product-1",
  check_in_code: "CODE1",
  product_name: "VIP Pass",
  product_category: "ticket",
  requires_check_in: true,
  ...overrides,
})

afterEach(cleanup)

describe("PurchasedTicketRow", () => {
  it("shows the first line of the description as context", () => {
    render(
      <PurchasedTicketRow
        entry={entry({
          product_description: "Priority seating.\nLounge access every day.",
        })}
        imageUrl={null}
        onOpen={vi.fn()}
      />,
    )

    expect(screen.getByText("Priority seating.")).toBeTruthy()
    expect(screen.queryByText(/Lounge access/)).toBeNull()
  })

  it("keeps a booked stay closed to one line with its price", () => {
    render(
      <PurchasedTicketRow
        entry={entry({
          product_name: "Classic Double",
          product_category: "housing",
          requires_check_in: false,
          purchase_metadata: {
            kind: "accommodation_booking",
            accommodation_name: "Classic Double",
            property_name: "Hotel Arcadia",
            property_address: "Avenida melian 2487",
            unit_label: "201",
            check_in: "2026-06-12",
            check_out: "2026-06-15",
            nights: 3,
            quote: { total: "495", currency: "USD" },
          },
        })}
        imageUrl={null}
        onOpen={vi.fn()}
      />,
    )

    expect(screen.getByText("Classic Double")).toBeTruthy()
    expect(screen.getByText("201")).toBeTruthy()
    expect(screen.getByText("$495")).toBeTruthy()
    expect(screen.getByText(/Hotel Arcadia/)).toBeTruthy()
    // The address belongs to the detail sheet, not the list.
    expect(screen.queryByText("Avenida melian 2487")).toBeNull()
  })

  it("opens the detail from the row and the QR from its own button", () => {
    const onOpen = vi.fn()
    const onShowQr = vi.fn()
    render(
      <PurchasedTicketRow
        entry={entry()}
        imageUrl={null}
        onOpen={onOpen}
        onShowQr={onShowQr}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: /VIP Pass/ }))
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(onShowQr).not.toHaveBeenCalled()

    fireEvent.click(
      screen.getByRole("button", { name: "passes.check_in_code" }),
    )
    expect(onShowQr).toHaveBeenCalledTimes(1)
    expect(onOpen).toHaveBeenCalledTimes(1)
  })
})
