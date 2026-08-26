import { render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import ThemeProvider, { type ThemeConfig } from "./themeProvider"

const portalBackground = "rgb(245 245 245)"
const darkConfig: ThemeConfig = {
  colors: { mode: "dark", primary_color: "#112233" },
}

afterEach(() => document.documentElement.removeAttribute("style"))

function renderLocalTheme(config: ThemeConfig, label: string) {
  render(
    <ThemeProvider config={config} scope="local">
      <span>{label}</span>
    </ThemeProvider>,
  )
  return screen.getByText(label).parentElement
}

describe("ThemeProvider local scope", () => {
  it("continues to apply a gathering palette to the document by default", () => {
    render(
      <ThemeProvider config={darkConfig}>
        <span>Gathering page</span>
      </ThemeProvider>,
    )

    expect(
      document.documentElement.style.getPropertyValue("--background"),
    ).toBe("oklch(0.145 0 0)")
    expect(document.documentElement.style.getPropertyValue("--primary")).toBe(
      "#112233",
    )
  })

  it("keeps a dark flow palette on its checkout subtree instead of the document", () => {
    document.documentElement.style.setProperty("--background", portalBackground)
    const checkoutScope = renderLocalTheme(darkConfig, "Dark checkout")
    expect(checkoutScope?.style.getPropertyValue("--background")).toBe(
      "oklch(0.145 0 0)",
    )
    expect(checkoutScope?.style.getPropertyValue("--primary")).toBe("#112233")
    expect(
      document.documentElement.style.getPropertyValue("--background"),
    ).toBe(portalBackground)
  })

  it("keeps checkout-only overrides local when the flow has no palette", () => {
    document.documentElement.style.setProperty(
      "--checkout-nav-bg",
      portalBackground,
    )
    const config: ThemeConfig = {
      colors: {
        checkout_navbar_bg: "#445566",
      },
    }

    const checkoutScope = renderLocalTheme(config, "Configured checkout")
    expect(checkoutScope?.style.getPropertyValue("--checkout-nav-bg")).toBe(
      "#445566",
    )
    expect(
      document.documentElement.style.getPropertyValue("--checkout-nav-bg"),
    ).toBe(portalBackground)
  })
})
