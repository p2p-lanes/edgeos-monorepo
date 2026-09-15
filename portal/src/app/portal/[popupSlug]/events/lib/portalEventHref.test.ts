import { describe, expect, it } from "vitest"
import { buildPortalEventHref } from "./portalEventHref"

describe("buildPortalEventHref", () => {
  it("builds a plain event URL without optional context", () => {
    expect(buildPortalEventHref({ slug: "summit", eventId: "event-1" })).toBe(
      "/portal/summit/events/event-1",
    )
  })

  it("retains the selected application flow", () => {
    expect(
      buildPortalEventHref({
        slug: "summit",
        eventId: "event-1",
        flowId: "attendee-flow",
      }),
    ).toBe("/portal/summit/events/event-1?flow=attendee-flow")
  })

  it("encodes list state and a recurring occurrence", () => {
    expect(
      buildPortalEventHref({
        slug: "summit",
        eventId: "event-1",
        flowId: "volunteer-flow",
        from: "view=calendar&date=2026-09-15",
        occurrenceStart: "2026-09-15T20:30:00Z",
      }),
    ).toBe(
      "/portal/summit/events/event-1?flow=volunteer-flow&from=view%3Dcalendar%26date%3D2026-09-15&occ=2026-09-15T20%3A30%3A00Z",
    )
  })

  it("places suffixes before the query string", () => {
    expect(
      buildPortalEventHref({
        slug: "summit",
        eventId: "event-1",
        flowId: "attendee-flow",
        suffix: "/edit",
      }),
    ).toBe("/portal/summit/events/event-1/edit?flow=attendee-flow")
  })
})
