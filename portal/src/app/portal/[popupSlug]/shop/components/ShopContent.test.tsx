import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { resolveShopFlowSlug, ShopContent } from "./ShopContent"

const mocks = vi.hoisted(() => ({
  application: [] as Array<{ id: string; slug: string; name: string }>,
  direct: [] as Array<{ id: string; slug: string; name: string }>,
  upsale: [] as Array<{ id: string; slug: string; name: string }>,
  applicationStatus: "accepted" as string | null,
}))

vi.mock("@/hooks/usePortalSalesFlows", () => ({
  usePortalSalesFlows: () => ({ data: mocks.application }),
}))

vi.mock("@/hooks/usePortalDirectSalesFlows", () => ({
  usePortalDirectSalesFlows: () => ({ data: mocks.direct }),
}))

vi.mock("@/hooks/usePortalUpsaleFlows", () => ({
  usePortalUpsaleFlows: () => ({ data: mocks.upsale }),
}))

vi.mock("@/providers/applicationProvider", () => ({
  useApplication: () => ({
    getRelevantApplication: () =>
      mocks.applicationStatus ? { status: mocks.applicationStatus } : null,
    participation: null,
  }),
}))

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        "shop.title": "Shop",
        "shop.description": "Choose an available option.",
        "shop.catalog": "Available options",
        "shop.application": "Application",
        "shop.direct": "Direct purchase",
        "shop.upsale": "Available to you",
        "shop.empty_title": "Nothing available right now",
        "shop.empty_description": "Check back later for new options.",
        "shop.open": "View option",
      })[key] ?? key,
  }),
}))

describe("ShopContent", () => {
  it("canonicalizes an authorized UUID link to the flow's current slug", () => {
    const flow = {
      id: "flow-1",
      slug: "merch-store-2026",
      name: "Merch Store",
    }

    expect(resolveShopFlowSlug("flow-1", [flow])).toBe("merch-store-2026")
  })

  it("does not canonicalize an unknown link to another authorized offer", () => {
    const flow = {
      id: "flow-1",
      slug: "merch-store-2026",
      name: "Merch Store",
    }

    expect(resolveShopFlowSlug("unknown", [flow])).toBeNull()
  })

  it("combines the three authorized sources into readable slug routes", () => {
    mocks.application = [
      { id: "application", slug: "volunteer", name: "Volunteer" },
    ]
    mocks.direct = [{ id: "direct", slug: "weekend", name: "Weekend Pass" }]
    mocks.upsale = [{ id: "upsale", slug: "merch-store", name: "Merch Store" }]

    render(<ShopContent popupId="popup-1" popupSlug="summer-camp" />)

    expect(screen.getByRole("heading", { name: "Application" })).toBeTruthy()
    expect(
      screen.getByRole("heading", { name: "Direct purchase" }),
    ).toBeTruthy()
    expect(
      screen.getByRole("heading", { name: "Available to you" }),
    ).toBeTruthy()
    expect(
      screen
        .getByRole("link", { name: "Application Volunteer View option" })
        .getAttribute("href"),
    ).toBe("/portal/summer-camp/shop/volunteer")
    expect(
      screen
        .getByRole("link", {
          name: "Direct purchase Weekend Pass View option",
        })
        .getAttribute("href"),
    ).toBe("/portal/summer-camp/shop/weekend")
    expect(
      screen
        .getByRole("link", { name: "Available to you Merch Store View option" })
        .getAttribute("href"),
    ).toBe("/portal/summer-camp/shop/merch-store")
  })

  it("does not render an offer or restricted source when every collection is empty", () => {
    mocks.application = []
    mocks.direct = []
    mocks.upsale = []

    render(<ShopContent popupId="popup-1" popupSlug="summer-camp" />)

    expect(screen.getByText("Nothing available right now")).toBeTruthy()
    expect(screen.queryByRole("link")).toBeNull()
    expect(screen.queryByText("Available to you")).toBeNull()
  })

  it("does not expose attendee checkout as a Shop option before approval", () => {
    mocks.applicationStatus = "in review"
    mocks.application = [
      { id: "application", slug: "attendee", name: "Attendee" },
    ]
    mocks.direct = [{ id: "direct", slug: "weekend", name: "Weekend Pass" }]
    mocks.upsale = []

    render(<ShopContent popupId="popup-1" popupSlug="summer-camp" />)

    expect(screen.queryByText("Attendee")).toBeNull()
    expect(
      screen
        .getByRole("link", {
          name: "Direct purchase Weekend Pass View option",
        })
        .getAttribute("href"),
    ).toBe("/portal/summer-camp/shop/weekend")
  })
})
