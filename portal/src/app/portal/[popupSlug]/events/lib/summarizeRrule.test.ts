import type { TFunction } from "i18next"
import { describe, expect, it } from "vitest"
import { summarizeRrule } from "./summarizeRrule"

// Echoes the key plus interpolated days so assertions can see exactly which
// translation keys were requested.
const t = ((key: string, opts?: { days?: string }) =>
  opts?.days ? `${key}(${opts.days})` : key) as unknown as TFunction

describe("summarizeRrule", () => {
  it("falls back to the plain weekly summary when BYDAY is absent", () => {
    const summary = summarizeRrule("FREQ=WEEKLY;INTERVAL=1;COUNT=4", t)

    expect(summary).toContain("events.recurrence.weekly")
    expect(summary).not.toContain("weekday_")
  })

  it("lists the translated weekdays when BYDAY is present", () => {
    const summary = summarizeRrule("FREQ=WEEKLY;BYDAY=MO,WE", t)

    expect(summary).toContain(
      "events.recurrence.weekly_on(events.recurrence.weekday_MO, events.recurrence.weekday_WE)",
    )
  })
})
