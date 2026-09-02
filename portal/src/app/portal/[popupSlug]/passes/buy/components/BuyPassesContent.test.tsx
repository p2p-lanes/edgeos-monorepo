import { render } from "@testing-library/react"
import type { ReactNode } from "react"
import { describe, expect, it, vi } from "vitest"

const passesProviderProps = vi.hoisted(() => vi.fn())

vi.mock("next/navigation", () => ({
  useParams: () => ({ popupSlug: "festival-2026" }),
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock("@/providers/passesProvider", () => ({
  default: ({ children, ...props }: { children: ReactNode }) => {
    passesProviderProps(props)
    return children
  },
  usePassesProvider: () => ({
    attendeePasses: [{ id: "attendee-1", products: [] }],
    products: [{ id: "ticket-1" }],
  }),
}))
vi.mock("@/providers/checkoutProvider", () => ({
  CheckoutProvider: ({ children }: { children: ReactNode }) => children,
}))
vi.mock("@/providers/cityProvider", () => ({
  useCityProvider: () => ({
    getCity: () => ({ id: "popup-1", slug: "festival-2026" }),
  }),
}))
vi.mock("@/hooks/useRequireDoor", () => ({ useRequireDoor: () => false }))
vi.mock("@/hooks/usePortalSalesFlows", () => ({
  usePortalSalesFlows: () => ({ data: [], isLoading: false }),
}))
vi.mock("@/hooks/usePortalDirectSalesFlows", () => ({
  usePortalDirectSalesFlows: () => ({ data: [], isLoading: false }),
}))
vi.mock("@/hooks/usePortalUpsaleFlows", () => ({
  usePortalUpsaleFlows: () => ({ data: [], isLoading: false }),
}))
vi.mock("@/lib/background-image", () => ({
  getCheckoutBackground: () => ({ type: "none" }),
}))
vi.mock("@/components/checkout-flow/ScrollyCheckoutFlow", () => ({
  default: () => <div>checkout</div>,
}))
vi.mock("@/components/CheckoutBackgroundImage", () => ({
  CheckoutBackgroundImage: () => null,
}))
vi.mock("@/components/CheckoutBackgroundVideo", () => ({
  CheckoutBackgroundVideo: () => null,
}))

import { ApplicationPassesCheckout } from "./BuyPassesContent"

describe("ApplicationPassesCheckout", () => {
  it("loads passes and cart state from the selected flow", () => {
    render(
      <ApplicationPassesCheckout
        flowId="flow-application"
        flowSlug="application"
      />,
    )

    expect(passesProviderProps).toHaveBeenCalledWith(
      expect.objectContaining({
        restoreFromCart: true,
        flowType: "application",
        salesFlowId: "flow-application",
      }),
    )
  })
})
