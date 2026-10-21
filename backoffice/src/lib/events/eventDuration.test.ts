import { describe, expect, it } from "vitest"
import {
  computeEventEnd,
  draftFromMinutes,
  parseDurationDraft,
  splitMinutes,
} from "./eventDuration"

describe("splitMinutes", () => {
  it.each([
    [30, 0, 30],
    [60, 1, 0],
    [90, 1, 30],
    [1560, 26, 0],
  ])("%i min -> %i h %i min", (total, hours, minutes) => {
    expect(splitMinutes(total)).toEqual({ hours, minutes })
  })
})

describe("draftFromMinutes", () => {
  it("splits a total into hours and minutes text", () => {
    expect(draftFromMinutes(90)).toEqual({ hours: "1", minutes: "30" })
    expect(draftFromMinutes(30)).toEqual({ hours: "0", minutes: "30" })
  })

  it("keeps multi-day durations intact", () => {
    expect(draftFromMinutes(26 * 60 + 15)).toEqual({
      hours: "26",
      minutes: "15",
    })
  })

  it("returns empty inputs for a missing or negative total", () => {
    expect(draftFromMinutes(null)).toEqual({ hours: "", minutes: "" })
    expect(draftFromMinutes(Number.NaN)).toEqual({ hours: "", minutes: "" })
    expect(draftFromMinutes(-5)).toEqual({ hours: "", minutes: "" })
  })
})

describe("parseDurationDraft", () => {
  it("adds hours and minutes", () => {
    expect(parseDurationDraft({ hours: "1", minutes: "30" })).toEqual({
      ok: true,
      minutes: 90,
    })
  })

  it("does not truncate decimal hours", () => {
    expect(parseDurationDraft({ hours: "1.5", minutes: "" })).toEqual({
      ok: true,
      minutes: 90,
    })
  })

  it("accepts minutes above 59 without changing the total", () => {
    expect(parseDurationDraft({ hours: "0", minutes: "90" })).toEqual({
      ok: true,
      minutes: 90,
    })
  })

  it("treats one empty input as zero", () => {
    expect(parseDurationDraft({ hours: "", minutes: "45" })).toEqual({
      ok: true,
      minutes: 45,
    })
    expect(parseDurationDraft({ hours: "2", minutes: "" })).toEqual({
      ok: true,
      minutes: 120,
    })
  })

  it("round-trips a 26 h event", () => {
    const draft = draftFromMinutes(1560)
    expect(parseDurationDraft(draft)).toEqual({ ok: true, minutes: 1560 })
  })

  it("reports empty inputs as required instead of defaulting", () => {
    expect(parseDurationDraft({ hours: "", minutes: " " })).toEqual({
      ok: false,
      error: "required",
    })
  })

  it("reports a zero total", () => {
    expect(parseDurationDraft({ hours: "0", minutes: "0" })).toEqual({
      ok: false,
      error: "not_positive",
    })
  })

  it.each([
    { hours: "-1", minutes: "" },
    { hours: "abc", minutes: "" },
    { hours: "1e2", minutes: "" },
    { hours: "1", minutes: "7.5" },
    { hours: "1", minutes: "-5" },
    // 1.01 h = 60.6 min: not a whole number of minutes.
    { hours: "1.01", minutes: "" },
  ])("rejects $hours h $minutes min as invalid", (draft) => {
    expect(parseDurationDraft(draft)).toEqual({ ok: false, error: "invalid" })
  })
})

describe("computeEventEnd", () => {
  it("formats the end time in the event timezone", () => {
    // 15:00 in Los Angeles (UTC-7 in June) = 22:00Z.
    const start = Date.parse("2026-06-04T22:00:00.000Z")
    expect(computeEventEnd(start, 90, "America/Los_Angeles")).toEqual({
      endMs: Date.parse("2026-06-04T23:30:00.000Z"),
      time: "16:30",
      dayOffset: 0,
    })
  })

  it("counts calendar days in the event timezone, not UTC", () => {
    // 15:00 LA + 2 h = 17:00 LA, still the same LA day even though the
    // UTC date rolls over.
    const start = Date.parse("2026-06-04T22:00:00.000Z")
    expect(computeEventEnd(start, 120, "America/Los_Angeles")?.dayOffset).toBe(
      0,
    )
  })

  it("flags events that end on a later day", () => {
    const start = Date.parse("2026-06-04T22:00:00.000Z")
    const end = computeEventEnd(start, 26 * 60, "America/Los_Angeles")
    expect(end?.time).toBe("17:00")
    expect(end?.dayOffset).toBe(1)
  })

  it("returns null without a valid start or duration", () => {
    expect(computeEventEnd(Number.NaN, 60, "UTC")).toBeNull()
    expect(computeEventEnd(Date.now(), 0, "UTC")).toBeNull()
  })
})
