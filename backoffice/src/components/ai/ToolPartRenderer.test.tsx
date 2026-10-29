import { describe, expect, it } from "vitest"
import { isInternalHref } from "./ToolPartRenderer"

describe("assistant markdown links", () => {
  it.each([
    ["/applications", true],
    ["/attendees/abc?tab=tickets", true],
    ["//evil.example.com", false],
    ["https://example.com", false],
    ["mailto:team@example.com", false],
    [undefined, false],
  ])("treats %s as internal: %s", (href, internal) => {
    expect(isInternalHref(href)).toBe(internal)
  })
})
