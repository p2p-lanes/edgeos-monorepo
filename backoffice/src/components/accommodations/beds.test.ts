/**
 * Bed parsing sits between an untyped JSONB column and three surfaces that
 * render it (the rooms table, the checkout card, the CSV export). A malformed
 * entry from an older row must degrade to "one fewer bed listed", never to a
 * crashed table.
 */
import { describe, expect, it } from "vitest"
import { describeBeds, parseBeds, sleepsFromBeds } from "./beds"

describe("parseBeds", () => {
  it("keeps well-formed entries", () => {
    expect(
      parseBeds([
        { type: "queen", count: 1 },
        { type: "single", count: 2 },
      ]),
    ).toEqual([
      { type: "queen", count: 1 },
      { type: "single", count: 2 },
    ])
  })

  it("drops entries with an unknown bed type", () => {
    expect(parseBeds([{ type: "hammock", count: 1 }])).toEqual([])
  })

  it("drops entries with a missing or nonsense count", () => {
    expect(
      parseBeds([
        { type: "queen" },
        { type: "queen", count: 0 },
        { type: "queen", count: "many" },
      ]),
    ).toEqual([])
  })

  it("floors fractional counts rather than rendering '1.5 beds'", () => {
    expect(parseBeds([{ type: "bunk", count: 2.7 }])).toEqual([
      { type: "bunk", count: 2 },
    ])
  })

  it("survives anything that is not a list", () => {
    expect(parseBeds(null)).toEqual([])
    expect(parseBeds(undefined)).toEqual([])
    expect(parseBeds("1 queen")).toEqual([])
    expect(parseBeds([null, 3, "queen"])).toEqual([])
  })
})

describe("describeBeds", () => {
  it("reads as a sentence a guest would recognise", () => {
    expect(
      describeBeds([
        { type: "king", count: 1 },
        { type: "single", count: 2 },
      ]),
    ).toBe("1 King · 2 Single")
  })

  it("is empty when there is nothing to describe", () => {
    expect(describeBeds([])).toBe("")
    expect(describeBeds(null)).toBe("")
  })
})

describe("sleepsFromBeds", () => {
  it("counts a double bed as two people and a single as one", () => {
    expect(sleepsFromBeds([{ type: "queen", count: 1 }])).toBe(2)
    expect(sleepsFromBeds([{ type: "single", count: 3 }])).toBe(3)
  })

  it("counts a bunk as two", () => {
    expect(sleepsFromBeds([{ type: "bunk", count: 2 }])).toBe(4)
  })

  it("counts a sofa bed as one", () => {
    expect(sleepsFromBeds([{ type: "sofa", count: 1 }])).toBe(1)
  })

  it("is zero with no beds, so the capacity warning stays quiet", () => {
    expect(sleepsFromBeds([])).toBe(0)
  })
})
