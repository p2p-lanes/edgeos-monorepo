import { describe, expect, it, vi } from "vitest"
import { createAnalyticsBus } from "./bus"
import type { AnalyticsPopup, AnalyticsProduct } from "./events"
import { createGaAdapter } from "./ga"
import { createMetaPixelAdapter } from "./metaPixel"

const POPUP: AnalyticsPopup = { id: "pop1", slug: "demo", name: "Demo", currency: "USD" }
const PRODUCTS: AnalyticsProduct[] = [
  { id: "p1", name: "Ticket", price: "100", currency: "USD", category: "ticket" },
  { id: "p2", name: "Hidden", price: "50", is_active: false },
]

describe("createAnalyticsBus", () => {
  it("fans events out to every adapter", () => {
    const a = { track: vi.fn() }
    const b = { track: vi.fn() }
    const bus = createAnalyticsBus([a])
    bus.use(b)

    bus.viewContent(POPUP, PRODUCTS)

    expect(a.track).toHaveBeenCalledWith({
      type: "view_content",
      popup: POPUP,
      products: PRODUCTS,
    })
    expect(b.track).toHaveBeenCalledTimes(1)
  })

  it("isolates a throwing adapter", () => {
    const bad = { track: () => { throw new Error("boom") } }
    const good = { track: vi.fn() }
    const bus = createAnalyticsBus([bad, good])

    expect(() => bus.addToCart(POPUP, PRODUCTS[0], 2)).not.toThrow()
    expect(good.track).toHaveBeenCalledTimes(1)
  })

  it("unsubscribes an adapter", () => {
    const a = { track: vi.fn() }
    const bus = createAnalyticsBus()
    const off = bus.use(a)
    off()
    bus.viewContent(POPUP, PRODUCTS)
    expect(a.track).not.toHaveBeenCalled()
  })
})

describe("metaPixelAdapter", () => {
  const opts = { sessionId: () => "sess", now: () => 123 }

  it("emits ViewContent with dedup id and active-only products", () => {
    const fbq = vi.fn()
    createMetaPixelAdapter({ fbq, ...opts }).track({
      type: "view_content",
      popup: POPUP,
      products: PRODUCTS,
    })
    const [, eventName, params, meta] = fbq.mock.calls[0]
    expect(eventName).toBe("ViewContent")
    expect(params.content_ids).toEqual(["p1"]) // p2 is_active:false filtered
    expect(params.value).toBe(100)
    expect(meta).toEqual({ eventID: "EVT_VIEW_pop1_sess" })
  })

  it("emits AddToCart with quantity value and skips non-positive qty", () => {
    const fbq = vi.fn()
    const adapter = createMetaPixelAdapter({ fbq, ...opts })
    adapter.track({ type: "add_to_cart", popup: POPUP, product: PRODUCTS[0], quantity: 3 })
    adapter.track({ type: "add_to_cart", popup: POPUP, product: PRODUCTS[0], quantity: 0 })

    expect(fbq).toHaveBeenCalledTimes(1)
    const [, eventName, params, meta] = fbq.mock.calls[0]
    expect(eventName).toBe("AddToCart")
    expect(params.value).toBe(300)
    expect(params.num_items).toBe(3)
    expect(meta).toEqual({ eventID: "EVT_CART_pop1_p1_sess_123" })
  })

  it("emits Purchase deduped by the raw payment id", () => {
    const fbq = vi.fn()
    createMetaPixelAdapter({ fbq, ...opts }).track({
      type: "purchase",
      paymentId: "pay-77",
      popup: POPUP,
      amount: "250",
      currency: "USD",
      products: [{ product_id: "p1", quantity: 2 }, { product_id: "p2" }],
    })
    const [, eventName, params, meta] = fbq.mock.calls[0]
    expect(eventName).toBe("Purchase")
    expect(params.order_id).toBe("pay-77")
    expect(params.value).toBe(250)
    expect(params.num_items).toBe(3)
    expect(meta).toEqual({ eventID: "pay-77" })
  })

  it("does nothing when fbq is unavailable", () => {
    expect(() =>
      createMetaPixelAdapter({ ...opts }).track({
        type: "view_content",
        popup: POPUP,
        products: PRODUCTS,
      }),
    ).not.toThrow()
  })
})

describe("gaAdapter", () => {
  it("maps view_content → view_item and purchase → purchase", () => {
    const gtag = vi.fn()
    const adapter = createGaAdapter({ gtag })
    adapter.track({ type: "view_content", popup: POPUP, products: PRODUCTS })
    adapter.track({
      type: "purchase",
      paymentId: "pay-9",
      popup: POPUP,
      amount: 42,
      currency: "USD",
      products: [{ product_id: "p1", quantity: 2 }],
    })

    expect(gtag.mock.calls[0][1]).toBe("view_item")
    expect(gtag.mock.calls[0][2].value).toBe(100)
    expect(gtag.mock.calls[1][1]).toBe("purchase")
    expect(gtag.mock.calls[1][2].transaction_id).toBe("pay-9")
    expect(gtag.mock.calls[1][2].value).toBe(42)
  })
})
