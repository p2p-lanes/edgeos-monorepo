import { describe, expect, it } from "vitest"
import type { PopupPublic } from "@/client"
import { resolveCheckoutSkin } from "./checkout-skin"

const p = (tc: unknown) => ({ theme_config: tc }) as unknown as PopupPublic

describe("resolveCheckoutSkin", () => {
  it("returns amanita when set", () => {
    expect(resolveCheckoutSkin(p({ checkout_skin: "amanita" }))).toBe("amanita")
  })
  it("defaults to default", () => {
    expect(resolveCheckoutSkin(p({}))).toBe("default")
    expect(resolveCheckoutSkin(p(null))).toBe("default")
    expect(resolveCheckoutSkin(null)).toBe("default")
    expect(resolveCheckoutSkin(p({ checkout_skin: "bogus" }))).toBe("default")
  })
})
