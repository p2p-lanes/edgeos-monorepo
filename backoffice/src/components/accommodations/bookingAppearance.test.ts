/**
 * How a booking is classified for display.
 *
 * The distinction that matters operationally is "paid through the checkout"
 * vs "somebody entered this by hand": they are both `confirmed` in the
 * database and only `payment_id` tells them apart. Getting it wrong makes a
 * comp look like revenue.
 */
import { describe, expect, it } from "vitest"
import { bookingAppearanceKey, bookingBarLabel } from "./bookingAppearance"

describe("bookingAppearanceKey", () => {
  it("separates a checkout sale from a staff booking by its payment", () => {
    expect(
      bookingAppearanceKey({
        kind: "guest",
        status: "confirmed",
        payment_id: "pay_1",
      }),
    ).toBe("confirmed")

    expect(
      bookingAppearanceKey({
        kind: "guest",
        status: "confirmed",
        payment_id: null,
      }),
    ).toBe("manual")
  })

  it("marks a stay waiting on a payment as a hold", () => {
    expect(bookingAppearanceKey({ kind: "guest", status: "hold" })).toBe("hold")
  })

  it("treats blocks and maintenance as one thing", () => {
    expect(bookingAppearanceKey({ kind: "block", status: "confirmed" })).toBe(
      "block",
    )
    expect(
      bookingAppearanceKey({ kind: "maintenance", status: "confirmed" }),
    ).toBe("block")
  })

  it("lets a cancelled block still read as released", () => {
    // Status wins over kind: the room is free, which is the fact the operator
    // is looking for.
    expect(bookingAppearanceKey({ kind: "block", status: "cancelled" })).toBe(
      "released",
    )
    expect(bookingAppearanceKey({ kind: "guest", status: "expired" })).toBe(
      "released",
    )
  })
})

describe("bookingBarLabel", () => {
  it("names the guest when there is one", () => {
    expect(bookingBarLabel({ kind: "guest", primary_guest_name: "Ada" })).toBe(
      "Ada",
    )
  })

  it("falls back to a word rather than an empty bar", () => {
    expect(bookingBarLabel({ kind: "guest", primary_guest_name: "  " })).toBe(
      "Guest",
    )
    expect(bookingBarLabel({ kind: "block" })).toBe("Blocked")
  })

  it("shows why a block exists, since it has no guest to name", () => {
    expect(bookingBarLabel({ kind: "maintenance", notes: "Repainting" })).toBe(
      "Repainting",
    )
  })
})
