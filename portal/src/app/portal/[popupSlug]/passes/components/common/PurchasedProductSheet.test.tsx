import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { TicketEntry } from "@/types/Attendee"
import PurchasedProductSheet from "./PurchasedProductSheet"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en" },
  }),
}))

vi.mock("react-qr-code", () => ({
  default: ({ value }: { value: string }) => (
    <div data-testid="qr-payload">{value}</div>
  ),
}))

const ticket = (overrides: Partial<TicketEntry> = {}): TicketEntry => ({
  id: "ticket-1",
  attendee_id: "attendee-1",
  product_id: "product-1",
  check_in_code: "VIP123",
  product_name: "VIP Pass",
  product_category: "ticket",
  requires_check_in: true,
  product_description: "Priority seating.\nLounge access every day.",
  ...overrides,
})

afterEach(cleanup)

describe("PurchasedProductSheet", () => {
  it("renders nothing while no purchase is selected", () => {
    render(
      <PurchasedProductSheet entry={null} imageUrl={null} onClose={vi.fn()} />,
    )

    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("shows the whole ticket with a scannable code", () => {
    render(
      <PurchasedProductSheet
        entry={ticket()}
        imageUrl={null}
        attendeeName="Alice Johnson"
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByRole("dialog", { name: "VIP Pass" })).toBeTruthy()
    expect(screen.getByText("Alice Johnson")).toBeTruthy()
    expect(screen.getByTestId("qr-payload").textContent).toBe(
      JSON.stringify({ code: "VIP123" }),
    )
    expect(screen.getByText(/Lounge access every day/)).toBeTruthy()
  })

  it("shows a booked stay's dates, address and total without a code", () => {
    render(
      <PurchasedProductSheet
        entry={ticket({
          product_name: "Classic Double",
          product_category: "housing",
          requires_check_in: false,
          product_description: null,
          purchase_metadata: {
            kind: "accommodation_booking",
            accommodation_name: "Classic Double",
            property_name: "Hotel Arcadia",
            property_address: "Avenida melian 2487",
            unit_label: "201",
            check_in: "2026-06-12",
            check_out: "2026-06-15",
            nights: 3,
            guests: [{ name: "Alice Johnson" }],
            quote: { total: "495", currency: "USD" },
          },
        })}
        imageUrl={null}
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByText("Hotel Arcadia")).toBeTruthy()
    expect(screen.getByText("Avenida melian 2487")).toBeTruthy()
    expect(screen.getByText("Alice Johnson")).toBeTruthy()
    expect(screen.getByText("$495")).toBeTruthy()
    expect(screen.queryByTestId("qr-payload")).toBeNull()
  })
})
