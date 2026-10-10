import { describe, expect, it } from "vitest"
import type { PersonalTicketsPublic } from "@/client"
import { projectPersonalTickets } from "./personalTicketsProjection"

const row: PersonalTicketsPublic = {
  id: "recipient",
  name: "Jon",
  email: "jon@example.com",
  category: "spouse",
  popup_id: "popup",
  popup_name: "Popup",
  products: [{ name: "Spouse ticket", category: "ticket", quantity: 1 }],
  tickets: [
    {
      id: "unit",
      attendee_id: "recipient",
      product_id: "product",
      check_in_code: "QR",
      product_category_snapshot: "ticket",
    },
  ],
}

describe("personal ticket display projection", () => {
  it("includes unlinked personal recipients without constructing management state", () => {
    expect(projectPersonalTickets([row], "popup")).toEqual([row])
  })

  it("scopes tickets to the popup and excludes already represented attendees", () => {
    expect(projectPersonalTickets([row], "other")).toEqual([])
    expect(projectPersonalTickets([row], "popup", new Set([row.id]))).toEqual(
      [],
    )
  })

  it("excludes revoked, unallocated, non-ticket and mismatched recipient units", () => {
    const unit = row.tickets![0]
    for (const ticket of [
      { ...unit, revoked_at: "2026-10-01T00:00:00Z" },
      { ...unit, attendee_id: null },
      { ...unit, attendee_id: "other-person" },
      { ...unit, product_category_snapshot: "parking" },
      { ...unit, product_category_snapshot: null },
    ]) {
      expect(
        projectPersonalTickets([{ ...row, tickets: [ticket] }], "popup"),
      ).toEqual([])
    }
  })

  it("does not resurrect an explicitly empty unit list from grouped products", () => {
    expect(projectPersonalTickets([{ ...row, tickets: [] }], "popup")).toEqual(
      [],
    )
  })

  it("preserves summary-only responses for a rolling deployment", () => {
    const { tickets: _, ...summary } = row
    expect(projectPersonalTickets([summary], "popup")[0].products).toEqual(
      row.products,
    )
    expect(projectPersonalTickets([summary], "popup")[0].tickets).toEqual([])
  })

  it("does not treat zero quantities or parking summaries as a personal ticket", () => {
    const { tickets: _, ...summary } = row
    expect(
      projectPersonalTickets(
        [
          {
            ...summary,
            products: [{ name: "Pass", category: "ticket", quantity: 0 }],
          },
        ],
        "popup",
      ),
    ).toEqual([])
    expect(
      projectPersonalTickets(
        [
          {
            ...summary,
            products: [{ name: "Parking", category: "parking", quantity: 1 }],
          },
        ],
        "popup",
      ),
    ).toEqual([])
  })
})
