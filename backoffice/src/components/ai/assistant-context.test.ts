import { describe, expect, it } from "vitest"
import { assistantContextForPath } from "./assistant-context"

describe("assistantContextForPath", () => {
  it("provides route-specific suggestions", () => {
    expect(assistantContextForPath("/applications")).toMatchObject({
      pageLabel: "Applications",
      placeholder: "Ask about applications…",
    })
    expect(
      assistantContextForPath("/applications/application-1").suggestions,
    ).toContain("Find an application by name or email")
    expect(assistantContextForPath("/payments").pageLabel).toBe("Payments")
  })

  it("falls back to the gathering dashboard context", () => {
    expect(assistantContextForPath("/unknown")).toMatchObject({
      pageLabel: "Dashboard",
      placeholder: "Ask about this gathering…",
    })
  })
})
