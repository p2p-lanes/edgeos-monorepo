import { describe, expect, it } from "vitest"
import { getMetaAttribution } from "./meta-pixel"

describe("getMetaAttribution", () => {
  it("reads Meta attribution cookies for checkout requests", () => {
    Object.defineProperty(document, "cookie", {
      configurable: true,
      value: "_fbc=fb.1.1710000000.click; _fbp=fb.1.1710000000.browser",
    })

    expect(getMetaAttribution()).toEqual({
      fbc: "fb.1.1710000000.click",
      fbp: "fb.1.1710000000.browser",
    })
  })
})
