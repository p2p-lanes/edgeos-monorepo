import { describe, expect, it } from "vitest"

import {
  buildPreviewStylesheetUrl,
  isValidFontFamily,
  toCssFontFamily,
} from "./google-font"

// This module intentionally mirrors portal/src/lib/google-font.ts. The two
// have to agree on which family names are safe — the backoffice writes the
// value and the portal renders it — so the validation cases are kept in sync.

describe("isValidFontFamily", () => {
  it.each([
    "Inter",
    "Playfair Display",
    "Noto Sans JP",
    "IBM Plex Mono",
  ])("accepts the real family %s", (family) => {
    expect(isValidFontFamily(family)).toBe(true)
  })

  it.each<[string, string]>([
    ["", "empty"],
    ["   ", "blank"],
    ["Inter;color:red", "css injection via semicolon"],
    ['Inter", url(https://evil.test/x.css), "', "quote break-out"],
    ["Inter&family=Evil", "url parameter injection"],
    ["a".repeat(60), "over the length cap"],
  ])("rejects %j (%s)", (value) => {
    expect(isValidFontFamily(value)).toBe(false)
  })
})

describe("buildPreviewStylesheetUrl", () => {
  it("batches a screenful of families into one request", () => {
    const url = buildPreviewStylesheetUrl(["Inter", "Lato", "Playfair Display"])

    expect(url?.match(/family=/g)).toHaveLength(3)
    expect(url).toContain("family=Playfair+Display:wght@400")
  })

  it("asks for weight 400 only", () => {
    // The picker shows one line per family; four weights per row would
    // multiply the download for nothing visible.
    const url = buildPreviewStylesheetUrl(["Inter"])

    expect(url).toContain("wght@400")
    expect(url).not.toContain("700")
  })

  it("deduplicates repeated families", () => {
    const url = buildPreviewStylesheetUrl(["Inter", "Inter", "Inter"])

    expect(url?.match(/family=/g)).toHaveLength(1)
  })

  it("drops unsafe families instead of failing the batch", () => {
    const url = buildPreviewStylesheetUrl(["Inter", "Evil;}"])

    expect(url).toContain("family=Inter:")
    expect(url).not.toContain("Evil")
  })

  it("returns null when nothing survives validation", () => {
    expect(buildPreviewStylesheetUrl(["", "bad;value"])).toBeNull()
  })
})

describe("toCssFontFamily", () => {
  it("quotes the family and appends a fallback stack", () => {
    expect(toCssFontFamily("Playfair Display")).toBe(
      '"Playfair Display", system-ui, sans-serif',
    )
  })

  it("returns null rather than emitting an unsafe declaration", () => {
    expect(toCssFontFamily('Inter"; background: url(evil)')).toBeNull()
  })
})
