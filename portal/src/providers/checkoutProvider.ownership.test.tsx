import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { checkoutRuntimeOptions } from "@/app/checkout/[popupSlug]/hooks/useCheckoutRuntime"
import { ShopCheckoutContent } from "@/app/portal/[popupSlug]/shop/[flowSlug]/ShopCheckoutContent"
import {
  ApiError,
  ApplicationsService,
  AttendeeCategoriesService,
  AttendeesService,
  type CheckoutRuntimeResponse,
  CheckoutService,
  GroupsService,
  PaymentsService,
  PortalService,
  ProductsService,
  TicketingStepsService,
} from "@/client"
import { request } from "@/client/core/request"
import useResources from "@/hooks/useResources"
import { useRouteSalesFlow } from "@/hooks/useRouteSalesFlow"
import { setActiveRequestLanguage } from "@/lib/language-storage"
import { queryKeys } from "@/lib/query-keys"
import ApplicationProvider from "./applicationProvider"
import { CheckoutProvider, useCheckout } from "./checkoutProvider"
import DiscountProvider, { useDiscount } from "./discountProvider"
import PassesProvider from "./passesProvider"

const state = vi.hoisted(() => ({
  flowSlug: "a",
  user: { id: "human", tenant_id: "tenant", email: "buyer@example.com" },
  popupSlug: "festival",
  replace: vi.fn(),
  catalogLoading: true,
}))
vi.mock("next/navigation", () => ({
  useParams: () => ({ popupSlug: state.popupSlug, flowSlug: state.flowSlug }),
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: state.replace, push: vi.fn() }),
  usePathname: () => `/portal/${state.popupSlug}/shop/${state.flowSlug}`,
}))
vi.mock("@/hooks/useAuth", () => ({ default: () => ({ user: state.user }) }))
vi.mock("@/hooks/useIsAuthenticated", () => ({
  useIsAuthenticated: () => true,
}))
vi.mock("@/providers/cityProvider", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/providers/cityProvider")>()),
  useCityProvider: () => ({
    getCity: () => ({
      id: "popup",
      slug: "festival",
      takes_applications: true,
      edit_passes_enabled: true,
    }),
  }),
}))
vi.mock("@/hooks/usePortalSalesFlows", () => ({
  usePortalSalesFlows: () => ({
    data: undefined,
    isLoading: state.catalogLoading,
  }),
}))
vi.mock("@/hooks/usePortalDirectSalesFlows", () => ({
  usePortalDirectSalesFlows: () => ({
    data: undefined,
    isLoading: state.catalogLoading,
  }),
}))
vi.mock("@/hooks/usePortalUpsaleFlows", () => ({
  usePortalUpsaleFlows: () => ({
    data: undefined,
    isLoading: state.catalogLoading,
  }),
}))
vi.mock("@/hooks/useGatheringDoors", () => ({
  useGatheringDoors: () => ({ doors: [], isLoading: false }),
}))
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}))
vi.mock("@/client/core/request", () => ({
  request: vi.fn().mockResolvedValue(null),
}))
vi.mock("@/lib/background-image", () => ({
  getCheckoutBackground: () => ({ type: "none" }),
}))
vi.mock("@/lib/portal-telemetry", () => ({ trackPortalTelemetry: vi.fn() }))
vi.mock("@/lib/google-analytics", () => ({
  trackGAAddToCart: vi.fn(),
  trackGAPurchase: vi.fn(),
}))
vi.mock("@/lib/meta-pixel", () => ({
  trackMetaAddToCart: vi.fn(),
  trackMetaPurchase: vi.fn(),
  getMetaAttribution: () => ({}),
}))
vi.mock("@/components/checkout-flow/ScrollyCheckoutFlow", () => ({
  default: () => <CheckoutProbe />,
}))
vi.mock("@/components/checkout-flow/OpenCheckoutRuntime", () => ({
  OpenCheckoutRuntime: ({ runtime }: { runtime: CheckoutRuntimeResponse }) => (
    <div>open:{runtime.flow_type}</div>
  ),
}))

const product = {
  id: "ticket",
  tenant_id: "tenant",
  popup_id: "popup",
  slug: "ticket",
  name: "Ticket",
  category: "ticket",
  duration_type: "full",
  price: "100",
  is_active: true,
}
const applications = [
  {
    id: "app-a",
    popup_id: "popup",
    human_id: "human",
    sales_flow_id: "flow-a",
    status: "accepted",
    credit: 17,
    group_id: "group-a",
  },
  {
    id: "app-b",
    popup_id: "popup",
    human_id: "human",
    sales_flow_id: "flow-b",
    status: "accepted",
    credit: 3,
    group_id: "group-b",
  },
]
const attendees = ["a", "b"].map((id) => ({
  id: `person-${id}`,
  popup_id: "popup",
  tenant_id: "tenant",
  application_id: `app-${id}`,
  human_id: "human",
  category: "main",
  name: `Person ${id}`,
  products: [],
  origin: "application",
}))

function runtime(flowSlug: string, flowType = "application") {
  return {
    popup: { id: "popup", slug: "festival" },
    selected_flow: { id: `flow-${flowSlug}`, slug: flowSlug },
    flow_type: flowType,
    products: [],
    ticketing_steps: [],
  } as unknown as CheckoutRuntimeResponse
}

function CheckoutProbe() {
  const checkout = useCheckout()
  return (
    <>
      <output data-testid="checkout">
        {JSON.stringify({
          flowId: checkout.salesFlowId,
          mode: checkout.submitMode,
          loading: checkout.isInitialLoading,
          products: checkout.allProducts.length,
          attendees: checkout.attendees.map((person) => person.id),
          summary: checkout.summary,
        })}
      </output>
      <button
        type="button"
        onClick={() => checkout.togglePass("person-a", "ticket")}
      >
        Select ticket
      </button>
      <button type="button" onClick={() => void checkout.submitPayment()}>
        Pay
      </button>
    </>
  )
}

function SidebarProbe() {
  const { flowId } = useRouteSalesFlow()
  const { discountApplied } = useDiscount()
  const { resources } = useResources()
  return (
    <output data-testid="sidebar">
      {JSON.stringify({
        flowId,
        discount: discountApplied.discount_value,
        path: resources.find(
          (resource) => resource.name === "sidebar.application",
        )?.path,
      })}
    </output>
  )
}

let queryClient: QueryClient
function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <ApplicationProvider>
        <DiscountProvider>
          <SidebarProbe />
          {children}
        </DiscountProvider>
      </ApplicationProvider>
    </QueryClientProvider>
  )
}
function shop() {
  return (
    <Providers>
      <ShopCheckoutContent
        popupId="popup"
        popupSlug="festival"
        flowSlug={state.flowSlug}
      />
    </Providers>
  )
}

beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
  vi.mocked(request).mockClear()
  state.flowSlug = "a"
  state.popupSlug = "festival"
  state.user = { id: "human", tenant_id: "tenant", email: "buyer@example.com" }
  state.replace.mockClear()
  state.catalogLoading = true
  setActiveRequestLanguage("en")
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  vi.spyOn(ApplicationsService, "listMyApplications").mockResolvedValue({
    results: applications,
  } as never)
  vi.spyOn(ApplicationsService, "getMyParticipation").mockResolvedValue(
    null as never,
  )
  vi.spyOn(AttendeesService, "listMyAttendeesByPopup").mockResolvedValue({
    results: attendees,
  } as never)
  vi.spyOn(
    AttendeeCategoriesService,
    "listAttendeeCategoriesPortal",
  ).mockResolvedValue({ results: [] } as never)
  vi.spyOn(GroupsService, "listMyGroups").mockResolvedValue({
    results: [
      { id: "group-a", discount_percentage: 40 },
      { id: "group-b", discount_percentage: 5 },
    ],
  } as never)
  vi.spyOn(PortalService, "getPopupAccess").mockResolvedValue({
    allowed: true,
    source: "application",
  } as never)
  vi.spyOn(ProductsService, "listPortalProducts").mockResolvedValue({
    results: [product],
  } as never)
  vi.spyOn(PaymentsService, "listMyPaymentsByPopup").mockResolvedValue({
    results: [],
  } as never)
  vi.spyOn(PaymentsService, "releaseMyPendingPayment").mockResolvedValue({
    released: false,
  } as never)
  vi.spyOn(PaymentsService, "createMyPayment").mockResolvedValue({
    status: "created",
  } as never)
  vi.spyOn(CheckoutService, "purchaseOpenTicketing").mockResolvedValue({
    status: "created",
  } as never)
  vi.spyOn(TicketingStepsService, "listPortalTicketingSteps").mockResolvedValue(
    {
      results: [
        {
          id: "step",
          step_type: "passes",
          is_enabled: true,
          product_category: "ticket",
          order: 0,
        },
      ],
    } as never,
  )
  vi.spyOn(CheckoutService, "getFlowRuntime").mockImplementation(
    ({ flowSlug }) => Promise.resolve(runtime(flowSlug)) as never,
  )
})

describe("canonical Shop provider ownership", () => {
  it("returns to the canonical Shop URL if runtime requires authentication again", async () => {
    vi.mocked(CheckoutService.getFlowRuntime).mockRejectedValue(
      new ApiError(
        { method: "GET", url: "/runtime" },
        {
          url: "/runtime",
          ok: false,
          status: 401,
          statusText: "Unauthorized",
          body: null,
        },
        "Authentication required",
      ),
    )
    render(shop())
    const link = await screen.findByRole("link", {
      name: "openCheckout.sign_in_required_cta",
    })
    expect(link.getAttribute("href")).toBe(
      "/auth?redirect=%2Fportal%2Ffestival%2Fshop%2Fa",
    )
  })
  it("loads application checkout before catalogs, retains the URL, and submits the selected application's payment", async () => {
    render(shop())
    await waitFor(() =>
      expect(screen.getByTestId("checkout").textContent).toContain(
        '"products":1',
      ),
    )
    expect(CheckoutService.getFlowRuntime).toHaveBeenCalledTimes(1)
    expect(ProductsService.listPortalProducts).toHaveBeenCalledWith({
      popupId: "popup",
      salesFlowId: "flow-a",
    })
    expect(screen.getByTestId("checkout").textContent).toContain(
      '"mode":"application"',
    )
    expect(screen.getByTestId("checkout").textContent).toContain("person-b")
    expect(state.replace).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Select ticket" }))
    expect(screen.getByTestId("checkout").textContent).toContain(
      '"creditApplied":17',
    )
    fireEvent.click(screen.getByRole("button", { name: "Pay" }))
    await waitFor(() =>
      expect(PaymentsService.createMyPayment).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({ application_id: "app-a" }),
        }),
      ),
    )
    expect(CheckoutService.purchaseOpenTicketing).not.toHaveBeenCalled()
  })

  it("keeps B unresolved rather than using A, then switches sidebar, discount and payment scope without remounting chrome", async () => {
    const view = render(shop())
    await waitFor(() =>
      expect(screen.getByTestId("sidebar").textContent).toContain(
        '"discount":40',
      ),
    )
    const sidebar = screen.getByTestId("sidebar")
    let resolveB!: (value: CheckoutRuntimeResponse) => void
    vi.mocked(CheckoutService.getFlowRuntime).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveB = resolve
        }) as never,
    )
    state.flowSlug = "b"
    view.rerender(shop())
    expect(screen.getByTestId("sidebar")).toBe(sidebar)
    expect(sidebar.textContent).toContain('"flowId":"b"')
    expect(sidebar.textContent).toContain('"discount":0')
    expect(sidebar.textContent).not.toContain("flow-a")
    await act(async () => resolveB(runtime("b")))
    await waitFor(() => expect(sidebar.textContent).toContain('"discount":5'))
    expect(sidebar.textContent).toContain("/portal/festival?flow=flow-b")
    await waitFor(() =>
      expect(screen.getByTestId("checkout").textContent).toContain(
        '"products":1',
      ),
    )
    expect(screen.getByTestId("checkout").textContent).toContain(
      '"flowId":"flow-b"',
    )
    expect(screen.getByTestId("checkout").textContent).toContain("person-a")
    fireEvent.click(screen.getByRole("button", { name: "Select ticket" }))
    expect(screen.getByTestId("checkout").textContent).toContain(
      '"creditApplied":3',
    )
    fireEvent.click(screen.getByRole("button", { name: "Pay" }))
    await waitFor(() =>
      expect(PaymentsService.createMyPayment).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({ application_id: "app-b" }),
        }),
      ),
    )
  })

  it.each([
    "empty",
    "error",
  ])("settles an application checkout with %s attendee and product responses", async (outcome) => {
    if (outcome === "empty") {
      vi.mocked(AttendeesService.listMyAttendeesByPopup).mockResolvedValue({
        results: [],
      } as never)
      vi.mocked(ProductsService.listPortalProducts).mockResolvedValue({
        results: [],
      } as never)
    } else {
      vi.mocked(AttendeesService.listMyAttendeesByPopup).mockRejectedValue(
        new Error("Unavailable"),
      )
      vi.mocked(ProductsService.listPortalProducts).mockRejectedValue(
        new Error("Unavailable"),
      )
    }
    render(shop())
    await waitFor(() =>
      expect(screen.getByTestId("checkout").textContent).toContain(
        '"loading":false',
      ),
    )
    expect(screen.getByTestId("checkout").textContent).toContain('"products":0')
    expect(screen.getByTestId("checkout").textContent).toContain(
      '"attendees":[]',
    )
  })

  it.each([
    "direct",
    "upsale",
  ])("keeps %s on the runtime presentation without application purchasing", async (flowType) => {
    vi.mocked(CheckoutService.getFlowRuntime).mockResolvedValue(
      runtime("a", flowType),
    )
    render(shop())
    expect(await screen.findByText(`open:${flowType}`)).toBeTruthy()
    expect(ProductsService.listPortalProducts).not.toHaveBeenCalled()
    expect(PaymentsService.createMyPayment).not.toHaveBeenCalled()
    expect(state.replace).not.toHaveBeenCalled()
  })

  it("uses the same authenticated key for intent prefetch and checkout mount", async () => {
    await queryClient.prefetchQuery(
      checkoutRuntimeOptions("festival", "a", "en", "tenant:human"),
    )
    render(shop())
    await screen.findByTestId("checkout")
    expect(CheckoutService.getFlowRuntime).toHaveBeenCalledTimes(1)
    await act(async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.checkout.runtime("festival", "a"),
      })
    })
    expect(CheckoutService.getFlowRuntime).toHaveBeenCalledTimes(2)
  })

  it("does not grant application purchasing from companion display status", async () => {
    vi.mocked(ApplicationsService.listMyApplications).mockResolvedValue({
      results: [],
    } as never)
    vi.mocked(ApplicationsService.getMyParticipation).mockResolvedValue({
      type: "companion",
      application_status: "accepted",
    } as never)
    render(shop())
    expect(await screen.findByText("shop.approval_required_title")).toBeTruthy()
    expect(screen.queryByTestId("checkout")).toBeNull()
    expect(PaymentsService.createMyPayment).not.toHaveBeenCalled()
  })
  it("keeps an application's dark theme inside the checkout content boundary", async () => {
    document.documentElement.style.setProperty("--background", "#f5f5f5")
    vi.mocked(CheckoutService.getFlowRuntime).mockResolvedValue({
      ...runtime("a"),
      theme_config: { colors: { mode: "dark" } },
    } as never)
    render(shop())
    const checkout = await screen.findByTestId("checkout")
    expect(
      checkout.closest("[style*='--background']")?.getAttribute("style"),
    ).toContain("--background: oklch(0.145 0 0)")
    expect(checkout.closest(".isolate")?.classList.contains("relative")).toBe(
      true,
    )
    expect(
      screen.getByTestId("sidebar").closest("div[style*='--background']"),
    ).toBeNull()
    expect(
      document.documentElement.style.getPropertyValue("--background"),
    ).toBe("#f5f5f5")
  })

  it("does not read another user or language's runtime into the sidebar", async () => {
    queryClient.setQueryData(
      checkoutRuntimeOptions("festival", "a", "es", "tenant:human").queryKey,
      runtime("a"),
    )
    queryClient.setQueryData(
      checkoutRuntimeOptions("festival", "a", "en", "tenant:other").queryKey,
      runtime("a"),
    )
    render(
      <Providers>
        <div>Content</div>
      </Providers>,
    )
    expect(screen.getByTestId("sidebar").textContent).toContain('"flowId":"a"')
    expect(CheckoutService.getFlowRuntime).not.toHaveBeenCalled()
  })

  it("treats empty overrides as authoritative, then restores normal same-key queries when removed", async () => {
    function Content({ overrides }: { overrides: boolean }) {
      return (
        <Providers>
          <PassesProvider
            attendees={[]}
            productsOverride={overrides ? [] : undefined}
            purchasesOverride={overrides ? [] : undefined}
            salesFlowId="flow-a"
          >
            <CheckoutProvider
              productsOverride={overrides ? [] : undefined}
              configuredStepsOverride={[]}
              salesFlowId="flow-a"
              cartPersistenceEnabled={false}
            >
              <CheckoutProbe />
            </CheckoutProvider>
          </PassesProvider>
        </Providers>
      )
    }
    const view = render(<Content overrides />)
    await waitFor(() =>
      expect(screen.getByTestId("checkout").textContent).toContain(
        '"loading":false',
      ),
    )
    expect(ProductsService.listPortalProducts).not.toHaveBeenCalled()
    expect(PaymentsService.listMyPaymentsByPopup).not.toHaveBeenCalled()
    expect(
      TicketingStepsService.listPortalTicketingSteps,
    ).not.toHaveBeenCalled()
    await act(async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.products.byPopup("popup", "flow-a"),
      })
      await queryClient.invalidateQueries({
        queryKey: queryKeys.purchases.byPopup("popup"),
      })
    })
    expect(ProductsService.listPortalProducts).not.toHaveBeenCalled()
    expect(PaymentsService.listMyPaymentsByPopup).not.toHaveBeenCalled()
    view.rerender(<Content overrides={false} />)
    await waitFor(() =>
      expect(screen.getByTestId("checkout").textContent).toContain(
        '"products":1',
      ),
    )
    expect(ProductsService.listPortalProducts).toHaveBeenCalledTimes(1)
    expect(PaymentsService.listMyPaymentsByPopup).toHaveBeenCalledTimes(1)
    await act(async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.products.byPopup("popup", "flow-a"),
      })
    })
    expect(ProductsService.listPortalProducts).toHaveBeenCalledTimes(2)
  })

  it.each([
    "products",
    "purchases",
  ])("disables only the query owned by the %s override", async (owner) => {
    render(
      <Providers>
        <PassesProvider
          attendees={[]}
          productsOverride={owner === "products" ? [] : undefined}
          purchasesOverride={owner === "purchases" ? [] : undefined}
          salesFlowId="flow-a"
        >
          <div>Content</div>
        </PassesProvider>
      </Providers>,
    )
    const unused =
      owner === "products"
        ? ProductsService.listPortalProducts
        : PaymentsService.listMyPaymentsByPopup
    const required =
      owner === "products"
        ? PaymentsService.listMyPaymentsByPopup
        : ProductsService.listPortalProducts
    await waitFor(() => expect(required).toHaveBeenCalledTimes(1))
    expect(unused).not.toHaveBeenCalled()
  })
})
