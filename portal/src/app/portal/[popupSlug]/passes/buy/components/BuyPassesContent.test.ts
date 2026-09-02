import { render } from "@testing-library/react"
import { createElement } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import BuyPassesContent, { resolveLegacyShopRoute } from "./BuyPassesContent"

const replace = vi.fn()
let flowIdentifier = "flow-1"
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
  usePortalSalesFlows: () => ({ data: [], isLoading: false }),
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

  it("keeps an authorized application flow in its flow-aware portal checkout", () => {
    expect(
      resolveLegacyShopRoute("summer-camp", "weekend-pass", flows, true),
    ).toEqual({
      kind: "application",
      flowId: "flow-2",
      flowSlug: "weekend-pass",
    })
  })

  it("returns only Shop root for an unknown identifier without selecting another flow", () => {
    expect(
      resolveLegacyShopRoute("summer-camp", "unknown-flow", flows, true),
    ).toEqual({ kind: "shop", target: "/portal/summer-camp/shop" })
  })
})

describe("BuyPassesContent legacy route", () => {
  beforeEach(() => {
    replace.mockReset()
    flowIdentifier = "flow-1"
    directQuery = { data: [], isLoading: false }
  })

  it("does not redirect a fresh legacy link before authorized collections resolve", () => {
    directQuery = { data: undefined, isLoading: true }

    render(createElement(BuyPassesContent))

    expect(replace).not.toHaveBeenCalled()
  })

  it("redirects a cached authorized legacy link to its canonical Shop URL", () => {
    directQuery = {
      data: [{ id: "flow-1", slug: "merch-store", type: "direct" }],
      isLoading: false,
    }

    render(createElement(BuyPassesContent))

    expect(replace).toHaveBeenCalledWith("/portal/summer-camp/shop/merch-store")
  })
})
