import { describe, expect, it } from "vitest"
import { isEventLive } from "./eventLiveState"

const start = "2026-06-01T20:30:00.000Z"
const end = "2026-06-01T22:00:00.000Z"
const at = (iso: string) => new Date(iso).getTime()

describe("isEventLive", () => {
  it("is live between start and end", () => {
    expect(isEventLive(start, end, at("2026-06-01T21:01:00.000Z"))).toBe(true)
  })

  it("is live at the exact start instant", () => {
    expect(isEventLive(start, end, at(start))).toBe(true)
  })

  it("is not live at the exact end instant", () => {
    expect(isEventLive(start, end, at(end))).toBe(false)
  })

  it("is not live before the start", () => {
    expect(isEventLive(start, end, at("2026-06-01T20:29:59.999Z"))).toBe(false)
  })

  it("is not live after the end", () => {
    expect(isEventLive(start, end, at("2026-06-01T22:00:00.001Z"))).toBe(false)
  })

  it("hands over cleanly between back-to-back events", () => {
    const handover = at("2026-06-01T22:00:00.000Z")
    const next = "2026-06-01T23:30:00.000Z"
    expect(isEventLive(start, end, handover)).toBe(false)
    expect(isEventLive(end, next, handover)).toBe(true)
  })

  it("reads the same instant regardless of how the offset is written", () => {
    // 20:30Z and 22:00Z expressed as a -07:00 wall clock: same instants,
    // so the answer must not change.
    expect(
      isEventLive(
        "2026-06-01T13:30:00-07:00",
        "2026-06-01T15:00:00-07:00",
        at("2026-06-01T21:01:00.000Z"),
      ),
    ).toBe(true)
  })

  it("is not live for a zero-length or inverted window", () => {
    expect(isEventLive(start, start, at(start))).toBe(false)
    expect(isEventLive(end, start, at("2026-06-01T21:01:00.000Z"))).toBe(false)
  })

  it("is not live without usable timestamps", () => {
    expect(isEventLive(null, end, at(start))).toBe(false)
    expect(isEventLive(start, undefined, at(start))).toBe(false)
    expect(isEventLive("", "", at(start))).toBe(false)
    expect(isEventLive("not-a-date", end, at(start))).toBe(false)
    expect(isEventLive(start, "not-a-date", at(start))).toBe(false)
  })
})
