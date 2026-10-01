import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({
    data: {
      id: "link-1",
      popup_id: "popup-b",
      sales_flow_id: "volunteer-flow",
      discount_percentage: "0",
      auto_approve: true,
    },
    isLoading: false,
    error: null,
  }),
}))
vi.mock("next/navigation", () => ({
  useParams: () => ({ code: "shared-code" }),
}))
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock("@/providers/cityProvider", () => ({
  useCityProvider: () => ({
    getPopups: () => [{ id: "popup-b" }],
    popupsLoaded: true,
    setCityPreselected: vi.fn(),
  }),
}))
vi.mock("@/providers/discountProvider", () => ({
  useDiscount: () => ({
    discountApplied: { city_id: "popup-b", discount_value: 0 },
    setDiscount: vi.fn(),
  }),
}))
vi.mock("@/lib/background-image", () => ({
  getCheckoutBackground: () => ({ type: "none" }),
}))
vi.mock("@/app/checkout/components/PopupCheckoutContent", () => ({
  PopupCheckoutContent: ({ salesFlowId }: { salesFlowId?: string | null }) => (
    <div data-testid="checkout" data-flow={salesFlowId} />
  ),
}))
vi.mock("@/client", () => ({
  ApiError: class ApiError extends Error {},
  InvitesService: { previewLink: vi.fn() },
}))

import ReferralCodePage from "./page"

describe("referral checkout", () => {
  it("opens the sales flow recorded on the link, not the popup default", () => {
    render(<ReferralCodePage />)
    expect(screen.getByTestId("checkout").getAttribute("data-flow")).toBe(
      "volunteer-flow",
    )
  })
})
