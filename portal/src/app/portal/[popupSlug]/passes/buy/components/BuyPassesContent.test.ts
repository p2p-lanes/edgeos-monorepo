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
  useSearchParams: () => new URLSearchParams({ flow: flowIdentifier }),
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

  it("canonicalizes an authorized application flow without a Buy loop", () => {
    expect(
      resolveLegacyShopRoute("summer-camp", "weekend-pass", flows, true),
    ).toEqual({
      kind: "shop",
      target: "/portal/summer-camp/shop/weekend-pass",
    })
  })

  it("returns only Shop root for an unknown identifier without selecting another flow", () => {
    expect(
      resolveLegacyShopRoute("summer-camp", "unknown-flow", flows, true),
    ).toEqual({ kind: "shop", target: "/portal/summer-camp/shop" })
  })
  it.each([
    "flow-2",
    "weekend-pass",
  ])("preserves restore, language, attribution and completion context for %s", (identifier) => {
    const search = `flow=${identifier}&lang=es&locale=es&cid=cart&sig=signature&utm_source=email&checkout=success`
    expect(
      resolveLegacyShopRoute(
        "summer-camp",
        identifier,
        flows,
        true,
        search,
        "#confirm",
      ),
    ).toEqual({
      kind: "shop",
      target:
        "/portal/summer-camp/shop/weekend-pass?lang=es&locale=es&cid=cart&sig=signature&utm_source=email&checkout=success#confirm",
    })
  })
  it("does not guess a default when no identifier was supplied", () => {
    expect(
      resolveLegacyShopRoute("summer-camp", null, flows, true)?.target,
    ).toBe("/portal/summer-camp/shop")
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
