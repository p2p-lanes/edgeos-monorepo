import { describe, expect, it } from "vitest"
import { deadlineInZone, deadlineToUtc } from "./responseEditDeadline"

describe("response editing deadlines", () => {
  it("interprets an India deadline independently of the browser's zone", () => {
    expect(deadlineToUtc("2026-10-20T12:00", "Asia/Kolkata")).toBe(
      "2026-10-20T06:30:00.000Z",
    )
    expect(deadlineInZone("2026-10-20T06:30:00Z", "Asia/Kolkata")).toBe(
      "2026-10-20T12:00",
    )
  })
  it.each([
    "2026-02-30T12:00",
    "2026-10-23T25:00",
    "2026-10-23T9:00",
    "23/10/2026T12:00",
  ])("rejects invalid typed deadline %s", (value) => {
    expect(() => deadlineToUtc(value, "Asia/Kolkata")).toThrow()
  })
  it("rejects invalid zones and nonexistent daylight-saving times", () => {
    expect(() => deadlineToUtc("2026-10-20T12:00", "Invalid/Zone")).toThrow()
    expect(() =>
      deadlineToUtc("2026-03-08T02:30", "America/New_York"),
    ).toThrow()
  })
})
