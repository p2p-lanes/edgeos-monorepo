import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { LanguageSwitcher } from "./LanguageSwitcher"

vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectContent: ({
    children,
    style,
  }: {
    children: React.ReactNode
    style?: React.CSSProperties
  }) => (
    <div data-testid="language-menu" style={style}>
      {children}
    </div>
  ),
  SelectItem: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectTrigger: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  SelectValue: () => <span>English</span>,
}))

vi.mock("@/providers/languageProvider", () => ({
  useLanguage: () => ({
    currentLanguage: "en",
    supportedLanguages: ["en", "es"],
    setLanguage: vi.fn(),
  }),
}))

describe("LanguageSwitcher flow theme", () => {
  it("applies the checkout scope style to its portaled menu", () => {
    render(
      <LanguageSwitcher
        portalContentStyle={
          { "--background": "#112233" } as React.CSSProperties
        }
      />,
    )

    expect(
      screen
        .getByTestId("language-menu")
        .style.getPropertyValue("--background"),
    ).toBe("#112233")
  })

  it("does not invent a flow theme when no checkout scope is provided", () => {
    render(<LanguageSwitcher />)

    expect(
      screen
        .getByTestId("language-menu")
        .style.getPropertyValue("--background"),
    ).toBe("")
  })
})
