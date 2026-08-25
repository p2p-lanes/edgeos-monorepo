import { describe, expect, it } from "vitest"
import { getOpenCartScope } from "./useOpenCartPersistence"

describe("getOpenCartScope", () => {
  it("keeps a named flow cart separate from the compatibility-default cart", () => {
    expect(getOpenCartScope("festival-2026", "merch-store")).toEqual({
      storageKey: "open-cart:festival-2026:merch-store",
      isNamedFlow: true,
    })
  })

  it("preserves the compatibility cart key when an optional flow is omitted", () => {
    const scope = getOpenCartScope("festival-2026")

    expect(scope).toEqual({
      storageKey: "open-cart:festival-2026",
      isNamedFlow: false,
    })
    expect(scope.storageKey).not.toContain("undefined")
  })
})
