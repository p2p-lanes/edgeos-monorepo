import { describe, expect, it } from "vitest"
import { getOpenCartScope } from "./useOpenCartPersistence"

describe("getOpenCartScope", () => {
  it("keeps a named flow cart separate from the compatibility-default cart", () => {
    expect(getOpenCartScope("festival-2026", "merch-store")).toEqual({
      storageKey: "open-cart:festival-2026:merch-store",
      isNamedFlow: true,
    })
  })

  it("preserves the compatibility-default cart key when the flow is omitted", () => {
    expect(getOpenCartScope("festival-2026")).toEqual({
      storageKey: "open-cart:festival-2026",
      isNamedFlow: false,
    })
  })
})
