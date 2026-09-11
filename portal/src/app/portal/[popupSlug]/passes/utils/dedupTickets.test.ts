import { describe, expect, it } from "vitest"
import { dedupTicketEntries } from "./dedupTickets"

type Entry = {
  id: string
  product_id: string
  payment_id?: string | null
}

describe("dedupTicketEntries", () => {
  it("preserves physical tickets that share a product", () => {
    const entries: Entry[] = [
      { id: "ticket-a", product_id: "product-1", payment_id: "payment-a" },
      { id: "ticket-b", product_id: "product-1", payment_id: "payment-b" },
    ]

    expect(dedupTicketEntries(entries)).toEqual(entries)
  })

  it("removes repeated API rows with the same ticket identity", () => {
    const first: Entry = {
      id: "ticket-a",
      product_id: "product-1",
      payment_id: "payment-a",
    }
    const duplicate: Entry = {
      id: "ticket-a",
      product_id: "product-1",
      payment_id: "payment-a",
    }

    expect(dedupTicketEntries([first, duplicate])).toEqual([first])
  })

  it("preserves stable order across products", () => {
    const entries: Entry[] = [
      { id: "ticket-c", product_id: "product-2" },
      { id: "ticket-a", product_id: "product-1" },
      { id: "ticket-b", product_id: "product-1" },
    ]

    expect(dedupTicketEntries(entries)).toEqual(entries)
  })

  it("returns the same empty array", () => {
    const entries: Entry[] = []
    expect(dedupTicketEntries(entries)).toBe(entries)
  })
})
