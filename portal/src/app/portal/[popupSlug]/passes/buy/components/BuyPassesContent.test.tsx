import { render, screen } from "@testing-library/react"
import type { ReactNode } from "react"
import { describe, expect, it, vi } from "vitest"

const passesProviderProps = vi.hoisted(() => vi.fn())
const state = vi.hoisted(() => ({
  attendees: [] as { id: string; products: never[] }[],
  loading: false,
  accepted: true,
}))
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock("@/hooks/useResolvedAttendees", () => ({
  default: () => state.attendees,
}))
vi.mock("@/hooks/useGetApplications", () => ({
  useApplicationsQuery: () => ({ isLoading: state.loading }),
}))
vi.mock("@/hooks/useHumanAttendeesQuery", () => ({
  default: () => ({ isLoading: false }),
}))
vi.mock("@/hooks/useHumanPopupAccess", () => ({
  useHumanPopupAccess: () => ({ state: "allowed" }),
}))
vi.mock("@/providers/applicationProvider", () => ({
  useApplication: () => ({
    getRelevantApplication: (id: string) =>
      id === "flow-application" && state.accepted
        ? { status: "accepted" }
        : null,
  }),
}))

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
  it("does not wait for a non-empty outer attendee or products list", () => {
    render(
      <ApplicationPassesCheckout
        flowId="flow-application"
        flowSlug="application"
      />,
    )
    expect(screen.getByText("checkout")).toBeTruthy()
  })
  it("starts the flow-scoped provider while the application is loading", () => {
    state.loading = true
    render(
      <ApplicationPassesCheckout
        flowId="flow-application"
        flowSlug="application"
      />,
    )
    expect(passesProviderProps).toHaveBeenCalledWith(
      expect.objectContaining({ salesFlowId: "flow-application" }),
    )
    expect(screen.queryByText("checkout")).toBeNull()
    state.loading = false
  })
  it("does not use another accepted application for a named flow", () => {
    render(<ApplicationPassesCheckout flowId="unknown" flowSlug="unknown" />)
    expect(screen.queryByText("checkout")).toBeNull()
    expect(screen.getByText("shop.approval_required_title")).toBeTruthy()
  })
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
