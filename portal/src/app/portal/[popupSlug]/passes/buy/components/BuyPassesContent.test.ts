import { render } from "@testing-library/react"
import { createElement } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import LegacyBuyPassesRedirect, {
  resolveLegacyShopRoute,
} from "./BuyPassesContent"

const replace = vi.fn()
let flowIdentifier = "flow-1"
let applicationQuery: { data?: unknown[]; isLoading: boolean } = {
  data: [],
  isLoading: false,
}
let directQuery: { data?: unknown[]; isLoading: boolean } = {
  data: [],
  isLoading: false,
}

vi.mock("next/navigation", () => ({
  useParams: () => ({ popupSlug: "summer-camp" }),
  useRouter: () => ({ replace }),
  useSearchParams: () => ({ get: () => flowIdentifier }),
}))
vi.mock("@/providers/cityProvider", () => ({
  useCityProvider: () => ({ getCity: () => ({ id: "popup-1" }) }),
}))
vi.mock("@/hooks/usePortalSalesFlows", () => ({
  usePortalSalesFlows: () => applicationQuery,
}))
vi.mock("@/hooks/usePortalDirectSalesFlows", () => ({
  usePortalDirectSalesFlows: () => directQuery,
}))
vi.mock("@/hooks/usePortalUpsaleFlows", () => ({
  usePortalUpsaleFlows: () => ({ data: [], isLoading: false }),
}))

describe("resolveLegacyShopRoute", () => {
  const flows = [
    { id: "flow-1", slug: "merch-store", type: "direct" },
    { id: "flow-2", slug: "weekend-pass", type: "application" },
  ]

  it("waits for an uncached authorized collection before choosing a legacy route", () => {
    expect(
      resolveLegacyShopRoute("summer-camp", "flow-1", flows, false),
    ).toBeNull()
  })

  it("canonicalizes a cached direct legacy identifier to its readable Shop URL", () => {
    expect(
      resolveLegacyShopRoute("summer-camp", "flow-1", flows, true),
    ).toEqual({ kind: "shop", target: "/portal/summer-camp/shop/merch-store" })
  })

  it("canonicalizes an application legacy identifier to its readable Shop URL", () => {
    expect(
      resolveLegacyShopRoute("summer-camp", "weekend-pass", flows, true),
    ).toEqual({
      kind: "shop",
      target: "/portal/summer-camp/shop/weekend-pass",
    })
  })

  it("returns to the Portal root for an unknown identifier without selecting another flow", () => {
    expect(
      resolveLegacyShopRoute("summer-camp", "unknown-flow", flows, true),
    ).toEqual({ kind: "shop", target: "/portal/summer-camp" })
  })
})

describe("LegacyBuyPassesRedirect", () => {
  beforeEach(() => {
    replace.mockReset()
    flowIdentifier = "flow-1"
    applicationQuery = { data: [], isLoading: false }
    directQuery = { data: [], isLoading: false }
  })

  it("does not redirect a fresh legacy link before authorized collections resolve", () => {
    directQuery = { data: undefined, isLoading: true }

    render(createElement(LegacyBuyPassesRedirect))

    expect(replace).not.toHaveBeenCalled()
  })

  it("redirects a cached authorized legacy link to its canonical Shop URL", () => {
    directQuery = {
      data: [{ id: "flow-1", slug: "merch-store", type: "direct" }],
      isLoading: false,
    }

    render(createElement(LegacyBuyPassesRedirect))

    expect(replace).toHaveBeenCalledWith("/portal/summer-camp/shop/merch-store")
  })

  it("redirects a legacy application-flow UUID to its canonical Shop URL", () => {
    flowIdentifier = "application-id"
    applicationQuery = {
      data: [{ id: "application-id", slug: "attendee", type: "application" }],
      isLoading: false,
    }

    render(createElement(LegacyBuyPassesRedirect))

    expect(replace).toHaveBeenCalledWith("/portal/summer-camp/shop/attendee")
  })
})
