import { describe, expect, it } from "vitest"

import { getFlowCheckoutUrl } from "./portal-urls"

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
