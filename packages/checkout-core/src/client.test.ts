import { describe, expect, it, vi } from "vitest"
import { createCheckoutClient } from "./client"
import type { Transport } from "./transport/types"

/**
 * A Transport spy. Calls that need the primary flow resolve it first, so the
 * spy answers /primary with a flow slug and everything else with `returnValue`.
 */
function mockTransport(returnValue: unknown = { ok: true }, flowSlug = "checkout") {
  const request = vi.fn((_method: string, path: string) =>
    Promise.resolve(
      path.endsWith("/primary") ? { flow_slug: flowSlug } : returnValue,
    ),
  )
  const transport: Transport = { request } as unknown as Transport
  return { transport, request }
}

describe("createCheckoutClient", () => {
  const config = { slug: "demo" }

  it("getProducts → GET /checkout/{slug}/products, no flow, no body", async () => {
    const { transport, request } = mockTransport({ products: [] })
    const client = createCheckoutClient(config, transport)

    const res = await client.getProducts()

    expect(res).toEqual({ products: [] })
    expect(request).toHaveBeenCalledWith("GET", "/checkout/demo/products")
  })

  it("getForm → GET /checkout/{slug}/form", async () => {
    const { transport, request } = mockTransport({ form_schema: {} })
    const client = createCheckoutClient(config, transport)

    await client.getForm()

    expect(request).toHaveBeenCalledWith("GET", "/checkout/demo/form")
  })

  it("preview → resolves the primary flow, then POSTs under it", async () => {
    const { transport, request } = mockTransport({}, "attendee")
    const client = createCheckoutClient(config, transport)

    const body = {
      products: [{ product_id: "p1", quantity: 2 }],
      insurance: true,
    }
    await client.preview(body)

    expect(request).toHaveBeenCalledWith("GET", "/checkout/demo/primary")
    expect(request).toHaveBeenCalledWith(
      "POST",
      "/checkout/demo/attendee/preview",
      body,
    )
  })

  it("resolves the primary flow once and reuses it", async () => {
    const { transport, request } = mockTransport()
    const client = createCheckoutClient(config, transport)

    await Promise.all([
      client.preview({ products: [] }),
      client.preview({ products: [] }),
    ])
    await client.preview({ products: [] })

    const primaryCalls = request.mock.calls.filter(
      ([, path]) => path === "/checkout/demo/primary",
    )
    expect(primaryCalls).toHaveLength(1)
  })

  it("retries the primary lookup after it fails", async () => {
    const request = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue({ flow_slug: "checkout" })
    const client = createCheckoutClient(config, {
      request,
    } as unknown as Transport)

    await expect(client.getPrimaryFlow()).rejects.toThrow("boom")
    await expect(client.getPrimaryFlow()).resolves.toBe("checkout")
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

  it("purchase → POST under the primary flow with the body", async () => {
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

  it("upsertCart → PUT under the primary flow with the body", async () => {
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

  it("restoreCart → GET under the primary flow with encoded cid+sig query", async () => {
    const { transport, request } = mockTransport()
    const client = createCheckoutClient(config, transport)

    await client.restoreCart("cart-1", "a+b/c=")

    expect(request).toHaveBeenCalledWith(
      "GET",
      "/checkout/demo/checkout/cart?cid=cart-1&sig=a%2Bb%2Fc%3D",
    )
  })

  it("URL-encodes the slug and the resolved flow in the path", async () => {
    const { transport, request } = mockTransport({}, "vip pass")
    const client = createCheckoutClient({ slug: "a b/c" }, transport)

    await client.preview({ products: [] })

    expect(request).toHaveBeenCalledWith(
      "POST",
      "/checkout/a%20b%2Fc/vip%20pass/preview",
      { products: [] },
    )
  })
})
