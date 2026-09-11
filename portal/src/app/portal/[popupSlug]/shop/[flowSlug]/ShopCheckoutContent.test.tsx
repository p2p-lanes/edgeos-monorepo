import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type {
  SalesFlowPortalPublic,
  SalesFlowPortalThemeConfig,
} from "@/client/types.gen"
import { ShopCheckoutContent } from "./ShopCheckoutContent"

const replace = vi.fn()
const applicationCheckoutProps = vi.hoisted(() => vi.fn())
type Flow = Pick<SalesFlowPortalPublic, "id" | "slug" | "name"> &
  Partial<Pick<SalesFlowPortalPublic, "theme_config">>
const mocks = vi.hoisted(() => ({
  application: [] as Flow[],
  direct: [] as Flow[],
  upsale: [] as Flow[],
  loading: { application: false, direct: false, upsale: false },
  applicationStatus: "accepted" as string | null,
  approvedApplicationFlowId: "application-1" as string | null,
}))

vi.mock("@/hooks/usePortalSalesFlows", () => ({
  usePortalSalesFlows: () => ({
    data: mocks.application,
    isLoading: mocks.loading.application,
  }),
}))
vi.mock("@/hooks/usePortalDirectSalesFlows", () => ({
  usePortalDirectSalesFlows: () => ({
    data: mocks.direct,
    isLoading: mocks.loading.direct,
  }),
}))
vi.mock("@/hooks/usePortalUpsaleFlows", () => ({
  usePortalUpsaleFlows: () => ({
    data: mocks.upsale,
    isLoading: mocks.loading.upsale,
  }),
}))
vi.mock("@/providers/applicationProvider", () => ({
  useApplication: () => ({
    getRelevantApplication: (flowId?: string | null) =>
      mocks.applicationStatus && flowId === mocks.approvedApplicationFlowId
        ? { status: mocks.applicationStatus }
        : null,
  }),
}))
const checkoutProps = vi.hoisted(() => vi.fn())
vi.mock("@/app/checkout/[popupSlug]/CheckoutPageClient", () => ({
  default: (props: { flowSlug: string; returnContext?: string }) => {
    checkoutProps(props)
    return <div>checkout:{props.flowSlug}</div>
  },
}))
vi.mock("./ApplicationShopCheckout", () => ({
  ApplicationShopCheckout: ({
    flowId,
    flowSlug,
    themeConfig,
  }: {
    flowId: string
    flowSlug: string
    themeConfig?: SalesFlowPortalThemeConfig | null
  }) => {
    applicationCheckoutProps({ flowId, flowSlug, themeConfig })
    return <div>{`application-checkout:${flowId}:${flowSlug}`}</div>
  },
}))
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => (key === "sidebar.commerce" ? "Commerce" : key),
  }),
}))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
}))

describe("ShopCheckoutContent", () => {
  beforeEach(() => {
    replace.mockReset()
    applicationCheckoutProps.mockReset()
    checkoutProps.mockReset()
    mocks.application = []
    mocks.direct = [{ id: "flow-1", slug: "merch-store", name: "Merch Store" }]
    mocks.upsale = []
    mocks.loading = { application: false, direct: false, upsale: false }
    mocks.applicationStatus = "accepted"
    mocks.approvedApplicationFlowId = "application-1"
  })

  it("mounts checkout without a Commerce or flow-name header", () => {
    render(
      <ShopCheckoutContent
        popupId="popup-1"
        popupSlug="summer-camp"
        flowSlug="merch-store"
      />,
    )

    expect(screen.queryByRole("heading", { name: "Merch Store" })).toBeNull()
    expect(screen.queryByText("Commerce")).toBeNull()
    expect(screen.queryByText("Shop")).toBeNull()
    expect(screen.getByText("checkout:merch-store")).toBeTruthy()
    expect(checkoutProps).toHaveBeenCalledWith(
      expect.objectContaining({ returnContext: "portal" }),
    )
    expect(replace).not.toHaveBeenCalled()
  })

  it("canonicalizes an authorized direct-flow UUID to its current Shop slug", () => {
    render(
      <ShopCheckoutContent
        popupId="popup-1"
        popupSlug="summer-camp"
        flowSlug="flow-1"
      />,
    )

    expect(replace).toHaveBeenCalledWith("/portal/summer-camp/shop/merch-store")
  })

  it("canonicalizes an approved application UUID and mounts its application-backed checkout", () => {
    mocks.application = [
      {
        id: "application-1",
        slug: "attendee",
        name: "Attendee",
        theme_config: {
          colors: {
            mode: "light",
            card_background_color: "#FFFFFF",
            card_foreground_color: "#0F172A",
          },
        },
      },
    ]

    render(
      <ShopCheckoutContent
        popupId="popup-1"
        popupSlug="summer-camp"
        flowSlug="application-1"
      />,
    )

    expect(replace).toHaveBeenCalledWith("/portal/summer-camp/shop/attendee")
    expect(
      screen.getByText("application-checkout:application-1:attendee"),
    ).toBeTruthy()
    expect(applicationCheckoutProps).toHaveBeenLastCalledWith(
      expect.objectContaining({
        themeConfig: {
          colors: {
            mode: "light",
            card_background_color: "#FFFFFF",
            card_foreground_color: "#0F172A",
          },
        },
      }),
    )
    expect(screen.queryByText("checkout:attendee")).toBeNull()
  })

  it("mounts an accepted canonical application flow when multiple doors exist", () => {
    mocks.application = [
      { id: "application-1", slug: "attendee", name: "Attendee" },
      { id: "application-2", slug: "volunteer", name: "Volunteer" },
    ]

    render(
      <ShopCheckoutContent
        popupId="popup-1"
        popupSlug="summer-camp"
        flowSlug="attendee"
      />,
    )

    expect(
      screen.getByText("application-checkout:application-1:attendee"),
    ).toBeTruthy()
    expect(replace).not.toHaveBeenCalled()
  })

  it.each([
    false,
    true,
  ])("keeps application approval required with other catalogs pending=%s", (pending) => {
    mocks.loading.direct = pending
    mocks.loading.upsale = pending
    mocks.applicationStatus = "in review"
    mocks.application = [
      { id: "application-1", slug: "attendee", name: "Attendee" },
    ]

    render(
      <ShopCheckoutContent
        popupId="popup-1"
        popupSlug="summer-camp"
        flowSlug="attendee"
      />,
    )

    expect(screen.getByText("shop.approval_required_title")).toBeTruthy()
    expect(
      screen
        .getByRole("link", { name: "shop.approval_required_cta" })
        .getAttribute("href"),
    ).toBe("/portal/summer-camp?flow=application-1")
    expect(screen.queryByText("checkout:attendee")).toBeNull()
  })

  it("requires approval for the selected application flow", () => {
    mocks.application = [
      { id: "application-1", slug: "attendee", name: "Attendee" },
      { id: "application-2", slug: "volunteer", name: "Volunteer" },
    ]
    mocks.approvedApplicationFlowId = "application-2"

    render(
      <ShopCheckoutContent
        popupId="popup-1"
        popupSlug="summer-camp"
        flowSlug="attendee"
      />,
    )

    expect(screen.getByText("shop.approval_required_title")).toBeTruthy()
    expect(screen.queryByText("checkout:attendee")).toBeNull()
  })

  it.each([
    "direct",
    "upsale",
  ] as const)("mounts a known canonical %s flow before unrelated catalogs settle", (kind) => {
    mocks.direct = []
    mocks[kind] = [{ id: "known-flow", slug: "extras", name: "Extras" }]
    mocks.loading.application = true
    mocks.loading.upsale = kind === "direct"

    const { container } = render(
      <ShopCheckoutContent
        popupId="popup-1"
        popupSlug="summer-camp"
        flowSlug="extras"
      />,
    )

    expect(screen.getByText("checkout:extras")).toBeTruthy()
    expect(screen.queryByRole("heading", { name: "Extras" })).toBeNull()
    expect(screen.queryByText("Commerce")).toBeNull()
    expect(container.querySelector(".animate-spin")).toBeNull()
    expect(replace).not.toHaveBeenCalled()
  })

  it.each([
    ["unknown", "/portal/summer-camp", null],
    ["flow-1", "/portal/summer-camp/shop/merch-store", "checkout:merch-store"],
  ] as const)("waits for all catalogs before resolving %s", (identifier, destination, checkout) => {
    mocks.loading.application = true
    const content = () => (
      <ShopCheckoutContent
        popupId="popup-1"
        popupSlug="summer-camp"
        flowSlug={identifier}
      />
    )
    const { container, rerender } = render(content())

    expect(container.querySelector(".animate-spin")).not.toBeNull()
    expect(screen.queryByText(/^checkout:/)).toBeNull()
    expect(replace).not.toHaveBeenCalled()

    mocks.loading.application = false
    rerender(content())

    expect(replace).toHaveBeenCalledWith(destination)
    expect(screen.queryByText(/^checkout:/)?.textContent ?? null).toBe(checkout)
  })
})
