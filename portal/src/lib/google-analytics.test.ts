import { afterEach, describe, expect, it, vi } from "vitest"
import { trackGAPurchase } from "./google-analytics"

describe("trackGAPurchase", () => {
  afterEach(() => {
    // biome-ignore lint/performance/noDelete: reset global gtag between tests
    delete (window as Window & { gtag?: unknown }).gtag
    vi.restoreAllMocks()
  })

  it("maps payment data into a GA4 purchase event", () => {
    const gtag = vi.fn()
    ;(window as Window & { gtag?: unknown }).gtag = gtag

    trackGAPurchase({
      paymentId: "pay_123",
      popup: { id: "popup_1", slug: "edge-city", name: "Edge City" },
      amount: "150.5",
      currency: "USD",
      products: [
        { product_id: "prod_a", quantity: 2 },
        { product_id: "prod_b" },
      ],
    })

    expect(gtag).toHaveBeenCalledTimes(1)
    expect(gtag).toHaveBeenCalledWith("event", "purchase", {
      popup_id: "popup_1",
      popup_slug: "edge-city",
      popup_name: "Edge City",
      transaction_id: "pay_123",
      currency: "USD",
      value: 150.5,
      items: [
        { item_id: "prod_a", quantity: 2, price: 0 },
        { item_id: "prod_b", quantity: 1, price: 0 },
      ],
    })
  })

  it("does nothing when gtag is unavailable", () => {
    expect(() =>
      trackGAPurchase({
        paymentId: "pay_123",
        popup: { id: "popup_1", slug: "edge-city", name: "Edge City" },
        amount: 0,
        currency: "USD",
        products: [],
      }),
    ).not.toThrow()
  })
})
