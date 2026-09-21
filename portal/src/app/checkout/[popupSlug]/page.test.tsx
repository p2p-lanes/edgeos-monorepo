import { beforeEach, describe, expect, it, vi } from "vitest"
import { fetchPrimaryCheckoutFlowSlug } from "@/lib/checkout-primary"
import { resolveTenantForMetadata } from "@/lib/tenant-metadata"
import CheckoutAliasPage from "./page"

const { redirect, notFound } = vi.hoisted(() => ({
  redirect: vi.fn(),
  notFound: vi.fn(),
}))

vi.mock("next/navigation", () => ({ redirect, notFound }))
vi.mock("@/lib/checkout-primary", () => ({
  fetchPrimaryCheckoutFlowSlug: vi.fn(),
}))
vi.mock("@/lib/tenant-metadata", () => ({
  resolveTenantForMetadata: vi.fn(),
}))

const mockFetchPrimary = vi.mocked(fetchPrimaryCheckoutFlowSlug)
const mockResolveTenant = vi.mocked(resolveTenantForMetadata)

describe("popup checkout alias", () => {
  beforeEach(() => {
    redirect.mockReset()
    notFound.mockReset()
    mockFetchPrimary.mockReset()
    mockResolveTenant.mockReset()
    mockResolveTenant.mockResolvedValue({ id: "tenant-1" } as never)
    mockFetchPrimary.mockResolvedValue("main-store")
  })

  it("redirects to the database primary flow", async () => {
    await CheckoutAliasPage({
      params: Promise.resolve({ popupSlug: "summer-fest" }),
      searchParams: Promise.resolve({}),
    })

    expect(mockFetchPrimary).toHaveBeenCalledWith("summer-fest", "tenant-1")
    expect(redirect).toHaveBeenCalledWith("/checkout/summer-fest/main-store")
  })

  it("preserves language, attribution, cart, and repeated query parameters", async () => {
    await CheckoutAliasPage({
      params: Promise.resolve({ popupSlug: "summer-fest" }),
      searchParams: Promise.resolve({
        lang: "es",
        utm_source: "newsletter",
        cid: "cart-1",
        sig: "signed value",
        tag: ["one", "two"],
      }),
    })

    expect(redirect).toHaveBeenCalledWith(
      "/checkout/summer-fest/main-store?lang=es&utm_source=newsletter&cid=cart-1&sig=signed+value&tag=one&tag=two",
    )
  })

  it("returns not found when no primary flow can be resolved", async () => {
    mockFetchPrimary.mockResolvedValue(null)

    await CheckoutAliasPage({
      params: Promise.resolve({ popupSlug: "summer-fest" }),
      searchParams: Promise.resolve({}),
    })

    expect(notFound).toHaveBeenCalledOnce()
    expect(redirect).not.toHaveBeenCalled()
  })
})
