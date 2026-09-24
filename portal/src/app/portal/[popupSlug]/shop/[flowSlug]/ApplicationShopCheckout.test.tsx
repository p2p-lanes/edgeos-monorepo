import { fireEvent, render, screen } from "@testing-library/react"
import { createContext, type ReactNode, useContext } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const passesProviderProps = vi.hoisted(() => vi.fn())
const useResolvedAttendees = vi.hoisted(() => vi.fn())
const push = vi.hoisted(() => vi.fn())
const replace = vi.hoisted(() => vi.fn())
const productState = vi.hoisted(() => ({ available: true, loading: false }))

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace }),
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock("@/hooks/useResolvedAttendees", () => ({
  default: useResolvedAttendees,
}))

const PassesContext = createContext({
  attendeePasses: [] as Array<{ id: string; products: unknown[] }>,
  products: [] as Array<{ id: string }>,
  productsLoading: false,
})

vi.mock("@/providers/passesProvider", () => ({
  default: ({
    attendees,
    children,
    ...props
  }: {
    attendees: Array<{ id: string }>
    children: ReactNode
    flowType: string
    restoreFromCart: boolean
    salesFlowId: string
  }) => {
    passesProviderProps({ attendees, ...props })
    return (
      <PassesContext.Provider
        value={{
          attendeePasses: attendees.map((attendee) => ({
            ...attendee,
            products: [{ id: `ticket-${props.salesFlowId}` }],
          })),
          products: productState.available
            ? [{ id: `ticket-${props.salesFlowId}` }]
            : [],
          productsLoading: productState.loading,
        }}
      >
        {children}
      </PassesContext.Provider>
    )
  },
  usePassesProvider: () => useContext(PassesContext),
}))
vi.mock("@/providers/checkoutProvider", () => ({
  CheckoutProvider: ({
    children,
    returnContext,
  }: {
    children: ReactNode
    returnContext?: string
  }) => <div data-return-context={returnContext}>{children}</div>,
}))
vi.mock("@/providers/cityProvider", () => ({
  CityContext: createContext(null),
  useCityProvider: () => ({
    getCity: () => ({ id: "popup-1", slug: "festival-2026" }),
  }),
}))
vi.mock("@/hooks/useGatheringDoors", () => ({
  useGatheringDoors: () => ({
    doors: [
      { flowId: "flow-application", slug: "application" },
      { flowId: "flow-volunteer", slug: "volunteer" },
    ],
    isLoading: false,
  }),
}))
vi.mock("@/lib/background-image", () => ({
  getCheckoutBackground: () => ({ type: "none" }),
}))
vi.mock("@/components/checkout-flow/ScrollyCheckoutFlow", () => ({
  default: ({ onBack }: { onBack: () => void }) => (
    <div>
      checkout
      <button type="button" onClick={onBack}>
        Back
      </button>
    </div>
  ),
}))
vi.mock("@/components/CheckoutBackgroundImage", () => ({
  CheckoutBackgroundImage: () => null,
}))
vi.mock("@/components/CheckoutBackgroundVideo", () => ({
  CheckoutBackgroundVideo: () => null,
}))

import { ApplicationShopCheckout } from "./ApplicationShopCheckout"

describe("ApplicationShopCheckout", () => {
  beforeEach(() => {
    passesProviderProps.mockClear()
    useResolvedAttendees.mockReset()
    push.mockClear()
    replace.mockClear()
    productState.available = true
    productState.loading = false
  })

  it("shows an empty state instead of an endless spinner when the flow has no products", () => {
    useResolvedAttendees.mockReturnValue([{ id: "human-1", products: [] }])
    productState.available = false
    const { rerender } = render(
      <ApplicationShopCheckout
        flowId="flow-attendee"
        flowSlug="attendee"
        popupSlug="festival-2026"
      />,
    )
    expect(screen.getByText("shop.no_products_title")).toBeTruthy()
    expect(
      screen
        .getByRole("link", { name: "shop.back_to_passes" })
        .getAttribute("href"),
    ).toBe("/portal/festival-2026/passes?flow=attendee")

    productState.loading = true
    rerender(
      <ApplicationShopCheckout
        flowId="flow-attendee"
        flowSlug="attendee"
        popupSlug="festival-2026"
      />,
    )
    expect(screen.queryByText("shop.no_products_title")).toBeNull()
  })

  it.each([
    ["flow-attendee", "attendee", "application-attendee"],
    ["flow-volunteers", "volunteers", "application-volunteers"],
  ])("renders the %s checkout with its flow-scoped virtual attendee", (flowId, flowSlug, applicationId) => {
    useResolvedAttendees.mockImplementation((selectedFlowId: string) => [
      {
        id: "human-1",
        application_id:
          selectedFlowId === "flow-attendee"
            ? "application-attendee"
            : "application-volunteers",
        products: [],
      },
    ])

    render(
      <ApplicationShopCheckout
        flowId={flowId}
        flowSlug={flowSlug}
        popupSlug="festival-2026"
        returnContext="direct"
        themeConfig={{
          colors: {
            mode: "light",
            card_background_color: "#FFFFFF",
            card_foreground_color: "#0F172A",
            border_color: "#8A94A2",
            input_color: "#828C99",
          },
        }}
      />,
    )

    expect(useResolvedAttendees).toHaveBeenCalledWith(flowId)
    expect(passesProviderProps.mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({
        attendees: [expect.objectContaining({ application_id: applicationId })],
        flowType: "application",
        restoreFromCart: true,
        salesFlowId: flowId,
      }),
    )
    expect(screen.getByText("checkout")).toBeTruthy()
    expect(
      screen
        .getByText("checkout")
        .closest("[data-return-context]")
        ?.getAttribute("data-return-context"),
    ).toBe("direct")
    const themeScope = screen
      .getByText("checkout")
      .closest<HTMLElement>(".text-foreground")
    expect(themeScope?.style.getPropertyValue("--step-card-bg")).toBe("#FFFFFF")
    expect(themeScope?.style.getPropertyValue("--step-card-fg")).toBe("#0F172A")
    const controlBoundary = screen.getByText("checkout").parentElement
    expect(controlBoundary?.style.getPropertyValue("--border")).toBe("#8A94A2")
    expect(controlBoundary?.style.getPropertyValue("--input")).toBe("#828C99")
    expect(replace).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole("button", { name: "Back" }))
    expect(push).toHaveBeenCalledWith(
      `/portal/festival-2026/passes?flow=${flowSlug}`,
    )
  })
})
