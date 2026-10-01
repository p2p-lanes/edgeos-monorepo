import { describe, expect, it } from "vitest"

import { getEventCheckInUrl, getFlowCheckoutUrl } from "./portal-urls"

describe("getFlowCheckoutUrl", () => {
  it("builds a direct checkout URL with its flow slug", () => {
    expect(
      getFlowCheckoutUrl(
        "https://demo.edgeos.world",
        "spring-fest",
        "checkout",
      ),
    ).toBe("https://demo.edgeos.world/checkout/spring-fest/checkout")
  })

  it("preserves a named flow slug instead of returning a bare popup checkout URL", () => {
    expect(
      getFlowCheckoutUrl(
        "https://demo.edgeos.world",
        "spring-fest",
        "vip-pass",
      ),
    ).toBe("https://demo.edgeos.world/checkout/spring-fest/vip-pass")
  })
})

describe("getEventCheckInUrl", () => {
  it("points at the event's own check-in landing page", () => {
    expect(
      getEventCheckInUrl(
        "https://demo.edgeos.world",
        "spring-fest",
        "11111111-2222-3333-4444-555555555555",
      ),
    ).toBe(
      "https://demo.edgeos.world/portal/spring-fest/events/11111111-2222-3333-4444-555555555555/check-in",
    )
  })

  it("pins a recurring series to one occurrence", () => {
    expect(
      getEventCheckInUrl(
        "https://demo.edgeos.world",
        "spring-fest",
        "event-1",
        "2026-06-09T18:00:00+00:00",
      ),
    ).toBe(
      "https://demo.edgeos.world/portal/spring-fest/events/event-1/check-in?occ=2026-06-09T18%3A00%3A00%2B00%3A00",
    )
  })

  it("leaves the occurrence off a one-off event", () => {
    expect(
      getEventCheckInUrl(
        "https://demo.edgeos.world",
        "spring-fest",
        "event-1",
        null,
      ),
    ).not.toContain("occ=")
  })

  it("serves a local portal over http, which is the only scheme it answers on", () => {
    expect(
      getEventCheckInUrl(
        "https://demo.localhost:3000",
        "spring-fest",
        "event-1",
      ),
    ).toBe(
      "http://demo.localhost:3000/portal/spring-fest/events/event-1/check-in",
    )
  })

  it("keeps a custom domain's own host", () => {
    expect(
      getEventCheckInUrl(
        "https://tickets.example.org",
        "spring-fest",
        "event-1",
      ),
    ).toBe(
      "https://tickets.example.org/portal/spring-fest/events/event-1/check-in",
    )
  })
})
