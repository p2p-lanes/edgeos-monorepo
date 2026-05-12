import { render, screen } from "@testing-library/react"
import ComingSoonPage from "./page"

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockUseTenant = vi.fn()

vi.mock("@/providers/tenantProvider", () => ({
  useTenant: () => mockUseTenant(),
}))

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

// ---------------------------------------------------------------------------
// Scenario CS-1: Branded rendering
// ---------------------------------------------------------------------------

describe("ComingSoonPage", () => {
  it("CS-1: renders tenant logo when logo_url is present", () => {
    mockUseTenant.mockReturnValue({
      tenant: {
        id: "t-1",
        name: "Festival Corp",
        slug: "festival",
        custom_domain_active: true,
        landing_mode: "checkout",
        logo_url: "https://cdn.example.com/logo.png",
        image_url: null,
        icon_url: null,
        active_popup_slug: null,
      },
      isLoading: false,
      error: null,
    })

    render(<ComingSoonPage />)

    // Logo should be rendered (next/image wraps the src in /_next/image?url=...)
    const logo = screen.getByRole("img", { name: /festival corp|logo/i })
    expect(logo).toBeTruthy()
    // Check original URL is present (encoded) in the optimized src
    const src = (logo as HTMLImageElement).src
    expect(src).toMatch(/cdn\.example\.com.*logo\.png/)
  })

  it("CS-1: renders Coming Soon heading", () => {
    mockUseTenant.mockReturnValue({
      tenant: {
        id: "t-1",
        name: "Festival Corp",
        slug: "festival",
        custom_domain_active: true,
        landing_mode: "checkout",
        logo_url: null,
        image_url: null,
        icon_url: null,
        active_popup_slug: null,
      },
      isLoading: false,
      error: null,
    })

    render(<ComingSoonPage />)

    expect(screen.getByText("comingSoon.title")).toBeTruthy()
  })

  // CS-2: No popup dependency — useCityProvider must NOT be imported/called
  it("CS-2: renders without error when no popup context exists (no useCityProvider)", () => {
    mockUseTenant.mockReturnValue({
      tenant: {
        id: "t-1",
        name: "Festival Corp",
        slug: "festival",
        custom_domain_active: true,
        landing_mode: "checkout",
        logo_url: null,
        image_url: null,
        icon_url: null,
        active_popup_slug: null,
      },
      isLoading: false,
      error: null,
    })

    // If useCityProvider is imported and called in this page, it will throw
    // because there is no CityProvider wrapper in this test.
    expect(() => render(<ComingSoonPage />)).not.toThrow()
  })

  it("CS-4: renders no links to checkout or popup-specific paths", () => {
    mockUseTenant.mockReturnValue({
      tenant: {
        id: "t-1",
        name: "Festival Corp",
        slug: "festival",
        custom_domain_active: true,
        landing_mode: "checkout",
        logo_url: null,
        image_url: null,
        icon_url: null,
        active_popup_slug: null,
      },
      isLoading: false,
      error: null,
    })

    const { container } = render(<ComingSoonPage />)

    // No links to /checkout/* or /portal/* paths
    const links = container.querySelectorAll("a[href]")
    for (const link of links) {
      const href = link.getAttribute("href") ?? ""
      expect(href).not.toMatch(/^\/checkout/)
      expect(href).not.toMatch(/^\/portal/)
    }
  })
})
