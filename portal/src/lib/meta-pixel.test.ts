import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { captureAttribution } from "./attribution"
import { getMetaAttribution } from "./meta-pixel"

function setDocumentCookie(value: string) {
  Object.defineProperty(document, "cookie", {
    configurable: true,
    value,
  })
}

describe("getMetaAttribution", () => {
  beforeEach(() => {
    window.localStorage.clear()
    setDocumentCookie("")
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("reads Meta attribution cookies for checkout requests", () => {
    setDocumentCookie(
      "_fbc=fb.1.1710000000.click; _fbp=fb.1.1710000000.browser",
    )

    expect(getMetaAttribution()).toEqual({
      fbc: "fb.1.1710000000.click",
      fbp: "fb.1.1710000000.browser",
    })
  })

  it("synthesizes fbc from a captured fbclid when the cookie is absent", () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1710000000123)
    captureAttribution(new URLSearchParams("fbclid=meta-click-id"))
    now.mockReturnValue(1720000000456)
    setDocumentCookie("_fbp=fb.1.1710000000.browser")

    expect(getMetaAttribution()).toEqual({
      fbc: "fb.1.1710000000123.meta-click-id",
      fbp: "fb.1.1710000000.browser",
    })
  })

  it("prefers Meta's fbc cookie over the fbclid fallback", () => {
    vi.spyOn(Date, "now").mockReturnValue(1710000000123)
    captureAttribution(new URLSearchParams("fbclid=meta-click-id"))
    setDocumentCookie("_fbc=fb.1.1700000000.cookie-click-id")

    expect(getMetaAttribution().fbc).toBe("fb.1.1700000000.cookie-click-id")
  })

  it("does not synthesize fbc from historical attribution without click metadata", () => {
    window.localStorage.setItem(
      "edgeos_attribution_v1",
      JSON.stringify({ fbclid: "historical-click" }),
    )

    expect(getMetaAttribution().fbc).toBeUndefined()
  })

  it("does not invent fbc when neither a cookie nor fbclid is available", () => {
    expect(getMetaAttribution()).toEqual({
      fbc: undefined,
      fbp: undefined,
    })
  })
})
