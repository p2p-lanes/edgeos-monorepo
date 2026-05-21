import { render, screen } from "@testing-library/react"
import OpenCheckoutThankYouPage from "./page"

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockPush = vi.fn()
const mockUseTenant = vi.fn()

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  useParams: () => ({ popupSlug: "summer-fest" }),
}))

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock("@/providers/tenantProvider", () => ({
  useTenant: () => mockUseTenant(),
}))

vi.mock("../hooks/useCheckoutRuntime", () => ({
  useCheckoutRuntime: () => ({ data: undefined }),
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const checkoutModeTenant = {
  tenant: {
    id: "t-1",
    name: "Festival Corp",
    slug: "festival",
    custom_domain_active: true,
    landing_mode: "checkout" as const,
    active_popup_slug: "summer-fest",
    logo_url: null,
    image_url: null,
    icon_url: null,
  },
  isLoading: false,
  error: null,
}

const portalModeTenant = {
  tenant: {
    id: "t-1",
    name: "Festival Corp",
    slug: "festival",
    custom_domain_active: true,
    landing_mode: "portal" as const,
    active_popup_slug: null,
    logo_url: null,
    image_url: null,
    icon_url: null,
  },
  isLoading: false,
  error: null,
}

// ---------------------------------------------------------------------------
// Scenario TY-1: CTA hidden in checkout mode
// ---------------------------------------------------------------------------

describe("OpenCheckoutThankYouPage", () => {
  beforeEach(() => {
    mockPush.mockReset()
  })

  it("TY-1: back-to-portal CTA is not rendered in checkout mode", () => {
    mockUseTenant.mockReturnValue(checkoutModeTenant)

    render(<OpenCheckoutThankYouPage />)

    // The CTA button must not be in the DOM
    const cta = screen.queryByText("openCheckout.thank_you_cta")
    expect(cta).toBeNull()
  })

  // Scenario TY-2: CTA visible in portal mode
  it("TY-2: back-to-portal CTA is rendered and functional in portal mode", () => {
    mockUseTenant.mockReturnValue(portalModeTenant)

    render(<OpenCheckoutThankYouPage />)

    const cta = screen.getByText("openCheckout.thank_you_cta")
    expect(cta).toBeTruthy()
  })

  // Scenario TY-3: No broken layout when CTA hidden
  it("TY-3: page renders without broken layout when CTA is hidden", () => {
    mockUseTenant.mockReturnValue(checkoutModeTenant)

    const { container } = render(<OpenCheckoutThankYouPage />)

    // The success icon and thank-you text must still be present
    expect(screen.getByText("openCheckout.thank_you_title")).toBeTruthy()
    expect(screen.getByText("openCheckout.thank_you_description")).toBeTruthy()

    // No empty button placeholder artifact (no buttons at all)
    const buttons = container.querySelectorAll("button")
    expect(buttons.length).toBe(0)
  })

  it("TY-3: page has correct content in portal mode with CTA visible", () => {
    mockUseTenant.mockReturnValue(portalModeTenant)

    render(<OpenCheckoutThankYouPage />)

    expect(screen.getByText("openCheckout.thank_you_title")).toBeTruthy()
    expect(screen.getByText("openCheckout.thank_you_description")).toBeTruthy()
    expect(screen.getByText("openCheckout.thank_you_cta")).toBeTruthy()
  })
})
