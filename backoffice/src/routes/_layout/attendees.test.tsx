/**
 * Tests for the attendees route.
 *
 * Covers flattenAttendeesForCsv: expands an attendee into one row per purchased
 * ticket (and a single empty-product row when the attendee has none).
 */
import { describe, expect, it, vi } from "vitest"

vi.mock("@/client", () => ({
  AttendeesService: {
    listAttendees: vi.fn(),
    getAttendee: vi.fn(),
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

import { flattenAttendeesForCsv } from "@/routes/_layout/attendees"

describe("flattenAttendeesForCsv", () => {
  it("returns one row per ticket when attendee has multiple products", () => {
    const attendee = {
      id: "att-1",
      tenant_id: "tenant-1",
      popup_id: "popup-1",
      name: "Alice",
      email: "alice@example.com",
      category: "main",
      gender: null,
      products: [
        {
          id: "prod-1",
          name: "Day Pass",
          tenant_id: "t",
          popup_id: "p",
          slug: "day",
          price: "0",
          quantity: 1,
        },
        {
          id: "prod-2",
          name: "Night Pass",
          tenant_id: "t",
          popup_id: "p",
          slug: "night",
          price: "0",
          quantity: 1,
        },
      ],
    }
    const rows = flattenAttendeesForCsv([attendee as never])
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ name: "Alice", product_id: "prod-1" })
    expect(rows[1]).toMatchObject({ name: "Alice", product_id: "prod-2" })
  })

  it("returns one row with empty product_id when attendee has no products", () => {
    const attendee = {
      id: "att-1",
      tenant_id: "tenant-1",
      popup_id: "popup-1",
      name: "Bob",
      email: "bob@example.com",
      category: "main",
      gender: null,
      products: [],
    }
    const rows = flattenAttendeesForCsv([attendee as never])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ name: "Bob", product_id: "" })
  })

  it("handles mixed attendees — preserves attendee-level data in each row", () => {
    const attendees = [
      {
        id: "att-1",
        tenant_id: "tenant-1",
        popup_id: "popup-1",
        name: "Alice",
        email: "alice@example.com",
        category: "main",
        gender: "female",
        products: [
          {
            id: "prod-1",
            name: "Day Pass",
            tenant_id: "t",
            popup_id: "p",
            slug: "day",
            price: "0",
            quantity: 1,
          },
        ],
      },
      {
        id: "att-2",
        tenant_id: "tenant-1",
        popup_id: "popup-1",
        name: "Bob",
        email: null,
        category: "spouse",
        gender: null,
        products: [],
      },
    ]
    const rows = flattenAttendeesForCsv(attendees as never[])
    expect(rows).toHaveLength(2)
    expect(rows[0].name).toBe("Alice")
    expect(rows[1].name).toBe("Bob")
    expect(rows[1].product_id).toBe("")
  })
})
