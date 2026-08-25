import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ShopCheckoutContent } from "./ShopCheckoutContent"

const replace = vi.fn()
const mocks = vi.hoisted(() => ({
  application: [] as Array<{ id: string; slug: string; name: string }>,
  applicationStatus: "accepted" as string | null,
}))

vi.mock("@/hooks/usePortalSalesFlows", () => ({
  usePortalSalesFlows: () => ({ data: mocks.application }),
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
}))

describe("ShopCheckoutContent", () => {
  beforeEach(() => {
    replace.mockReset()
    mocks.application = []
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

  it("explains the approval prerequisite for an application Shop deep link", () => {
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
})
