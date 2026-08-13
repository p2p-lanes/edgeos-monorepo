import { describe, expect, it, vi } from "vitest"
import { CheckoutApiError } from "./errors"
import { createFetchTransport } from "./fetchTransport"

function okResponse(data: unknown, status = 200) {
  return { ok: true, status, json: async () => data }
}
function errResponse(status: number, detail: unknown) {
  return { ok: false, status, json: async () => detail }
}

describe("createFetchTransport", () => {
  it("builds the URL, method, body and publishable-key header", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ ok: true }))
    const t = createFetchTransport({
      baseUrl: "https://api.example.com/api/v1/",
      slug: "demo",
      publishableKey: "pk_live_abc",
      fetch: fetchMock as unknown as typeof fetch,
    })

    const result = await t.request("POST", "/checkout/demo/preview", { a: 1 })

    expect(result).toEqual({ ok: true })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("https://api.example.com/api/v1/checkout/demo/preview")
    expect(init.method).toBe("POST")
    expect(init.body).toBe(JSON.stringify({ a: 1 }))
    expect(init.headers["Content-Type"]).toBe("application/json")
    expect(init.headers["X-EdgeOS-Publishable-Key"]).toBe("pk_live_abc")
  })

  it("omits the publishable-key header and body when not provided", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({}))
    const t = createFetchTransport({
      baseUrl: "https://x/api/v1",
      slug: "d",
      fetch: fetchMock as unknown as typeof fetch,
    })

    await t.request("GET", "/checkout/d/runtime")

    const [, init] = fetchMock.mock.calls[0]
    expect(init.headers["X-EdgeOS-Publishable-Key"]).toBeUndefined()
    expect(init.body).toBeUndefined()
  })

  it("throws CheckoutApiError with status + detail on non-2xx", async () => {
    const fetchMock = vi.fn().mockResolvedValue(errResponse(403, { detail: "nope" }))
    const t = createFetchTransport({
      baseUrl: "https://x/api/v1",
      slug: "d",
      fetch: fetchMock as unknown as typeof fetch,
    })

    await expect(t.request("GET", "/x")).rejects.toBeInstanceOf(CheckoutApiError)

    const err = (await t.request("GET", "/x").catch((e) => e)) as CheckoutApiError
    expect(err.status).toBe(403)
    expect(err.detail).toEqual({ detail: "nope" })
  })

  it("returns undefined for 204 No Content", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
      json: async () => {
        throw new Error("no body")
      },
    })
    const t = createFetchTransport({
      baseUrl: "https://x/api/v1",
      slug: "d",
      fetch: fetchMock as unknown as typeof fetch,
    })

    const r = await t.request("DELETE", "/x")
    expect(r).toBeUndefined()
  })
})
