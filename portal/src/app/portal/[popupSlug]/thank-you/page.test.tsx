import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import PortalThankYouPage from "./page"

const mockPush = vi.fn()
const mockUseCheckoutRuntime = vi.fn()
let mockSearchParams = new URLSearchParams()

vi.mock("next/navigation", () => ({
  useParams: () => ({ popupSlug: "summer-camp" }),
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => mockSearchParams,
}))

vi.mock("@/providers/tenantProvider", () => ({
  useTenant: () => ({ tenant: { landing_mode: "portal" } }),
}))

vi.mock("@/app/checkout/[popupSlug]/hooks/useCheckoutRuntime", () => ({
  useCheckoutRuntime: (...args: unknown[]) => mockUseCheckoutRuntime(...args),
}))

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        "portalThankYou.title": "Purchase completed",
        "portalThankYou.description":
          "Your purchase is complete. Your passes are ready in the portal.",
        "portalThankYou.passes_cta": "View my passes",
      })[key] ?? key,
  }),
}))

describe("PortalThankYouPage", () => {
  beforeEach(() => {
    mockPush.mockReset()
    mockSearchParams = new URLSearchParams()
    mockUseCheckoutRuntime.mockReset()
    mockUseCheckoutRuntime.mockReturnValue({ data: undefined })
  })

  it("confirms completion and links to the popup passes", () => {
    render(<PortalThankYouPage />)

    expect(
      screen.getByRole("heading", { name: "Purchase completed" }),
    ).toBeTruthy()
    expect(
      screen.getByText(
        "Your purchase is complete. Your passes are ready in the portal.",
      ),
    ).toBeTruthy()
    screen.getByRole("button", { name: /View my passes/ }).click()
    expect(mockPush).toHaveBeenCalledWith("/portal/summer-camp/passes")
    expect(mockUseCheckoutRuntime).toHaveBeenCalledWith("summer-camp", {
      flowSlug: "checkout",
    })
  })

  it("renders flow-owned config and the backend order item shape", () => {
    mockSearchParams = new URLSearchParams({ flow: "experiences" })
    mockSearchParams.set(
      "data",
      btoa(
        JSON.stringify({
          first_name: "Taylor",
          amount_total: "270.00",
          currency: "USD",
          items: [{ title: "Bay Networking Cruise", qty: 2, price: 135 }],
        }),
      ),
    )
    mockUseCheckoutRuntime.mockReturnValue({
      data: {
        popup: {},
        theme_config: {
          thank_you: {
            title: "Welcome, {first_name}",
            description: "Your experience is confirmed.",
            show_order_summary: true,
            cta: { label: "View your passes" },
          },
        },
      },
    })

    render(<PortalThankYouPage />)

    expect(mockUseCheckoutRuntime).toHaveBeenCalledWith("summer-camp", {
      flowSlug: "experiences",
    })
    expect(screen.getByText("Welcome, Taylor")).toBeTruthy()
    expect(screen.getByText("Bay Networking Cruise")).toBeTruthy()
    expect(screen.getByText("×2")).toBeTruthy()
    expect(screen.getByText("270.00 USD")).toBeTruthy()
    screen.getByRole("button", { name: /View your passes/ }).click()
    expect(mockPush).toHaveBeenCalledWith("/portal/summer-camp/passes")
  })

  it("normalizes legacy order item names and quantities", () => {
    mockSearchParams.set(
      "data",
      btoa(
        JSON.stringify({
          items: [{ name: "Legacy pass", quantity: 3 }],
        }),
      ),
    )
    mockUseCheckoutRuntime.mockReturnValue({
      data: {
        popup: {},
        theme_config: { thank_you: { show_order_summary: true } },
      },
    })

    render(<PortalThankYouPage />)

    expect(screen.getByText("Legacy pass")).toBeTruthy()
    expect(screen.getByText("×3")).toBeTruthy()
  })
})
