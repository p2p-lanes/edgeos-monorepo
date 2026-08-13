import { describe, expect, it } from "vitest"
import * as sdk from "./index"

// Locks the public surface Plan 3's React adapter (and custom checkout UIs)
// consume. A rename/removal here is a breaking change and should be deliberate.
describe("@edgeos/checkout-core public surface", () => {
  it("exports the documented factory functions", () => {
    const expected = [
      "createCheckoutStore",
      "createCheckoutClient",
      "createFetchTransport",
      "createPricingDriver",
      "createCartDriver",
      "createAnalyticsBus",
      "createMetaPixelAdapter",
      "createGaAdapter",
      "buildOrderLines",
      "buildFormZodSchema",
      "deriveAvailableSteps",
      "emptySelection",
      "selectionToCartState",
      "cartStateToSelection",
      "CheckoutApiError",
    ] as const
    for (const name of expected) {
      expect(sdk, `missing export: ${name}`).toHaveProperty(name)
      // Classes (CheckoutApiError) are functions too.
      expect(typeof (sdk as Record<string, unknown>)[name]).toBe("function")
    }
  })

  it("drives a full flow end-to-end through the barrel", async () => {
    const client = sdk.createCheckoutClient(
      { slug: "demo" },
      {
        request: async <T>(_m: string, path: string): Promise<T> =>
          (path.endsWith("/purchase")
            ? { payment_id: "x", status: "pending", checkout_url: "u", amount: "1", currency: "USD" }
            : { total: "1" }) as T,
      },
    )
    const store = sdk.createCheckoutStore({
      client,
      runtime: {
        popup: { id: "p", slug: "demo" },
        products: [
          {
            tenant_id: "t",
            popup_id: "p",
            id: "p1",
            name: "T",
            slug: "t",
            price: "1",
            category: "ticket",
            is_active: true,
          },
        ],
        buyer_form: [],
        ticketing_steps: [
          { id: "s1", tenant_id: "t", popup_id: "p", step_type: "tickets", title: "T" },
        ],
      },
    })
    await store.load()
    store.setQuantity("p1", 1)
    const res = await store.submit()
    expect(res.checkoutUrl).toBe("u")
  })
})
