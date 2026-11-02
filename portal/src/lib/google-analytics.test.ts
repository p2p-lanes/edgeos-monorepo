import { afterEach, describe, expect, it, vi } from "vitest"
import type { PaymentPortalPublic } from "@/client"
import {
  getGABrowserIds,
  trackGAApplicationEvent,
  trackGAApplicationFeePurchase,
  trackGABeginCheckout,
  trackGACheckoutStep,
  trackGAPurchase,
} from "./google-analytics"

describe("trackGABeginCheckout", () => {
  afterEach(() => {
    delete (window as Window & { gtag?: unknown }).gtag
  })

  it("does not let a broken GA tag interrupt checkout", () => {
    ;(window as Window & { gtag?: unknown }).gtag = () => {
      throw new Error("unavailable")
    }
    expect(
      trackGABeginCheckout({
        popup: { id: "popup", slug: "summit" },
        items: [{ product_id: "ticket", quantity: 1 }],
        products: [],
      }),
    ).toBe(false)
  })

  it("reports actual selected quantities, prices and coupon", () => {
    const gtag = vi.fn()
    ;(window as Window & { gtag?: unknown }).gtag = gtag
    trackGABeginCheckout({
      popup: { id: "popup", slug: "summit", currency: "USD" },
      items: [{ product_id: "ticket", quantity: 2 }],
      products: [{ id: "ticket", name: "Pass", price: 15, category: "ticket" }],
      coupon: "SAVE",
    })
    expect(gtag).toHaveBeenCalledWith(
      "event",
      "begin_checkout",
      expect.objectContaining({
        currency: "USD",
        value: 30,
        coupon: "SAVE",
        items: [
          {
            item_id: "ticket",
            item_name: "Pass",
            item_category: "ticket",
            price: 15,
            quantity: 2,
          },
        ],
      }),
    )
  })

  it("does not invent prices or send an empty checkout", () => {
    const gtag = vi.fn()
    ;(window as Window & { gtag?: unknown }).gtag = gtag
    trackGABeginCheckout({
      popup: { id: "popup", slug: "summit", currency: "USD" },
      items: [{ product_id: "unknown", quantity: 1 }],
      products: [],
    })
    const payload = gtag.mock.calls[0][2]
    expect(payload).not.toHaveProperty("value")
    expect(payload.items[0]).not.toHaveProperty("price")
    gtag.mockClear()
    trackGABeginCheckout({
      popup: { id: "popup", slug: "summit" },
      items: [],
      products: [],
    })
    expect(gtag).not.toHaveBeenCalled()
  })
})

describe("getGABrowserIds", () => {
  it("reads the browser-generated GA4 client and session identifiers", async () => {
    const gtag = vi.fn((...args: unknown[]) => {
      const callback = args[3] as (value: string) => void
      callback(args[2] === "client_id" ? "123.456" : "789")
    })
    ;(window as Window & { gtag?: unknown }).gtag = gtag

    await expect(getGABrowserIds("G-TEST123")).resolves.toEqual({
      ga_client_id: "123.456",
      ga_session_id: "789",
    })
    expect(gtag).toHaveBeenCalledWith(
      "get",
      "G-TEST123",
      "client_id",
      expect.any(Function),
    )
    delete (window as Window & { gtag?: unknown }).gtag
  })

  it("does not let unavailable or malformed GA identifiers block checkout", async () => {
    ;(window as Window & { gtag?: unknown }).gtag = vi.fn(() => {
      throw new Error("tag unavailable")
    })
    await expect(getGABrowserIds("G-TEST123")).resolves.toEqual({})

    ;(window as Window & { gtag?: unknown }).gtag = vi.fn(
      (...args: unknown[]) => {
        const callback = args[3] as (value: string) => void
        callback(args[2] === "client_id" ? "invalid client id" : "not numeric")
      },
    )
    await expect(getGABrowserIds("G-TEST123")).resolves.toEqual({})
    delete (window as Window & { gtag?: unknown }).gtag
  })
})

describe("trackGAPurchase", () => {
  afterEach(() => {
    delete (window as Window & { gtag?: unknown }).gtag
    window.localStorage.clear()
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

  it("maps a dynamic checkout step into a GA4 custom event", () => {
    const gtag = vi.fn()
    ;(window as Window & { gtag?: unknown }).gtag = gtag

    trackGACheckoutStep({
      popup: { id: "popup_1", slug: "edge-city", name: "Edge City" },
      stepNumber: 2,
      stepId: "buyer",
      stepType: "buyer",
      stepName: "Tu información",
    })

    expect(gtag).toHaveBeenCalledWith("event", "checkout_step", {
      popup_id: "popup_1",
      popup_slug: "edge-city",
      popup_name: "Edge City",
      step_number: 2,
      step_id: "buyer",
      step_type: "buyer",
      step_name: "Tu información",
    })
  })

  it("sends application milestones without personal form data", () => {
    const gtag = vi.fn()
    ;(window as Window & { gtag?: unknown }).gtag = gtag

    trackGAApplicationEvent({
      eventName: "application_draft_saved",
      popup: { id: "popup_1", slug: "edge-city", name: "Edge City" },
      applicationId: "app_1",
      salesFlowId: "flow_1",
    })

    expect(gtag).toHaveBeenCalledWith("event", "application_draft_saved", {
      popup_id: "popup_1",
      popup_slug: "edge-city",
      popup_name: "Edge City",
      application_id: "app_1",
      sales_flow_id: "flow_1",
    })
  })

  it("tracks an approved application fee once with its actual charged amount", () => {
    const gtag = vi.fn()
    ;(window as Window & { gtag?: unknown }).gtag = gtag
    const payment = {
      id: "fee-1",
      popup_id: "popup_1",
      application_id: "app_1",
      payment_type: "application_fee",
      status: "approved",
      amount: "999",
      amount_charged: "1001.50",
      currency: "USD",
    } as PaymentPortalPublic

    trackGAApplicationFeePurchase({ payment, popupName: "Edge City" })
    trackGAApplicationFeePurchase({ payment, popupName: "Edge City" })

    expect(gtag).toHaveBeenCalledTimes(1)
    expect(gtag).toHaveBeenCalledWith("event", "purchase", {
      popup_id: "popup_1",
      popup_name: "Edge City",
      application_id: "app_1",
      transaction_id: "fee-1",
      currency: "USD",
      value: 1001.5,
      items: [
        {
          item_id: "application_fee",
          item_name: "Edge City",
          quantity: 1,
          price: 1001.5,
        },
      ],
    })
  })

  it("ignores pending fees, non-fee payments, and unavailable gtag", () => {
    const gtag = vi.fn()
    const payment = {
      id: "fee-2",
      popup_id: "popup_1",
      payment_type: "application_fee",
      status: "pending",
      amount: "999",
    } as PaymentPortalPublic

    trackGAApplicationFeePurchase({ payment })
    ;(window as Window & { gtag?: unknown }).gtag = gtag
    trackGAApplicationFeePurchase({ payment })
    trackGAApplicationFeePurchase({
      payment: { ...payment, status: "approved", payment_type: "purchase" },
    })
    expect(gtag).not.toHaveBeenCalled()

    trackGAApplicationFeePurchase({
      payment: { ...payment, status: "approved" },
    })
    expect(gtag).toHaveBeenCalledTimes(1)
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
