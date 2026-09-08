/**
 * The booking page.
 *
 * What is pinned here is what the page decides to show, not how it looks:
 * a blocked range is not a guest and must not be given a guest list or a
 * price it never had, and a released booking must not offer to release it
 * again. Both were behaviours of the dialog this replaced, and both are easy
 * to lose when a component grows a second column.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/client", () => ({
  AccommodationsService: {
    updateBooking: vi.fn(),
  },
}))

vi.mock("@/hooks/useCustomToast", () => ({
  default: () => ({
    showSuccessToast: vi.fn(),
    showErrorToast: vi.fn(),
  }),
}))

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="/">{children}</a>,
}))

import { type AccommodationBookingDetail, AccommodationsService } from "@/client"
import { BookingDetailPage } from "./BookingDetailPage"

const mockUpdate = vi.mocked(AccommodationsService.updateBooking)

const BASE = {
  id: "booking-1",
  accommodation_id: "room-1",
  unit_id: "unit-1",
  kind: "guest",
  status: "confirmed",
  check_in: "2026-06-01",
  check_out: "2026-06-08",
  nights: 7,
  guest_count: 2,
  guests: [],
  booker_answers: {},
  form_snapshot: null,
  primary_guest_name: "Ada Lovelace",
  primary_guest_email: "ada@example.com",
  payment_id: "payment-1",
  price_snapshot: null,
  notes: null,
  property_id: "property-1",
  property_name: "Hotel Arcadia",
  property_address: "12 Long Street",
  accommodation_name: "Classic Double",
  unit_label: "A1",
  units: [
    { id: "unit-1", label: "A1", is_active: true },
    { id: "unit-2", label: "A2", is_active: true },
  ],
}

function booking(
  overrides: Record<string, unknown> = {},
): AccommodationBookingDetail {
  return { ...BASE, ...overrides } as unknown as AccommodationBookingDetail
}

function renderPage(detail: AccommodationBookingDetail) {
  const onReleased = vi.fn()
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <BookingDetailPage booking={detail} onReleased={onReleased} />
    </QueryClientProvider>,
  )
  return { onReleased }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockUpdate.mockResolvedValue({} as never)
})

describe("the stay", () => {
  it("shows the nights, the building and the bed", () => {
    renderPage(booking())

    expect(screen.getByText("Mon 1 Jun")).toBeTruthy()
    expect(screen.getByText("7 nights")).toBeTruthy()
    expect(screen.getByText("Hotel Arcadia")).toBeTruthy()
    expect(screen.getByText("A1")).toBeTruthy()
  })
})

describe("what a booking has on it", () => {
  it("lists each person and what they answered", () => {
    renderPage(
      booking({
        form_snapshot: {
          booker: { fields: [{ key: "passport", label: "Passport number" }] },
          guests: { mode: "same_as_booker", fields: [] },
        },
        booker_answers: { passport: "X1" },
        guests: [{ name: "Ada", answers: { passport: "X1" } }],
      }),
    )

    expect(screen.getByText("Booking contact")).toBeTruthy()
    expect(screen.getAllByText("Passport number")).toHaveLength(2)
    expect(screen.getAllByText("X1")).toHaveLength(2)
    expect(screen.getByText("Ada")).toBeTruthy()
  })

  it("says so plainly when nobody was named", () => {
    renderPage(booking())

    expect(screen.getByText(/Nobody was named/)).toBeTruthy()
  })

  it("shows the money out of the frozen quote", () => {
    renderPage(
      booking({
        price_snapshot: {
          subtotal: "100",
          tax: "21",
          total: "121",
          currency: "USD",
        },
      }),
    )

    expect(screen.getByText("Charged")).toBeTruthy()
    expect(screen.getByText("121 USD")).toBeTruthy()
  })
})

describe("a blocked range is not a guest", () => {
  const blocked = booking({
    kind: "block",
    primary_guest_name: null,
    primary_guest_email: null,
    payment_id: null,
    notes: "Repainting",
    price_snapshot: { total: "0", currency: "USD" },
  })

  it("has no guest list and no money", () => {
    renderPage(blocked)

    expect(screen.queryByText("Guest details")).toBeNull()
    expect(screen.queryByText("Charged")).toBeNull()
    expect(screen.getByText("Repainting")).toBeTruthy()
  })

  it("offers to unblock, not to cancel a booking", () => {
    renderPage(blocked)

    expect(screen.getByRole("button", { name: "Unblock these dates" })).toBeTruthy()
  })
})

describe("acting on it", () => {
  it("moves the guest to the unit that was picked", async () => {
    const user = userEvent.setup()
    renderPage(booking())

    await user.click(screen.getByRole("combobox"))
    await user.click(screen.getByRole("option", { name: "A2" }))
    await user.click(screen.getByRole("button", { name: "Move" }))

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith({
        bookingId: "booking-1",
        requestBody: { unit_id: "unit-2" },
      })
    })
  })

  it("leaves the page once the room is released", async () => {
    const user = userEvent.setup()
    const { onReleased } = renderPage(booking())

    await user.click(screen.getByRole("button", { name: "Cancel booking" }))

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith({
        bookingId: "booking-1",
        requestBody: { status: "cancelled" },
      })
      expect(onReleased).toHaveBeenCalled()
    })
  })

  it("does not offer to release a booking that is already released", () => {
    renderPage(booking({ status: "cancelled" }))

    expect(screen.queryByRole("button", { name: "Cancel booking" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Move" })).toBeNull()
  })
})
