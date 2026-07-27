import { describe, expect, it } from "vitest"
import { getAuthRedirectPath, getSafeReturnTo } from "./safe-return-to"

describe("getSafeReturnTo", () => {
  it("keeps internal paths, query strings, and hashes", () => {
    expect(getSafeReturnTo("/portal/tech-summit-2025?tab=events#details")).toBe(
      "/portal/tech-summit-2025?tab=events#details",
    )
  })

  it("rejects external and protocol-relative URLs", () => {
    expect(getSafeReturnTo("https://example.com/portal/event")).toBeNull()
    expect(getSafeReturnTo("//example.com/portal/event")).toBeNull()
  })
})

describe("getAuthRedirectPath", () => {
  it("preserves a popup deep link for post-login navigation", () => {
    expect(getAuthRedirectPath("/portal/tech-summit-2025")).toBe(
      "/auth?redirect=%2Fportal%2Ftech-summit-2025",
    )
  })

  it("falls back to auth for unsafe return paths", () => {
    expect(getAuthRedirectPath("https://example.com")).toBe("/auth")
  })

  it("does not redirect the auth page back to itself", () => {
    expect(getAuthRedirectPath("/auth?redirect=%2Fportal")).toBe("/auth")
  })
})
