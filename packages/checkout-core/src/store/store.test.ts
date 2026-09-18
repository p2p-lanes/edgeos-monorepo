import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createAnalyticsBus } from "../analytics/bus"
import type { CheckoutClient } from "../client"
import type {
  CheckoutPreviewResponse,
  CheckoutProduct,
  CheckoutProductsResponse,
} from "../types/api"
import { createCheckoutStore } from "./store"

function product(over: Partial<CheckoutProduct> = {}): CheckoutProduct {
  return {
    tenant_id: "t",
    popup_id: "pop1",
    id: "p1",
    name: "Ticket",
    slug: "ticket",
    price: "100",
    category: "ticket",
    currency: "USD",
    is_active: true,
    ...over,
  }
}

function products(): CheckoutProductsResponse {
  return { products: [product()] }
}

function formSchema() {
  return {
    base_fields: {
      email: { type: "text", label: "Email", required: true },
      first_name: { type: "text", label: "First name", required: true },
      last_name: { type: "text", label: "Last name", required: true },
    },
    custom_fields: {},
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
    getProducts: vi.fn().mockResolvedValue(products()),
    getForm: vi.fn().mockResolvedValue({ form_schema: formSchema() }),
    getPrimaryFlow: vi.fn().mockResolvedValue("checkout"),
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
  it("loads catalogue + form in one pass and emits ViewContent", async () => {
    const track = vi.fn()
    const client = mockClient()
    const store = createCheckoutStore({
      client,
      popupSlug: "demo",
      analytics: createAnalyticsBus([{ track }]),
    })

    await store.load()

    expect(client.getProducts).toHaveBeenCalled()
    expect(client.getForm).toHaveBeenCalled()
    expect(store.getState().products).toHaveLength(1)
    expect(store.getState().formSchema).not.toBeNull()
    expect(store.getState().loaded).toBe(true)
    expect(track).toHaveBeenCalledWith(
      expect.objectContaining({ type: "view_content" }),
    )
  })

  it("does not fetch what the caller seeded", async () => {
    const client = mockClient()
    const store = createCheckoutStore({
      client,
      products: [product()],
      formSchema: null,
    })

    await store.load()

    expect(client.getProducts).not.toHaveBeenCalled()
    expect(client.getForm).not.toHaveBeenCalled()
    expect(store.getState().products).toHaveLength(1)
  })

  it("prices selection via /preview (debounced) and tracks AddToCart", async () => {
    const client = mockClient()
    const track = vi.fn()
    const store = createCheckoutStore({
      client,
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

  it("dispose() is idempotent and reflected by isDisposed()", () => {
    const store = createCheckoutStore({ client: mockClient() })
    expect(store.isDisposed()).toBe(false)
    store.dispose()
    expect(store.isDisposed()).toBe(true)
    // Second dispose must be a safe no-op (StrictMode can dispose twice).
    expect(() => store.dispose()).not.toThrow()
  })

  it("a disposed store stops propagating preview updates (why reuse must rebuild)", async () => {
    // This is the mechanism behind the StrictMode blank-total bug: the provider
    // must NOT reuse a disposed store, because its pricing subscription is dead —
    // the /preview call still fires but its result never reaches store state.
    const client = mockClient()
    const store = createCheckoutStore({ client, pricingDebounceMs: 100 })
    await store.load()

    store.dispose()
    ;(client.preview as ReturnType<typeof vi.fn>).mockClear()

    store.setQuantity("p1", 1)
    await vi.advanceTimersByTimeAsync(100)

    // Store state is frozen after dispose — preview never lands, even if the
    // pricing driver were to fire. The consumer would see a blank total forever.
    expect(store.getState().pricing.preview).toBeNull()
  })

  it("validates a coupon and re-prices with it", async () => {
    const client = mockClient()
    const store = createCheckoutStore({ client, pricingDebounceMs: 50 })
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
    const store = createCheckoutStore({ client })
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

  it("names the buyer as the recipient of every ticket line", async () => {
    // The API refuses a `ticket` line that identifies nobody, so a checkout
    // that never sets a recipient could not buy a ticket at all.
    const client = mockClient()
    const store = createCheckoutStore({ client })
    await store.load()
    store.setQuantity("p1", 1)
    store.setBuyer({
      email: "a@b.co",
      first_name: "Ada",
      last_name: "Lovelace",
      custom_shirt: "L",
    })

    await store.submit()

    expect(client.purchase).toHaveBeenCalledWith(
      expect.objectContaining({
        products: [
          { product_id: "p1", quantity: 1, recipient_key: "buyer" },
        ],
        recipients: [
          {
            recipient_key: "buyer",
            name: "Ada Lovelace",
            email: "a@b.co",
            profile_snapshot: { shirt: "L" },
          },
        ],
      }),
    )
  })

  it("leaves a non-ticket line without a recipient", async () => {
    const client = mockClient({
      getProducts: vi
        .fn()
        .mockResolvedValue({ products: [product({ category: "merch" })] }),
    })
    const store = createCheckoutStore({ client })
    await store.load()
    store.setQuantity("p1", 1)
    store.setBuyer({ email: "a@b.co", first_name: "Ada", last_name: "L" })

    await store.submit()

    expect(client.purchase).toHaveBeenCalledWith(
      expect.objectContaining({
        products: [{ product_id: "p1", quantity: 1 }],
        recipients: [],
      }),
    )
  })

  it("records a failed load in state and still rejects", async () => {
    // A UI that never awaited load() (the React provider calls it for you) has
    // only state to go by, and an empty catalogue reads as a sold-out event.
    const client = mockClient({
      getProducts: vi.fn().mockRejectedValue(new Error("offline")),
    })
    const store = createCheckoutStore({ client })

    await expect(store.load()).rejects.toThrow("offline")
    expect(store.getState().error).toBe("offline")
    expect(store.getState().loaded).toBe(false)
  })

  it("never calls a buyer complete without email, first and last name", async () => {
    // This popup's form configures no base questions at all, yet /purchase
    // still requires the three: trusting the schema alone would enable the pay
    // button for a buyer the API then rejects with a 422.
    const client = mockClient({
      getForm: vi
        .fn()
        .mockResolvedValue({ form_schema: { base_fields: {}, custom_fields: {} } }),
    })
    const store = createCheckoutStore({ client })
    await store.load()

    store.setBuyer({ first_name: "Ada", last_name: "Lovelace" })
    expect(store.getState().buyerComplete).toBe(false)

    store.setBuyer({ email: "a@b.co" })
    expect(store.getState().buyerComplete).toBe(true)
  })

  it("submit throws when nothing is selected", async () => {
    const store = createCheckoutStore({ client: mockClient() })
    await store.load()
    await expect(store.submit()).rejects.toThrow("Nothing selected")
  })
})
