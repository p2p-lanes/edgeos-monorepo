import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { resolveShopFlowSlug, ShopContent } from "./ShopContent"

const mocks = vi.hoisted(() => ({
  application: [] as Array<{
    id: string
    slug: string
    name: string
    price_summary?: {
      amount: string
      currency: string
      kind: "fixed" | "from"
    } | null
  }>,
  direct: [] as Array<{
    id: string
    slug: string
    name: string
    price_summary?: {
      amount: string
      currency: string
      kind: "fixed" | "from"
    } | null
  }>,
  upsale: [] as Array<{
    id: string
    slug: string
    name: string
    price_summary?: {
      amount: string
      currency: string
      kind: "fixed" | "from"
    } | null
  }>,
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
    t: (key: string, values?: Record<string, string>) => {
      const translation =
        {
          "shop.title": "Shop",
          "shop.description": "Choose an available option.",
          "shop.catalog": "Available options",
          "shop.application": "Application",
          "shop.direct": "Direct purchase",
          "shop.upsale": "Available to you",
          "shop.empty_title": "Nothing available right now",
          "shop.empty_description": "Check back later for new options.",
          "shop.open": "View option",
          "shop.eligibility.application": "Available to approved applicants",
          "shop.eligibility.direct": "Available to all attendees",
          "shop.eligibility.upsale": "Available after an eligible purchase",
          "shop.source": "Source: {{source}}",
          "shop.price_from": "From {{price}}",
          "shop.price_unavailable": "Price unavailable",
        }[key] ?? key

      return Object.entries(values ?? {}).reduce(
        (result, [name, value]) => result.replace(`{{${name}}}`, value),
        translation,
      )
    },
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
    expect(screen.getByText("Price unavailable")).toBeTruthy()
  })

  it("renders server-provided fixed, from, and unavailable prices with source eligibility context", () => {
    mocks.applicationStatus = "accepted"
    mocks.application = [
      {
        id: "application",
        slug: "volunteer",
        name: "Volunteer",
        price_summary: null,
      },
    ]
    mocks.direct = [
      {
        id: "direct",
        slug: "weekend",
        name: "Weekend Pass",
        price_summary: { amount: "25.00", currency: "USD", kind: "fixed" },
      },
    ]
    mocks.upsale = [
      {
        id: "upsale",
        slug: "merch-store",
        name: "Merch Store",
        price_summary: { amount: "15.00", currency: "USD", kind: "from" },
      },
    ]

    render(<ShopContent popupId="popup-1" popupSlug="summer-camp" />)

    expect(screen.getByText("Available to approved applicants")).toBeTruthy()
    expect(screen.getByText("Available to all attendees")).toBeTruthy()
    expect(
      screen.getByText("Available after an eligible purchase"),
    ).toBeTruthy()
    expect(screen.getByText("Source: Direct purchase")).toBeTruthy()
    expect(screen.getByText("USD 25.00")).toBeTruthy()
    expect(screen.getByText("From USD 15.00")).toBeTruthy()
    expect(screen.getByText("Price unavailable")).toBeTruthy()
  })
})
