import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ShopCheckoutContent } from "./ShopCheckoutContent"

const replace = vi.fn()
type Flow = { id: string; slug: string; name: string }
const mocks = vi.hoisted(() => ({
  application: [] as Flow[],
  direct: [] as Flow[],
  upsale: [] as Flow[],
  loading: { application: false, direct: false, upsale: false },
  applicationStatus: "accepted" as string | null,
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
    getRelevantApplication: () =>
      mocks.applicationStatus ? { status: mocks.applicationStatus } : null,
    participation: null,
  }),
}))
vi.mock("@/app/checkout/[popupSlug]/CheckoutPageClient", () => ({
  default: ({ flowSlug }: { flowSlug: string }) => (
    <div>checkout:{flowSlug}</div>
  ),
}))
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
}))

describe("ShopCheckoutContent", () => {
  beforeEach(() => {
    replace.mockReset()
    mocks.application = []
    mocks.direct = [{ id: "flow-1", slug: "merch-store", name: "Merch Store" }]
    mocks.upsale = []
    mocks.loading = { application: false, direct: false, upsale: false }
    mocks.applicationStatus = "accepted"
  })

  it("keeps the selected flow name visible around the shared checkout content", () => {
    render(
      <ShopCheckoutContent
        popupId="popup-1"
        popupSlug="summer-camp"
        flowSlug="merch-store"
      />,
    )

    expect(screen.getByRole("heading", { name: "Merch Store" })).toBeTruthy()
    expect(screen.getByText("checkout:merch-store")).toBeTruthy()
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
    expect(screen.getByRole("heading", { name: "Extras" })).toBeTruthy()
    expect(container.querySelector(".animate-spin")).toBeNull()
    expect(replace).not.toHaveBeenCalled()
  })

  it.each([
    ["unknown", "/portal/summer-camp/shop", null],
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
