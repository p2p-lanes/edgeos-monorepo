import { describe, expect, it, vi } from "vitest"
import { createCheckoutClient } from "./client"
import type { Transport } from "./transport/types"

/** A Transport spy that records the last call and returns a canned value. */
function mockTransport(returnValue: unknown = { ok: true }) {
  const request = vi.fn().mockResolvedValue(returnValue)
  const transport: Transport = { request }
  return { transport, request }
}

describe("createCheckoutClient", () => {
  const config = { slug: "demo", flowSlug: "checkout" }

  it("getRuntime → GET /checkout/{slug}/{flowSlug}/runtime, no body", async () => {
    const { transport, request } = mockTransport({ products: [] })
    const client = createCheckoutClient(config, transport)

    const res = await client.getRuntime()

    expect(res).toEqual({ products: [] })
    expect(request).toHaveBeenCalledWith(
      "GET",
      "/checkout/demo/checkout/runtime",
    )
  })

  it("preview → POST /checkout/{slug}/{flowSlug}/preview with the body", async () => {
    const { transport, request } = mockTransport()
    const client = createCheckoutClient(config, transport)

    const body = {
      products: [{ product_id: "p1", quantity: 2 }],
      insurance: true,
    }
    await client.preview(body)

    expect(request).toHaveBeenCalledWith(
      "POST",
      "/checkout/demo/checkout/preview",
      body,
    )
  })

  it("validateCoupon → POST /coupons/validate-public with {popup_slug, code}", async () => {
    const { transport, request } = mockTransport({ valid: true })
    const client = createCheckoutClient(config, transport)

    await client.validateCoupon("save10")

    expect(request).toHaveBeenCalledWith("POST", "/coupons/validate-public", {
      popup_slug: "demo",
      code: "save10",
    })
  })

  it("purchase → POST /checkout/{slug}/{flowSlug}/purchase with the body", async () => {
    const { transport, request } = mockTransport({
      checkout_url: "https://pay",
    })
    const client = createCheckoutClient(config, transport)

    const body = {
      products: [{ product_id: "p1", quantity: 1 }],
      buyer: { email: "a@b.c", first_name: "A", last_name: "B" },
    }
    await client.purchase(body)

    expect(request).toHaveBeenCalledWith(
      "POST",
      "/checkout/demo/checkout/purchase",
      body,
    )
  })

  it("upsertCart → PUT /checkout/{slug}/{flowSlug}/cart with the body", async () => {
    const { transport, request } = mockTransport()
    const client = createCheckoutClient(config, transport)

    const body = { email: "a@b.c", items: { insurance: false } }
    await client.upsertCart(body)

    expect(request).toHaveBeenCalledWith(
      "PUT",
      "/checkout/demo/checkout/cart",
      body,
    )
  })

  it("restoreCart → GET /checkout/{slug}/{flowSlug}/cart with encoded cid+sig query", async () => {
    const { transport, request } = mockTransport()
    const client = createCheckoutClient(config, transport)

    await client.restoreCart("cart-1", "a+b/c=")

    expect(request).toHaveBeenCalledWith(
      "GET",
      "/checkout/demo/checkout/cart?cid=cart-1&sig=a%2Bb%2Fc%3D",
    )
  })

  it("URL-encodes the slug in the path", async () => {
    const { transport, request } = mockTransport()
    const client = createCheckoutClient(
      { slug: "a b/c", flowSlug: "vip pass" },
      transport,
    )

    await client.getRuntime()

    expect(request).toHaveBeenCalledWith(
      "GET",
      "/checkout/a%20b%2Fc/vip%20pass/runtime",
    )
  })
})
