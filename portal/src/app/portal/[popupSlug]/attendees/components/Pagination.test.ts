import { describe, expect, it } from "vitest"
import { pageRange } from "./Pagination"

// Drives the "Showing X–Y of Z" label in the Attendee Directory footer.
describe("pageRange", () => {
  it("computes the first full page", () => {
    expect(pageRange(1, 10, 247)).toEqual({ from: 1, to: 10 })
  })

  it("clamps a short final page to the total", () => {
    expect(pageRange(25, 10, 247)).toEqual({ from: 241, to: 247 })
  })

  it("handles an exactly-full final page", () => {
    expect(pageRange(2, 10, 20)).toEqual({ from: 11, to: 20 })
  })

  it("returns a zero range when there are no items", () => {
    expect(pageRange(1, 10, 0)).toEqual({ from: 0, to: 0 })
  })
})
