import { render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import ThemeProvider, { type ThemeConfig } from "./themeProvider"

const portalBackground = "rgb(245 245 245)"
const darkConfig: ThemeConfig = {
  colors: { mode: "dark", primary_color: "#112233" },
}

beforeEach(() => {
  document.head.innerHTML = ""
  document.body.style.fontFamily = ""
  document.documentElement.style.cssText = ""
})

afterEach(() => {
  document.head.innerHTML = ""
  document.documentElement.style.cssText = ""
})

function renderLocalTheme(config: ThemeConfig, label: string) {
  render(
    <ThemeProvider config={config} scope="local">
      <span>{label}</span>
    </ThemeProvider>,
  )
  return screen.getByText(label).parentElement
}

describe("ThemeProvider", () => {
  it("applies a gathering palette to the document by default", () => {
    render(
      <ThemeProvider config={darkConfig}>
        <span>Gathering page</span>
      </ThemeProvider>,
    )

    expect(
      document.documentElement.style.getPropertyValue("--background"),
    ).toBe("oklch(0.145 0 0)")
  })

  it("keeps a flow palette on its checkout subtree", () => {
    document.documentElement.style.setProperty("--background", portalBackground)
    const checkoutScope = renderLocalTheme(darkConfig, "Dark checkout")

    expect(checkoutScope?.style.getPropertyValue("--background")).toBe(
      "oklch(0.145 0 0)",
    )
    expect(
      document.documentElement.style.getPropertyValue("--background"),
    ).toBe(portalBackground)
  })

  it("loads configured Google fonts without leaking local flow fonts to the document", () => {
    const checkoutScope = renderLocalTheme(
      {
        typography: {
          font_family: "Inter",
          font_heading_family: "Playfair Display",
        },
      },
      "Branded checkout",
    )

    expect(checkoutScope?.style.getPropertyValue("--theme-font-family")).toBe(
      '"Inter", system-ui, sans-serif',
    )
    expect(document.body.style.fontFamily).toBe("")
    expect(
      document.head.querySelectorAll('link[href*="fonts.googleapis.com/css2"]'),
    ).toHaveLength(1)
  })

  it("applies a document font and restores it on unmount", () => {
    const { unmount } = render(
      <ThemeProvider config={{ typography: { font_family: "Inter" } }}>
        <span>Document font</span>
      </ThemeProvider>,
    )

    expect(document.body.style.fontFamily).toBe(
      '"Inter", system-ui, sans-serif',
    )
    unmount()
    expect(document.body.style.fontFamily).toBe("")
  })
})
