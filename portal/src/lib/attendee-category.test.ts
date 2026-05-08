import { describe, expect, it } from "vitest"
import { normalizeAttendeeCategory } from "./attendee-category"

describe("normalizeAttendeeCategory", () => {
  it("passes main through unchanged", () => {
    expect(normalizeAttendeeCategory("main")).toBe("main")
  })

  it("passes spouse through unchanged", () => {
    expect(normalizeAttendeeCategory("spouse")).toBe("spouse")
  })

  it("passes kid through unchanged", () => {
    expect(normalizeAttendeeCategory("kid")).toBe("kid")
  })

  it("normalises teen to kid", () => {
    expect(normalizeAttendeeCategory("teen")).toBe("kid")
  })

  it("normalises baby to kid", () => {
    expect(normalizeAttendeeCategory("baby")).toBe("kid")
  })

  it("passes unknown string through unchanged", () => {
    expect(normalizeAttendeeCategory("guest")).toBe("guest")
  })
})
