/**
 * Font side of the theme provider: what it injects into <head>, what it writes
 * onto <body>, and what it must NOT do to a checkout skin's typography.
 */
import { render } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import ThemeProvider from "./themeProvider"

const mockCity = vi.fn()

vi.mock("./cityProvider", () => ({
  useCityProvider: () => ({ getCity: mockCity }),
}))

type Typography = {
  font_family?: string
  font_heading_family?: string
  font_base_size?: string
}

function renderWithTypography(typography: Typography | undefined) {
  mockCity.mockReturnValue(
    typography ? { theme_config: { typography } } : { theme_config: null },
  )
  return render(
    <ThemeProvider>
      <h1>Heading</h1>
    </ThemeProvider>,
  )
}

const stylesheet = () =>
  document.head.querySelector<HTMLLinkElement>(
    'link[rel="stylesheet"][href*="fonts.googleapis.com"]',
  )

beforeEach(() => {
  document.head.innerHTML = ""
  document.body.style.fontFamily = ""
  document.documentElement.style.cssText = ""
  mockCity.mockReset()
})

afterEach(() => {
  document.head.innerHTML = ""
})

describe("google font loading", () => {
  it("injects one stylesheet covering both families", () => {
    renderWithTypography({
      font_family: "Inter",
      font_heading_family: "Playfair Display",
    })

    const href = stylesheet()?.href ?? ""
    expect(href).toContain("family=Inter:")
    expect(href).toContain("family=Playfair+Display:")
    expect(
      document.head.querySelectorAll('link[href*="fonts.googleapis.com/css2"]'),
    ).toHaveLength(1)
  })

  it("preconnects to both font origins", () => {
    renderWithTypography({ font_family: "Inter" })

    const origins = Array.from(
      document.head.querySelectorAll<HTMLLinkElement>('link[rel="preconnect"]'),
    ).map((link) => link.href)

    expect(origins.some((o) => o.includes("fonts.googleapis.com"))).toBe(true)
    expect(origins.some((o) => o.includes("fonts.gstatic.com"))).toBe(true)
  })

  it("marks the gstatic preconnect as CORS", () => {
    renderWithTypography({ font_family: "Inter" })

    const gstatic = document.head.querySelector<HTMLLinkElement>(
      'link[rel="preconnect"][href*="gstatic"]',
    )

    expect(gstatic?.crossOrigin).toBe("anonymous")
  })

  it("injects nothing when no font is configured", () => {
    renderWithTypography({ font_base_size: "18px" })

    expect(stylesheet()).toBeNull()
  })

  it("injects nothing for a family that fails validation", () => {
    renderWithTypography({ font_family: "Inter; background: url(evil)" })

    expect(stylesheet()).toBeNull()
  })

  it("removes the stylesheet and preconnects on unmount", () => {
    const { unmount } = renderWithTypography({ font_family: "Inter" })
    expect(stylesheet()).not.toBeNull()

    unmount()

    expect(stylesheet()).toBeNull()
    expect(
      document.head.querySelectorAll('link[rel="preconnect"]'),
    ).toHaveLength(0)
  })
})

describe("body font application", () => {
  it("sets font-family on <body>, not just the --font-sans variable", () => {
    // layout.tsx puts GeistSans.className on <body>, which declares
    // font-family by class and beats the Tailwind variable — so setting only
    // the variable would silently do nothing.
    renderWithTypography({ font_family: "Inter" })

    expect(document.body.style.fontFamily).toBe(
      '"Inter", system-ui, sans-serif',
    )
    expect(document.documentElement.style.getPropertyValue("--font-sans")).toBe(
      '"Inter", system-ui, sans-serif',
    )
  })

  it("exposes the heading family as its own variable", () => {
    renderWithTypography({
      font_family: "Inter",
      font_heading_family: "Playfair Display",
    })

    expect(
      document.documentElement.style.getPropertyValue(
        "--theme-font-heading-family",
      ),
    ).toBe('"Playfair Display", system-ui, sans-serif')
  })

  it("restores the previous body font on unmount", () => {
    const { unmount } = renderWithTypography({ font_family: "Inter" })

    unmount()

    expect(document.body.style.fontFamily).toBe("")
  })

  it("never applies the font with !important", () => {
    // An !important body font would override every checkout skin's own
    // typography, which is exactly the regression this feature must not cause.
    renderWithTypography({ font_family: "Inter" })

    expect(document.body.style.getPropertyPriority("font-family")).toBe("")
    expect(
      document.documentElement.style.getPropertyPriority("--font-sans"),
    ).toBe("")
  })
})
