import { describe, expect, it } from "vitest"

import {
  buildGoogleFontsUrl,
  isValidFontFamily,
  toCssFontFamily,
} from "./google-font"

describe("isValidFontFamily", () => {
  it.each([
    "Inter",
    "Playfair Display",
    "Noto Sans JP",
    "Roboto Slab",
    "IBM Plex Mono",
  ])("accepts the real family %s", (family) => {
    expect(isValidFontFamily(family)).toBe(true)
  })

  it("tolerates surrounding whitespace", () => {
    expect(isValidFontFamily("  Inter  ")).toBe(true)
  })

  it.each<[string, string]>([
    ["", "empty"],
    ["   ", "blank"],
    ["Inter;color:red", "css injection via semicolon"],
    ['Inter", url(https://evil.test/x.css), "', "quote break-out"],
    ["Inter&family=Evil", "url parameter injection"],
    ["Inter\\", "backslash escape"],
    ["Inter/*", "comment open"],
    ["Inter()", "function call"],
    ["a".repeat(60), "over the length cap"],
  ])("rejects %j (%s)", (value) => {
    expect(isValidFontFamily(value)).toBe(false)
  })

  it.each([
    null,
    undefined,
    42,
    {},
    ["Inter"],
  ])("rejects the non-string %j", (value) => {
    expect(isValidFontFamily(value)).toBe(false)
  })
})

describe("buildGoogleFontsUrl", () => {
  it("encodes spaces as + and keeps the weight axis unescaped", () => {
    const url = buildGoogleFontsUrl(["Playfair Display"])

    expect(url).toBe(
      "https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500;600;700&display=swap",
    )
  })

  it("puts both families in a single request", () => {
    const url = buildGoogleFontsUrl(["Inter", "Playfair Display"])

    expect(url).toContain("family=Inter:")
    expect(url).toContain("family=Playfair+Display:")
    expect(url?.match(/family=/g)).toHaveLength(2)
  })

  it("asks for a shared family only once", () => {
    const url = buildGoogleFontsUrl(["Inter", "Inter"])

    expect(url?.match(/family=/g)).toHaveLength(1)
  })

  it("skips invalid families instead of failing the whole request", () => {
    const url = buildGoogleFontsUrl(["Inter", "Evil;}"])

    expect(url).toContain("family=Inter:")
    expect(url).not.toContain("Evil")
  })

  it("returns null when nothing is usable", () => {
    expect(buildGoogleFontsUrl([undefined, "", "bad;value"])).toBeNull()
  })

  it("ends in display=swap so text renders before the webfont arrives", () => {
    expect(buildGoogleFontsUrl(["Inter"])).toContain("&display=swap")
  })
})

describe("toCssFontFamily", () => {
  it("quotes the family and appends a fallback stack", () => {
    expect(toCssFontFamily("Playfair Display")).toBe(
      '"Playfair Display", system-ui, sans-serif',
    )
  })

  it("collapses internal whitespace so the quoted name matches the URL", () => {
    expect(toCssFontFamily("  Playfair   Display ")).toBe(
      '"Playfair Display", system-ui, sans-serif',
    )
  })

  it("returns null rather than emitting an unsafe declaration", () => {
    expect(toCssFontFamily('Inter"; background: url(evil)')).toBeNull()
  })
})
