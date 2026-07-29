import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createAnalyticsBus } from "../analytics/bus"
import type { CheckoutClient } from "../client"
import type {
  CheckoutPreviewResponse,
  CheckoutRuntimeResponse,
} from "../types/api"
import { createCheckoutStore } from "./store"

function runtime(): CheckoutRuntimeResponse {
  return {
    popup: { id: "pop1", slug: "demo", name: "Demo", currency: "USD" },
    products: [
      {
        tenant_id: "t",
        popup_id: "pop1",
        id: "p1",
        name: "Ticket",
        slug: "ticket",
        price: "100",
        category: "ticket",
        currency: "USD",
        is_active: true,
      },
    ],
    buyer_form: [],
    ticketing_steps: [
      { id: "s1", tenant_id: "t", popup_id: "pop1", step_type: "tickets", title: "Tickets" },
      { id: "s2", tenant_id: "t", popup_id: "pop1", step_type: "buyer", title: "Buyer" },
      { id: "s3", tenant_id: "t", popup_id: "pop1", step_type: "confirm", title: "Confirm" },
    ],
    form_schema: {
      base_fields: {
        email: { type: "text", label: "Email", required: true },
        first_name: { type: "text", label: "First name", required: true },
        last_name: { type: "text", label: "Last name", required: true },
      },
      custom_fields: {},
    },
  }
}

function preview(total: string): CheckoutPreviewResponse {
  return {
    lines: [],
    discountable_amount: total,
    non_discountable_amount: "0",
    discount_amount: "0",
    post_discount_amount: total,
    insurance_amount: "0",
    contribution_amount: "0",
    total,
    currency: "USD",
  }
}

function mockClient(over: Partial<CheckoutClient> = {}): CheckoutClient {
  return {
    getRuntime: vi.fn().mockResolvedValue(runtime()),
    preview: vi.fn().mockResolvedValue(preview("200")),
    validateCoupon: vi.fn().mockResolvedValue({
      code: "SAVE",
      discount_type: "percent",
      discount_value: "10",
      valid: true,
    }),
    purchase: vi.fn().mockResolvedValue({
      payment_id: "pay-1",
      status: "pending",
      checkout_url: "https://pay.example/abc",
      redirect_url: null,
      amount: "200",
      currency: "USD",
    }),
    upsertCart: vi.fn().mockResolvedValue({
      id: "cart-1",
      popup_id: "pop1",
      email: "a@b.co",
      items: {},
      restore_token: "tok",
    }),
    restoreCart: vi.fn(),
    ...over,
  }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe("createCheckoutStore", () => {
  it("loads runtime, derives steps and emits ViewContent", async () => {
    const track = vi.fn()
    const store = createCheckoutStore({
      client: mockClient(),
      runtime: runtime(),
      analytics: createAnalyticsBus([{ track }]),
    })

    await store.load()

    expect(store.getState().steps).toEqual(["passes", "buyer", "confirm"])
    expect(store.getState().currentStep).toBe("passes")
    expect(track).toHaveBeenCalledWith(
      expect.objectContaining({ type: "view_content" }),
    )
  })

  it("prices selection via /preview (debounced) and tracks AddToCart", async () => {
    const client = mockClient()
    const track = vi.fn()
    const store = createCheckoutStore({
      client,
      runtime: runtime(),
      analytics: createAnalyticsBus([{ track }]),
      pricingDebounceMs: 100,
    })
    await store.load()

    store.setQuantity("p1", 2)
    await vi.advanceTimersByTimeAsync(100)

    expect(client.preview).toHaveBeenCalledWith({
      products: [{ product_id: "p1", quantity: 2 }],
      coupon_code: null,
      insurance: false,
    })
    expect(store.getState().pricing.preview?.total).toBe("200")
    expect(track).toHaveBeenCalledWith(
      expect.objectContaining({ type: "add_to_cart", quantity: 2 }),
    )
  })

  it("gates steps behind selection and buyer completeness", async () => {
    const store = createCheckoutStore({ client: mockClient(), runtime: runtime() })
    await store.load()

    // Nothing selected → cannot advance past the first step.
    expect(store.goToStep("buyer")).toBe(false)

    store.setQuantity("p1", 1)
    expect(store.goToStep("buyer")).toBe(true)

    // Buyer incomplete → cannot reach confirm.
    expect(store.goToStep("confirm")).toBe(false)
    store.setBuyer({ email: "a@b.co", first_name: "Ada", last_name: "Lovelace" })
    expect(store.goToStep("confirm")).toBe(true)
  })

  it("validates a coupon and re-prices with it", async () => {
    const client = mockClient()
    const store = createCheckoutStore({
      client,
      runtime: runtime(),
      pricingDebounceMs: 50,
    })
    await store.load()
    store.setQuantity("p1", 1)

    const ok = await store.applyCoupon("SAVE")
    await vi.advanceTimersByTimeAsync(50)

    expect(ok).toBe(true)
    expect(store.getState().coupon).toEqual({ code: "SAVE", valid: true })
    expect(client.preview).toHaveBeenLastCalledWith(
      expect.objectContaining({ coupon_code: "SAVE" }),
    )
  })

  it("submits: flushes cart, purchases, returns the checkout url", async () => {
    const client = mockClient()
    const store = createCheckoutStore({ client, runtime: runtime() })
    await store.load()
    store.setQuantity("p1", 2)
    store.setBuyer({
      email: "a@b.co",
      first_name: "Ada",
      last_name: "Lovelace",
      custom_shirt: "L",
    })

    const result = await store.submit()

    expect(client.upsertCart).toHaveBeenCalled() // cart flushed for continuity
    expect(client.purchase).toHaveBeenCalledWith(
      expect.objectContaining({
        products: [{ product_id: "p1", quantity: 2 }],
        buyer: {
          email: "a@b.co",
          first_name: "Ada",
          last_name: "Lovelace",
          form_data: { shirt: "L" }, // custom_ stripped
        },
        cid: "cart-1",
        sig: "tok",
      }),
    )
    expect(result.checkoutUrl).toBe("https://pay.example/abc")
    expect(result.status).toBe("pending")
    expect(store.getState().submitting).toBe(false)
  })

  it("submit throws when nothing is selected", async () => {
    const store = createCheckoutStore({ client: mockClient(), runtime: runtime() })
    await store.load()
    await expect(store.submit()).rejects.toThrow("Nothing selected")
  })
})
