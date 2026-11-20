import { describe, expect, it } from "vitest"
import {
  compareOptionalDates,
  formatDate,
  formatDateRange,
  toTimestamp,
} from "./dates"

const LONG: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "long",
  year: "numeric",
}

describe("toTimestamp", () => {
  it("returns null for missing or unparseable dates", () => {
    expect(toTimestamp(null)).toBeNull()
    expect(toTimestamp(undefined)).toBeNull()
    expect(toTimestamp("")).toBeNull()
    expect(toTimestamp("not-a-date")).toBeNull()
  })

  it("returns epoch milliseconds for valid dates", () => {
    expect(toTimestamp("2026-06-15T00:00:00Z")).toBe(Date.UTC(2026, 5, 15))
  })
})

describe("formatDate", () => {
  it("returns an empty string instead of Invalid Date", () => {
    expect(formatDate(null, LONG)).toBe("")
    expect(formatDate(undefined, LONG)).toBe("")
    expect(formatDate("", LONG)).toBe("")
    expect(formatDate("not-a-date", LONG)).toBe("")
  })

  it("formats the calendar date of a valid value", () => {
    expect(formatDate("2026-06-15T09:00:00Z", LONG)).toBe("June 15, 2026")
  })
})

describe("formatDateRange", () => {
  it("returns an empty string when neither date is set", () => {
    expect(formatDateRange(null, null, LONG)).toBe("")
    expect(formatDateRange("", undefined, LONG)).toBe("")
  })

  it("returns the single date when only one side is set", () => {
    expect(formatDateRange("2026-06-15", null, LONG)).toBe("June 15, 2026")
    expect(formatDateRange(null, "2026-06-20", LONG)).toBe("June 20, 2026")
  })

  it("joins both dates when both are set", () => {
    expect(formatDateRange("2026-06-15", "2026-06-20", LONG)).toBe(
      "June 15, 2026 - June 20, 2026",
    )
  })
})

describe("compareOptionalDates", () => {
  const dates = [null, "2026-06-20", "", "2026-01-01", "not-a-date"]

  it("treats undefined as a missing date", () => {
    expect(compareOptionalDates(undefined, "2026-01-01")).toBe(1)
    expect(compareOptionalDates("2026-01-01", undefined, "desc")).toBe(-1)
    expect(compareOptionalDates(undefined, null)).toBe(0)
  })

  it("sorts ascending with missing dates last", () => {
    expect([...dates].sort((a, b) => compareOptionalDates(a, b))).toEqual([
      "2026-01-01",
      "2026-06-20",
      null,
      "",
      "not-a-date",
    ])
  })

  it("sorts descending with missing dates still last", () => {
    expect(
      [...dates].sort((a, b) => compareOptionalDates(a, b, "desc")),
    ).toEqual(["2026-06-20", "2026-01-01", null, "", "not-a-date"])
  })
})
