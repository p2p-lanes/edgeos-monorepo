import { describe, expect, it } from "vitest"
import { nextOpenDayTarget } from "./ListBody"

// The events list collapses one day at a time; on collapse we scroll to the
// header returned here. These guard the selection logic of that fix.
describe("nextOpenDayTarget", () => {
  const days = ["2026-06-10", "2026-06-11", "2026-06-12"]

  it("targets the immediately-following day when it is open", () => {
    expect(nextOpenDayTarget("2026-06-10", days, new Set())).toBe("2026-06-11")
  })

  it("skips already-collapsed days to reach the next open one", () => {
    expect(
      nextOpenDayTarget("2026-06-10", days, new Set(["2026-06-11"])),
    ).toBe("2026-06-12")
  })

  it("falls back to the collapsed day itself when no open day follows", () => {
    // Collapsing the last day...
    expect(nextOpenDayTarget("2026-06-12", days, new Set())).toBe("2026-06-12")
    // ...or every later day is already collapsed.
    expect(
      nextOpenDayTarget(
        "2026-06-10",
        days,
        new Set(["2026-06-11", "2026-06-12"]),
      ),
    ).toBe("2026-06-10")
  })

  it("returns null when the collapsed day isn't in the list (no scroll)", () => {
    expect(nextOpenDayTarget("1999-01-01", days, new Set())).toBeNull()
  })
})
