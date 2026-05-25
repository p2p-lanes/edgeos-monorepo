import { describe, expect, it } from "vitest"
import { dedupTicketEntries } from "./dedupTickets"

type Entry = {
  id: string
  product_id: string
  product_category?: string | null
  duration_type?: string | null
  last_scan_at?: string | null
}

const make = (overrides: Partial<Entry> & { id: string }): Entry => ({
  product_id: "p1",
  product_category: "ticket",
  duration_type: "week",
  last_scan_at: null,
  ...overrides,
})

describe("dedupTicketEntries", () => {
  it("collapses two rows of the same product_id (ticket, non-day) to one", () => {
    const entries = [make({ id: "a" }), make({ id: "b" })]
    const result = dedupTicketEntries(entries)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe("a")
  })

  it("keeps both rows when duration_type is day", () => {
    const entries = [
      make({ id: "a", duration_type: "day" }),
      make({ id: "b", duration_type: "day" }),
    ]
    const result = dedupTicketEntries(entries)
    expect(result).toHaveLength(2)
    expect(result.map((e) => e.id)).toEqual(["a", "b"])
  })

  it("keeps all rows when category is meal_plan", () => {
    const entries = [
      make({ id: "a", product_category: "meal_plan", duration_type: null }),
      make({ id: "b", product_category: "meal_plan", duration_type: null }),
      make({ id: "c", product_category: "meal_plan", duration_type: null }),
    ]
    const result = dedupTicketEntries(entries)
    expect(result).toHaveLength(3)
    expect(result.map((e) => e.id)).toEqual(["a", "b", "c"])
  })

  it("prefers the row with last_scan_at when collapsing", () => {
    const entries = [
      make({ id: "a", last_scan_at: null }),
      make({ id: "b", last_scan_at: "2026-05-20T10:00:00Z" }),
    ]
    const result = dedupTicketEntries(entries)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe("b")
  })

  it("prefers the row with non-empty product_category as defensive fallback", () => {
    const entries = [
      make({ id: "a", product_category: "" }),
      make({ id: "b", product_category: "ticket" }),
    ]
    const result = dedupTicketEntries(entries)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe("b")
  })

  it("dedupes 5 duplicated weeks (10 rows) + keeps 2 meal plans + 1 housing", () => {
    const weeks: Entry[] = []
    for (let i = 0; i < 5; i++) {
      const pid = `week-${i}`
      weeks.push(
        make({ id: `${pid}-row1`, product_id: pid }),
        make({ id: `${pid}-row2`, product_id: pid }),
      )
    }
    const meals: Entry[] = [
      make({
        id: "meal-1",
        product_id: "meal",
        product_category: "meal_plan",
        duration_type: null,
      }),
      make({
        id: "meal-2",
        product_id: "meal",
        product_category: "meal_plan",
        duration_type: null,
      }),
    ]
    const housing: Entry[] = [
      make({
        id: "house-1",
        product_id: "house",
        product_category: "housing",
        duration_type: null,
      }),
    ]

    const result = dedupTicketEntries([...weeks, ...meals, ...housing])
    expect(result).toHaveLength(5 + 2 + 1)
    expect(result.filter((e) => e.product_id.startsWith("week-"))).toHaveLength(
      5,
    )
    expect(result.filter((e) => e.product_id === "meal")).toHaveLength(2)
    expect(result.filter((e) => e.product_id === "house")).toHaveLength(1)
  })

  it("returns an empty array when given an empty array", () => {
    expect(dedupTicketEntries([])).toEqual([])
  })

  it("preserves order and identity when no duplicates exist", () => {
    const entries = [
      make({ id: "a", product_id: "p1" }),
      make({ id: "b", product_id: "p2" }),
      make({ id: "c", product_id: "p3" }),
    ]
    const result = dedupTicketEntries(entries)
    expect(result).toEqual(entries)
  })
})
