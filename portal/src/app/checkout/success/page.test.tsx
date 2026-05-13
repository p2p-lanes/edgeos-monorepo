import { render, screen } from "@testing-library/react"
import CheckoutSuccessPage from "./page"

const mockPush = vi.fn()
const mockUseTenant = vi.fn()

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}))

vi.mock("@/providers/tenantProvider", () => ({
  useTenant: () => mockUseTenant(),
}))

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
  ...checkoutModeTenant,
  tenant: {
    ...checkoutModeTenant.tenant,
    landing_mode: "portal" as const,
    active_popup_slug: null,
  },
}

describe("CheckoutSuccessPage", () => {
  beforeEach(() => {
    mockPush.mockReset()
  })

  it("hides the Go to portal CTA in checkout mode", () => {
    mockUseTenant.mockReturnValue(checkoutModeTenant)

    render(<CheckoutSuccessPage />)

    expect(screen.queryByText("Go to portal")).toBeNull()
  })

  it("renders the Go to portal CTA in portal mode", () => {
    mockUseTenant.mockReturnValue(portalModeTenant)

    render(<CheckoutSuccessPage />)

    expect(screen.getByText("Go to portal")).toBeTruthy()
  })
})
