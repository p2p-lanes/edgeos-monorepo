import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ShopCheckoutContent } from "./ShopCheckoutContent"

const replace = vi.fn()

vi.mock("@/hooks/usePortalSalesFlows", () => ({
  usePortalSalesFlows: () => ({ data: [] }),
}))
vi.mock("@/hooks/usePortalDirectSalesFlows", () => ({
  usePortalDirectSalesFlows: () => ({
    data: [{ id: "flow-1", slug: "merch-store", name: "Merch Store" }],
  }),
}))
vi.mock("@/hooks/usePortalUpsaleFlows", () => ({
  usePortalUpsaleFlows: () => ({ data: [] }),
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

  it("replaces a legacy UUID Shop URL with the authorized flow slug", () => {
    render(
      <ShopCheckoutContent
        popupId="popup-1"
        popupSlug="summer-camp"
        flowSlug="flow-1"
      />,
    )

    expect(replace).toHaveBeenCalledWith("/portal/summer-camp/shop/merch-store")
    expect(screen.getByText("checkout:merch-store")).toBeTruthy()
  })
})
