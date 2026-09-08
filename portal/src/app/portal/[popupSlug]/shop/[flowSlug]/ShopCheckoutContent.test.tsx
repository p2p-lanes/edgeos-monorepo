import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ShopCheckoutContent } from "./ShopCheckoutContent"

const replace = vi.fn()
const mocks = vi.hoisted(() => ({
  application: [] as Array<{ id: string; slug: string; name: string }>,
  applicationStatus: "accepted" as string | null,
  loading: false,
}))

vi.mock("@/hooks/usePortalSalesFlows", () => ({
  usePortalSalesFlows: () => ({
    data: mocks.application,
    isLoading: mocks.loading,
  }),
}))
vi.mock("@/hooks/usePortalDirectSalesFlows", () => ({
  usePortalDirectSalesFlows: () => ({
    data: [{ id: "flow-1", slug: "merch-store", name: "Merch Store" }],
  }),
}))
vi.mock("@/hooks/usePortalUpsaleFlows", () => ({
  usePortalUpsaleFlows: () => ({ data: [] }),
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
  useSearchParams: () => new URLSearchParams(),
}))

describe("ShopCheckoutContent", () => {
  beforeEach(() => {
    replace.mockReset()
    mocks.application = []
    mocks.applicationStatus = "accepted"
    mocks.loading = false
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

  it("mounts the authenticated runtime before application catalogs resolve", () => {
    mocks.loading = true
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

    expect(screen.getByText("checkout:attendee")).toBeTruthy()
    expect(replace).not.toHaveBeenCalled()
  })
})
